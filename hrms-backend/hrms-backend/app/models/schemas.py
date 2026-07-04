"""
Pydantic schemas for all HRMS domain models.

Convention used throughout this file:
- `*Base`    -> fields shared between create/update/read variants.
- `*Create`  -> payload accepted from the client when creating a resource.
- `*Update`  -> payload accepted from the client when updating a resource
                (all fields optional).
- `*InDB`    -> full representation as stored in MongoDB (includes the
                hashed password, internal ids, timestamps, etc.). Never
                returned directly to clients.
- `*Out`     -> safe, public representation returned to clients.
"""
from datetime import date, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

class MongoBaseModel(BaseModel):
    """Base model configured to work smoothly with MongoDB's `_id` field."""

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={datetime: lambda dt: dt.isoformat()},
    )


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------

class UserRole(str, Enum):
    admin = "admin"
    hr = "hr"
    manager = "manager"
    employee = "employee"


class UserBase(MongoBaseModel):
    employee_id: str = Field(..., min_length=1, max_length=32, description="Unique employee code, e.g. EMP-1001")
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=120)
    role: UserRole = UserRole.employee
    department: Optional[str] = Field(default=None, max_length=80)


class UserCreate(UserBase):
    """Payload for user registration. Plain-text password, hashed before storage."""

    password: str = Field(..., min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        if not any(char.isdigit() for char in value):
            raise ValueError("Password must contain at least one digit.")
        if not any(char.isalpha() for char in value):
            raise ValueError("Password must contain at least one letter.")
        return value


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    department: Optional[str] = Field(default=None, max_length=80)
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


class UserInDB(UserBase):
    """Full internal representation of a user document as stored in MongoDB."""

    id: str = Field(..., alias="_id")
    password: str = Field(..., description="Bcrypt-hashed password, never plain text.")
    email_verified: bool = False
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class UserOut(MongoBaseModel):
    """Public-safe user representation returned by the API."""

    id: str = Field(..., alias="_id")
    employee_id: str
    email: EmailStr
    full_name: str
    role: UserRole
    department: Optional[str] = None
    email_verified: bool
    is_active: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Attendance
# ---------------------------------------------------------------------------

class AttendanceStatus(str, Enum):
    present = "present"
    absent = "absent"
    half_day = "half_day"
    on_leave = "on_leave"
    work_from_home = "work_from_home"


class AttendanceBase(MongoBaseModel):
    employee_id: str
    date: date
    status: AttendanceStatus = AttendanceStatus.present
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=280)


class AttendanceCreate(BaseModel):
    status: AttendanceStatus = AttendanceStatus.present
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=280)


class AttendanceUpdate(BaseModel):
    status: Optional[AttendanceStatus] = None
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=280)


class AttendanceInDB(AttendanceBase):
    id: str = Field(..., alias="_id")
    created_at: datetime
    updated_at: datetime


class AttendanceOut(AttendanceBase):
    id: str = Field(..., alias="_id")
    created_at: datetime


# ---------------------------------------------------------------------------
# Leave Request
# ---------------------------------------------------------------------------

class LeaveType(str, Enum):
    sick = "sick"
    casual = "casual"
    earned = "earned"
    unpaid = "unpaid"
    maternity = "maternity"
    paternity = "paternity"


class LeaveStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    cancelled = "cancelled"


class LeaveRequestBase(MongoBaseModel):
    employee_id: str
    leave_type: LeaveType
    start_date: date
    end_date: date
    reason: str = Field(..., min_length=1, max_length=500)

    @field_validator("end_date")
    @classmethod
    def end_date_after_start_date(cls, end_date: date, info) -> date:
        start_date = info.data.get("start_date")
        if start_date and end_date < start_date:
            raise ValueError("end_date must be on or after start_date.")
        return end_date


class LeaveRequestCreate(BaseModel):
    leave_type: LeaveType
    start_date: date
    end_date: date
    reason: str = Field(..., min_length=1, max_length=500)


class LeaveRequestReview(BaseModel):
    status: LeaveStatus
    review_comment: Optional[str] = Field(default=None, max_length=500)

    @field_validator("status")
    @classmethod
    def status_must_be_reviewable(cls, status: LeaveStatus) -> LeaveStatus:
        if status not in (LeaveStatus.approved, LeaveStatus.rejected):
            raise ValueError("Review status must be either 'approved' or 'rejected'.")
        return status


class LeaveRequestInDB(LeaveRequestBase):
    id: str = Field(..., alias="_id")
    status: LeaveStatus = LeaveStatus.pending
    reviewed_by: Optional[str] = None
    review_comment: Optional[str] = None
    applied_on: datetime
    reviewed_on: Optional[datetime] = None


class LeaveRequestOut(LeaveRequestBase):
    id: str = Field(..., alias="_id")
    status: LeaveStatus
    reviewed_by: Optional[str] = None
    review_comment: Optional[str] = None
    applied_on: datetime
    reviewed_on: Optional[datetime] = None
    total_days: int

    @field_validator("total_days", mode="before")
    @classmethod
    def compute_total_days(cls, value, info):
        if value is not None:
            return value
        start_date = info.data.get("start_date")
        end_date = info.data.get("end_date")
        if start_date and end_date:
            return (end_date - start_date).days + 1
        return 0


# ---------------------------------------------------------------------------
# Payroll
# ---------------------------------------------------------------------------

class PayrollStatus(str, Enum):
    pending = "pending"
    processed = "processed"
    paid = "paid"
    failed = "failed"


class PayrollBase(MongoBaseModel):
    employee_id: str
    month: int = Field(..., ge=1, le=12)
    year: int = Field(..., ge=2000, le=2100)
    basic_salary: float = Field(..., ge=0)
    allowances: float = Field(default=0, ge=0)
    deductions: float = Field(default=0, ge=0)
    tax: float = Field(default=0, ge=0)


class PayrollCreate(PayrollBase):
    pass


class PayrollUpdate(BaseModel):
    basic_salary: Optional[float] = Field(default=None, ge=0)
    allowances: Optional[float] = Field(default=None, ge=0)
    deductions: Optional[float] = Field(default=None, ge=0)
    tax: Optional[float] = Field(default=None, ge=0)
    status: Optional[PayrollStatus] = None


class PayrollInDB(PayrollBase):
    id: str = Field(..., alias="_id")
    net_salary: float
    status: PayrollStatus = PayrollStatus.pending
    generated_on: datetime
    paid_on: Optional[datetime] = None


class PayrollOut(PayrollBase):
    id: str = Field(..., alias="_id")
    net_salary: float
    status: PayrollStatus
    generated_on: datetime
    paid_on: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Generic response envelopes
# ---------------------------------------------------------------------------

class MessageResponse(BaseModel):
    message: str


class TokenPayload(BaseModel):
    sub: str
    role: UserRole
    exp: Optional[int] = None
