"""
User management routes.

- /api/users/me   -> the logged-in employee's own profile (read + limited self-update)
- /api/users      -> admin/HR full user directory + full-override management
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.core.deps import get_current_user, require_admin
from app.core.security import hash_password
from app.core.utils import parse_object_id, stringify_id
from app.database import get_database
from app.models.schemas import (
    MessageResponse,
    UserAdminUpdate,
    UserCreate,
    UserOut,
    UserRole,
    UserSelfUpdate,
)

router = APIRouter(prefix="/api/users", tags=["Users"])


# ---------------------------------------------------------------------------
# Employee self-service
# ---------------------------------------------------------------------------

@router.get("/me", response_model=UserOut)
async def get_my_profile(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    """Return the profile of the currently authenticated employee."""
    return current_user


@router.patch("/me", response_model=UserOut)
async def update_my_profile(
    payload: UserSelfUpdate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserOut:
    """
    Let an employee update their own contact/profile details.

    Deliberately restricted to `phone`, `address`, and `profile_picture` —
    role, email, employee_id, and account-status fields are not settable
    here and must go through the admin-only endpoints below.
    """
    update_fields = payload.model_dump(exclude_unset=True)

    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No updatable fields were provided.",
        )

    update_fields["updated_at"] = datetime.now(timezone.utc)

    user_object_id = parse_object_id(current_user.id, "user")
    await db["users"].update_one({"_id": user_object_id}, {"$set": update_fields})

    updated_doc = await db["users"].find_one({"_id": user_object_id})
    if updated_doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account no longer exists.",
        )

    return UserOut(**stringify_id(updated_doc))


# ---------------------------------------------------------------------------
# Admin / HR user directory & management
# ---------------------------------------------------------------------------

@router.get("", response_model=list[UserOut])
async def list_users(
    role: Optional[UserRole] = Query(default=None),
    department: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    search: Optional[str] = Query(default=None, description="Matches against full_name, email, or employee_id."),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    _: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[UserOut]:
    """Admin/HR: list all users in the organization with optional filters."""
    mongo_filter: dict = {}

    if role is not None:
        mongo_filter["role"] = role.value
    if department is not None:
        mongo_filter["department"] = department
    if is_active is not None:
        mongo_filter["is_active"] = is_active
    if search:
        mongo_filter["$or"] = [
            {"full_name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"employee_id": {"$regex": search, "$options": "i"}},
        ]

    cursor = db["users"].find(mongo_filter).sort("created_at", -1).skip(skip).limit(limit)
    users = [UserOut(**stringify_id(doc)) async for doc in cursor]
    return users


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    _: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserOut:
    """
    Admin/HR: directly provision a new employee account (any role,
    pre-verified). This bypasses the public self-registration flow and
    does not log the caller in as the new user.
    """
    existing_email = await db["users"].find_one({"email": payload.email.lower()})
    if existing_email is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address already exists.",
        )

    existing_employee_id = await db["users"].find_one({"employee_id": payload.employee_id})
    if existing_employee_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this employee ID already exists.",
        )

    now = datetime.now(timezone.utc)
    user_document = {
        "employee_id": payload.employee_id,
        "email": payload.email.lower(),
        "full_name": payload.full_name,
        "role": payload.role.value,
        "department": payload.department,
        "phone": payload.phone,
        "address": payload.address,
        "profile_picture": payload.profile_picture,
        "password": hash_password(payload.password),
        "email_verified": True,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }

    try:
        insert_result = await db["users"].insert_one(user_document)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email or employee ID already exists.",
        )

    user_document["_id"] = str(insert_result.inserted_id)
    return UserOut(**user_document)


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: str,
    _: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserOut:
    """Admin/HR: fetch a single user's full profile by id."""
    object_id = parse_object_id(user_id, "user")
    user_doc = await db["users"].find_one({"_id": object_id})
    if user_doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return UserOut(**stringify_id(user_doc))


@router.patch("/{user_id}", response_model=UserOut)
async def admin_update_user(
    user_id: str,
    payload: UserAdminUpdate,
    current_user: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserOut:
    """
    Admin/HR: full-override update of any user's profile, including role,
    email, employee_id, and account-status fields.
    """
    object_id = parse_object_id(user_id, "user")
    target_doc = await db["users"].find_one({"_id": object_id})
    if target_doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    update_fields = payload.model_dump(exclude_unset=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No updatable fields were provided.",
        )

    # Guard rail: an admin cannot deactivate or demote their own account,
    # which would otherwise be able to lock every admin out of the system.
    if user_id == current_user.id:
        if update_fields.get("is_active") is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot deactivate your own account.",
            )
        if "role" in update_fields and update_fields["role"] != current_user.role:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot change your own role.",
            )

    if "role" in update_fields and update_fields["role"] is not None:
        update_fields["role"] = update_fields["role"].value

    if "email" in update_fields and update_fields["email"] is not None:
        normalized_email = str(update_fields["email"]).lower()
        conflicting = await db["users"].find_one(
            {"email": normalized_email, "_id": {"$ne": object_id}}
        )
        if conflicting is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Another account is already using this email address.",
            )
        update_fields["email"] = normalized_email

    if "employee_id" in update_fields and update_fields["employee_id"] is not None:
        conflicting = await db["users"].find_one(
            {"employee_id": update_fields["employee_id"], "_id": {"$ne": object_id}}
        )
        if conflicting is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Another account is already using this employee ID.",
            )

    update_fields["updated_at"] = datetime.now(timezone.utc)

    try:
        await db["users"].update_one({"_id": object_id}, {"$set": update_fields})
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Another account is already using this email or employee ID.",
        )

    updated_doc = await db["users"].find_one({"_id": object_id})
    return UserOut(**stringify_id(updated_doc))


@router.delete("/{user_id}", response_model=MessageResponse)
async def deactivate_user(
    user_id: str,
    current_user: UserOut = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    """
    Admin/HR: deactivate (soft-delete) a user account. Records are kept
    for audit/history purposes (attendance, leave, payroll); the account
    simply can no longer authenticate.
    """
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account.",
        )

    object_id = parse_object_id(user_id, "user")
    result = await db["users"].update_one(
        {"_id": object_id},
        {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    return MessageResponse(message="User account deactivated.")
