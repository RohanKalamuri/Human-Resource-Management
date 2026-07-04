"""
Payroll routes.

- GET   /api/payroll        -> employees: read-only, own records only
                                admin/HR: full overview, all employees, filterable
- GET   /api/payroll/{id}   -> a single record (owner or admin/HR)
- POST  /api/payroll        -> admin/HR only: generate a new payroll record
- PATCH /api/payroll/{id}   -> admin/HR only: adjust amounts / update status (e.g. mark paid)
- DELETE /api/payroll/{id}  -> admin/HR only: remove an erroneous record
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.core.deps import get_current_user, require_admin
from app.core.utils import parse_object_id, stringify_id
from app.database import get_database
from app.models.schemas import (
    MessageResponse,
    PayrollCreate,
    PayrollOut,
    PayrollStatus,
    PayrollUpdate,
    UserOut,
)

router = APIRouter(prefix="/api/payroll", tags=["Payroll"])


def _compute_net_salary(basic_salary: float, allowances: float, deductions: float, tax: float) -> float:
    return round(basic_salary + allowances - deductions - tax, 2)


@router.get("", response_model=list[PayrollOut])
async def list_payroll_records(
    employee_id: Optional[str] = Query(
        default=None, description="Admin/HR only: filter to a specific employee."
    ),
    month: Optional[int] = Query(default=None, ge=1, le=12),
    year: Optional[int] = Query(default=None, ge=2000, le=2100),
    status_filter: Optional[PayrollStatus] = Query(default=None, alias="status"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[PayrollOut]:
    """
    Employees: read-only view of their own payroll history.
    Admin/HR: organization-wide overview, optionally scoped to one employee.
    """
    is_privileged = current_user.role.value in ("admin", "hr")

    mongo_filter: dict = {}
    if is_privileged:
        if employee_id is not None:
            mongo_filter["employee_id"] = employee_id
    else:
        mongo_filter["employee_id"] = current_user.employee_id

    if month is not None:
        mongo_filter["month"] = month
    if year is not None:
        mongo_filter["year"] = year
    if status_filter is not None:
        mongo_filter["status"] = status_filter.value

    cursor = (
        db["payroll"]
        .find(mongo_filter)
        .sort([("year", -1), ("month", -1)])
        .skip(skip)
        .limit(limit)
    )
    return [PayrollOut(**stringify_id(doc)) async for doc in cursor]


@router.get("/{payroll_id}", response_model=PayrollOut)
async def get_payroll_record(
    payroll_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> PayrollOut:
    """Employees may only fetch their own record; admin/HR may fetch any."""
    object_id = parse_object_id(payroll_id, "payroll record")
    doc = await db["payroll"].find_one({"_id": object_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll record not found.")

    is_privileged = current_user.role.value in ("admin", "hr")
    if not is_privileged and doc["employee_id"] != current_user.employee_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view this payroll record.",
        )

    return PayrollOut(**stringify_id(doc))


@router.post("", response_model=PayrollOut, status_code=status.HTTP_201_CREATED)
async def create_payroll_record(
    payload: PayrollCreate,
    _: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> PayrollOut:
    """Admin/HR: generate a new payroll record for an employee/month/year."""
    target_employee = await db["users"].find_one({"employee_id": payload.employee_id})
    if target_employee is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No employee exists with this employee_id.",
        )

    now = datetime.now(timezone.utc)
    net_salary = _compute_net_salary(
        payload.basic_salary, payload.allowances, payload.deductions, payload.tax
    )
    payroll_document = {
        "employee_id": payload.employee_id,
        "month": payload.month,
        "year": payload.year,
        "basic_salary": payload.basic_salary,
        "allowances": payload.allowances,
        "deductions": payload.deductions,
        "tax": payload.tax,
        "net_salary": net_salary,
        "status": PayrollStatus.pending.value,
        "generated_on": now,
        "paid_on": None,
    }

    try:
        insert_result = await db["payroll"].insert_one(payroll_document)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A payroll record for this employee, month, and year already exists.",
        )

    payroll_document["_id"] = str(insert_result.inserted_id)
    return PayrollOut(**payroll_document)


@router.patch("/{payroll_id}", response_model=PayrollOut)
async def update_payroll_record(
    payroll_id: str,
    payload: PayrollUpdate,
    _: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> PayrollOut:
    """
    Admin/HR: adjust salary components and/or transition status
    (e.g. pending -> processed -> paid). Net salary is always
    recalculated server-side from the stored components.
    """
    object_id = parse_object_id(payroll_id, "payroll record")
    doc = await db["payroll"].find_one({"_id": object_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll record not found.")

    update_fields = payload.model_dump(exclude_unset=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No updatable fields were provided.",
        )

    new_status: Optional[PayrollStatus] = update_fields.pop("status", None)

    basic_salary = update_fields.get("basic_salary", doc["basic_salary"])
    allowances = update_fields.get("allowances", doc["allowances"])
    deductions = update_fields.get("deductions", doc["deductions"])
    tax = update_fields.get("tax", doc["tax"])
    update_fields["net_salary"] = _compute_net_salary(basic_salary, allowances, deductions, tax)

    if new_status is not None:
        update_fields["status"] = new_status.value
        if new_status == PayrollStatus.paid and doc.get("paid_on") is None:
            update_fields["paid_on"] = datetime.now(timezone.utc)
        elif new_status != PayrollStatus.paid:
            update_fields["paid_on"] = None

    await db["payroll"].update_one({"_id": object_id}, {"$set": update_fields})
    saved_doc = await db["payroll"].find_one({"_id": object_id})
    return PayrollOut(**stringify_id(saved_doc))


@router.delete("/{payroll_id}", response_model=MessageResponse)
async def delete_payroll_record(
    payroll_id: str,
    _: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    """Admin/HR: permanently remove an erroneous payroll record."""
    object_id = parse_object_id(payroll_id, "payroll record")
    result = await db["payroll"].delete_one({"_id": object_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll record not found.")
    return MessageResponse(message="Payroll record deleted.")
