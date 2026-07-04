"""
Leave request routes.

- POST   /api/leaves            -> employee submits a new leave request
- GET    /api/leaves            -> employee sees own requests; admin/HR sees everyone's (filterable)
- GET    /api/leaves/{id}       -> fetch a single request (owner or admin/HR)
- PATCH  /api/leaves/{id}       -> admin/HR approval center: approve or reject
- PATCH  /api/leaves/{id}/cancel -> employee withdraws their own still-pending request
"""
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.deps import get_current_user, require_admin
from app.core.utils import parse_object_id, stringify_id
from app.database import get_database
from app.models.schemas import (
    LeaveRequestCreate,
    LeaveRequestOut,
    LeaveRequestReview,
    LeaveStatus,
    LeaveType,
    UserOut,
)

router = APIRouter(prefix="/api/leaves", tags=["Leave Requests"])


def _doc_to_out(doc: dict) -> LeaveRequestOut:
    doc["start_date"] = date.fromisoformat(doc["start_date"])
    doc["end_date"] = date.fromisoformat(doc["end_date"])
    doc["total_days"] = (doc["end_date"] - doc["start_date"]).days + 1
    return LeaveRequestOut(**stringify_id(doc))


@router.post("", response_model=LeaveRequestOut, status_code=status.HTTP_201_CREATED)
async def submit_leave_request(
    payload: LeaveRequestCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> LeaveRequestOut:
    """An employee submits a new leave request for admin/HR review."""
    if payload.end_date < payload.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date must be on or after start_date.",
        )

    # Prevent overlapping requests against the same still-active (pending/approved) leave.
    overlapping = await db["leave_requests"].find_one(
        {
            "employee_id": current_user.employee_id,
            "status": {"$in": [LeaveStatus.pending.value, LeaveStatus.approved.value]},
            "start_date": {"$lte": payload.end_date.isoformat()},
            "end_date": {"$gte": payload.start_date.isoformat()},
        }
    )
    if overlapping is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have a pending or approved leave request that overlaps these dates.",
        )

    now = datetime.now(timezone.utc)
    leave_document = {
        "employee_id": current_user.employee_id,
        "leave_type": payload.leave_type.value,
        "start_date": payload.start_date.isoformat(),
        "end_date": payload.end_date.isoformat(),
        "reason": payload.reason,
        "status": LeaveStatus.pending.value,
        "reviewed_by": None,
        "review_comment": None,
        "applied_on": now,
        "reviewed_on": None,
    }
    insert_result = await db["leave_requests"].insert_one(leave_document)
    leave_document["_id"] = insert_result.inserted_id

    return _doc_to_out(leave_document)


@router.get("", response_model=list[LeaveRequestOut])
async def list_leave_requests(
    status_filter: Optional[LeaveStatus] = Query(default=None, alias="status"),
    leave_type: Optional[LeaveType] = Query(default=None),
    employee_id: Optional[str] = Query(
        default=None, description="Admin/HR only: filter by a specific employee's ID."
    ),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[LeaveRequestOut]:
    """
    Employees see only their own leave requests. Admin/HR see everyone's
    and may additionally filter by employee_id.
    """
    is_privileged = current_user.role.value in ("admin", "hr")

    mongo_filter: dict = {}
    if is_privileged:
        if employee_id is not None:
            mongo_filter["employee_id"] = employee_id
    else:
        mongo_filter["employee_id"] = current_user.employee_id

    if status_filter is not None:
        mongo_filter["status"] = status_filter.value
    if leave_type is not None:
        mongo_filter["leave_type"] = leave_type.value

    cursor = db["leave_requests"].find(mongo_filter).sort("applied_on", -1).skip(skip).limit(limit)
    return [_doc_to_out(doc) async for doc in cursor]


@router.get("/{leave_id}", response_model=LeaveRequestOut)
async def get_leave_request(
    leave_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> LeaveRequestOut:
    """Fetch a single leave request. Employees may only view their own."""
    object_id = parse_object_id(leave_id, "leave request")
    doc = await db["leave_requests"].find_one({"_id": object_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")

    is_privileged = current_user.role.value in ("admin", "hr")
    if not is_privileged and doc["employee_id"] != current_user.employee_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view this leave request.",
        )

    return _doc_to_out(doc)


@router.patch("/{leave_id}", response_model=LeaveRequestOut)
async def review_leave_request(
    leave_id: str,
    payload: LeaveRequestReview,
    current_user: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> LeaveRequestOut:
    """
    Admin/HR approval center: approve or reject a pending leave request.
    Only requests currently in 'pending' status may be reviewed.
    """
    object_id = parse_object_id(leave_id, "leave request")
    doc = await db["leave_requests"].find_one({"_id": object_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")

    if doc["status"] != LeaveStatus.pending.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This request has already been {doc['status']} and cannot be reviewed again.",
        )

    now = datetime.now(timezone.utc)
    update_fields = {
        "status": payload.status.value,
        "review_comment": payload.review_comment,
        "reviewed_by": current_user.employee_id,
        "reviewed_on": now,
    }

    # If approving, guard against a newly-created overlapping approval for the same employee.
    if payload.status == LeaveStatus.approved:
        conflicting = await db["leave_requests"].find_one(
            {
                "_id": {"$ne": object_id},
                "employee_id": doc["employee_id"],
                "status": LeaveStatus.approved.value,
                "start_date": {"$lte": doc["end_date"]},
                "end_date": {"$gte": doc["start_date"]},
            }
        )
        if conflicting is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This employee already has another approved leave overlapping these dates.",
            )

    await db["leave_requests"].update_one({"_id": object_id}, {"$set": update_fields})
    saved_doc = await db["leave_requests"].find_one({"_id": object_id})
    return _doc_to_out(saved_doc)


@router.patch("/{leave_id}/cancel", response_model=LeaveRequestOut)
async def cancel_leave_request(
    leave_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> LeaveRequestOut:
    """An employee withdraws their own leave request while it is still pending."""
    object_id = parse_object_id(leave_id, "leave request")
    doc = await db["leave_requests"].find_one({"_id": object_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")

    if doc["employee_id"] != current_user.employee_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to cancel this leave request.",
        )

    if doc["status"] != LeaveStatus.pending.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only pending requests can be cancelled; this one is already {doc['status']}.",
        )

    now = datetime.now(timezone.utc)
    await db["leave_requests"].update_one(
        {"_id": object_id},
        {"$set": {"status": LeaveStatus.cancelled.value, "reviewed_on": now}},
    )
    saved_doc = await db["leave_requests"].find_one({"_id": object_id})
    return _doc_to_out(saved_doc)
