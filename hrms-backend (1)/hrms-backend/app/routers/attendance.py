"""
Attendance routes.

- POST /api/attendance/check-in   -> employee clocks in; status derived server-side
- POST /api/attendance/check-out  -> employee clocks out; status re-evaluated on hours worked
- GET  /api/attendance/today      -> admin/HR live tracker of every employee's status today
- GET  /api/attendance/me         -> employee's own attendance history
- PATCH /api/attendance/{id}      -> admin/HR manual correction of a record
"""
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import settings
from app.core.deps import get_current_user, require_admin
from app.core.utils import parse_object_id, stringify_id
from app.database import get_database
from app.models.schemas import (
    AttendanceCheckInRequest,
    AttendanceCheckOutRequest,
    AttendanceOut,
    AttendanceStatus,
    AttendanceTodayOut,
    AttendanceUpdate,
    LeaveStatus,
    UserOut,
)

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def _workday_start_for(day: date) -> datetime:
    return datetime.combine(
        day, time(hour=settings.WORKDAY_START_HOUR, minute=settings.WORKDAY_START_MINUTE), tzinfo=timezone.utc
    )


def _derive_check_in_status(now: datetime, today: date, work_from_home: bool) -> AttendanceStatus:
    """
    Full status-enum logic applied at check-in time:
    - within the grace window of the official workday start -> present / work_from_home
    - later than the grace window                            -> half_day (arrived too late for a full day)
    """
    late_cutoff = _workday_start_for(today) + timedelta(minutes=settings.LATE_GRACE_MINUTES)

    if now <= late_cutoff:
        return AttendanceStatus.work_from_home if work_from_home else AttendanceStatus.present

    return AttendanceStatus.half_day


def _derive_check_out_status(existing_status: AttendanceStatus, hours_worked: float) -> AttendanceStatus:
    """
    Full status-enum logic applied at check-out time: a short day
    downgrades present/work_from_home to half_day, regardless of how
    punctual the check-in was.
    """
    if existing_status in (AttendanceStatus.absent, AttendanceStatus.on_leave):
        return existing_status

    if hours_worked < settings.MIN_FULL_DAY_HOURS:
        return AttendanceStatus.half_day

    return existing_status


async def _has_approved_leave_today(
    db: AsyncIOMotorDatabase, employee_id: str, today: date
) -> bool:
    leave_doc = await db["leave_requests"].find_one(
        {
            "employee_id": employee_id,
            "status": LeaveStatus.approved.value,
            "start_date": {"$lte": today.isoformat()},
            "end_date": {"$gte": today.isoformat()},
        }
    )
    return leave_doc is not None


@router.post("/check-in", response_model=AttendanceOut, status_code=status.HTTP_201_CREATED)
async def check_in(
    payload: AttendanceCheckInRequest,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AttendanceOut:
    """Clock the current employee in for today."""
    now = datetime.now(timezone.utc)
    today = now.date()

    if await _has_approved_leave_today(db, current_user.employee_id, today):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have an approved leave for today and cannot check in.",
        )

    existing = await db["attendance"].find_one(
        {"employee_id": current_user.employee_id, "date": today.isoformat()}
    )
    if existing is not None and existing.get("check_in") is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already checked in today.",
        )

    derived_status = _derive_check_in_status(now, today, payload.work_from_home)

    attendance_document = {
        "employee_id": current_user.employee_id,
        "date": today.isoformat(),
        "status": derived_status.value,
        "check_in": now,
        "check_out": None,
        "notes": payload.notes,
        "created_at": now,
        "updated_at": now,
    }

    if existing is not None:
        await db["attendance"].update_one({"_id": existing["_id"]}, {"$set": attendance_document})
        saved_doc = await db["attendance"].find_one({"_id": existing["_id"]})
    else:
        insert_result = await db["attendance"].insert_one(attendance_document)
        saved_doc = await db["attendance"].find_one({"_id": insert_result.inserted_id})

    saved_doc["date"] = date.fromisoformat(saved_doc["date"])
    return AttendanceOut(**stringify_id(saved_doc))


@router.post("/check-out", response_model=AttendanceOut)
async def check_out(
    payload: AttendanceCheckOutRequest,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AttendanceOut:
    """Clock the current employee out for today."""
    now = datetime.now(timezone.utc)
    today = now.date()

    existing = await db["attendance"].find_one(
        {"employee_id": current_user.employee_id, "date": today.isoformat()}
    )
    if existing is None or existing.get("check_in") is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have not checked in today, so you cannot check out.",
        )
    if existing.get("check_out") is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already checked out today.",
        )

    check_in_time = existing["check_in"]
    if check_in_time.tzinfo is None:
        check_in_time = check_in_time.replace(tzinfo=timezone.utc)

    hours_worked = (now - check_in_time).total_seconds() / 3600
    existing_status = AttendanceStatus(existing["status"])
    final_status = _derive_check_out_status(existing_status, hours_worked)

    update_fields = {
        "check_out": now,
        "status": final_status.value,
        "updated_at": now,
    }
    if payload.notes is not None:
        update_fields["notes"] = payload.notes

    await db["attendance"].update_one({"_id": existing["_id"]}, {"$set": update_fields})

    saved_doc = await db["attendance"].find_one({"_id": existing["_id"]})
    saved_doc["date"] = date.fromisoformat(saved_doc["date"])
    return AttendanceOut(**stringify_id(saved_doc))


@router.get("/me", response_model=list[AttendanceOut])
async def get_my_attendance_history(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=31, ge=1, le=366),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[AttendanceOut]:
    """Return the current employee's own attendance history, most recent first."""
    mongo_filter: dict = {"employee_id": current_user.employee_id}
    date_filter: dict = {}
    if start_date is not None:
        date_filter["$gte"] = start_date.isoformat()
    if end_date is not None:
        date_filter["$lte"] = end_date.isoformat()
    if date_filter:
        mongo_filter["date"] = date_filter

    cursor = db["attendance"].find(mongo_filter).sort("date", -1).skip(skip).limit(limit)

    records = []
    async for doc in cursor:
        doc["date"] = date.fromisoformat(doc["date"])
        records.append(AttendanceOut(**stringify_id(doc)))
    return records


@router.get("/today", response_model=list[AttendanceTodayOut])
async def get_today_tracker(
    _: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[AttendanceTodayOut]:
    """
    Admin/HR live tracker: every active employee's attendance status for
    today, including employees who haven't checked in yet (shown as
    'on_leave' if they have an approved leave today, otherwise 'absent').
    """
    today = _today_utc()

    active_users_cursor = db["users"].find({"is_active": True})
    active_users = [doc async for doc in active_users_cursor]

    attendance_cursor = db["attendance"].find({"date": today.isoformat()})
    attendance_by_employee = {doc["employee_id"]: doc async for doc in attendance_cursor}

    approved_leaves_cursor = db["leave_requests"].find(
        {
            "status": LeaveStatus.approved.value,
            "start_date": {"$lte": today.isoformat()},
            "end_date": {"$gte": today.isoformat()},
        }
    )
    employees_on_leave = {doc["employee_id"] async for doc in approved_leaves_cursor}

    tracker_rows: list[AttendanceTodayOut] = []
    for user_doc in active_users:
        employee_id = user_doc["employee_id"]
        attendance_doc = attendance_by_employee.get(employee_id)

        if attendance_doc is not None:
            tracker_rows.append(
                AttendanceTodayOut(
                    _id=str(attendance_doc["_id"]),
                    employee_id=employee_id,
                    full_name=user_doc["full_name"],
                    department=user_doc.get("department"),
                    date=today,
                    status=AttendanceStatus(attendance_doc["status"]),
                    check_in=attendance_doc.get("check_in"),
                    check_out=attendance_doc.get("check_out"),
                    notes=attendance_doc.get("notes"),
                )
            )
        else:
            fallback_status = (
                AttendanceStatus.on_leave if employee_id in employees_on_leave else AttendanceStatus.absent
            )
            tracker_rows.append(
                AttendanceTodayOut(
                    _id=f"virtual-{employee_id}-{today.isoformat()}",
                    employee_id=employee_id,
                    full_name=user_doc["full_name"],
                    department=user_doc.get("department"),
                    date=today,
                    status=fallback_status,
                    check_in=None,
                    check_out=None,
                    notes=None,
                )
            )

    return tracker_rows


@router.patch("/{attendance_id}", response_model=AttendanceOut)
async def admin_correct_attendance(
    attendance_id: str,
    payload: AttendanceUpdate,
    _: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AttendanceOut:
    """Admin/HR: manually correct a specific attendance record."""
    object_id = parse_object_id(attendance_id, "attendance record")

    update_fields = payload.model_dump(exclude_unset=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No updatable fields were provided.",
        )
    if "status" in update_fields and update_fields["status"] is not None:
        update_fields["status"] = update_fields["status"].value

    update_fields["updated_at"] = datetime.now(timezone.utc)

    result = await db["attendance"].update_one({"_id": object_id}, {"$set": update_fields})
    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found.")

    saved_doc = await db["attendance"].find_one({"_id": object_id})
    saved_doc["date"] = date.fromisoformat(saved_doc["date"])
    return AttendanceOut(**stringify_id(saved_doc))
