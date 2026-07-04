"""
Authentication routes: register, login, logout.

Auth strategy: JWT stored in an httpOnly cookie (not returned in the
response body), so the frontend never has direct access to the raw
token and it is automatically included on subsequent requests.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.config import settings
from app.core.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_database
from app.models.schemas import MessageResponse, UserCreate, UserLogin, UserOut

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def _set_auth_cookie(response: Response, token: str) -> None:
    """Attach the JWT as a secure httpOnly cookie on the response."""
    response.set_cookie(
        key=settings.COOKIE_NAME,
        value=token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        expires=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path="/",
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(
    payload: UserCreate,
    response: Response,
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserOut:
    """
    Register a new user.

    - Rejects the request if the email or employee_id is already in use.
    - Stores only the bcrypt hash of the password, never the plain text.
    - On success, logs the user in immediately by issuing an auth cookie.
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
        "password": hash_password(payload.password),
        "email_verified": False,
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
    user_out = UserOut(**user_document)

    access_token = create_access_token(
        data={"sub": str(insert_result.inserted_id), "role": user_document["role"]}
    )
    _set_auth_cookie(response, access_token)

    return user_out


@router.post("/login", response_model=UserOut)
async def login(
    payload: UserLogin,
    response: Response,
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserOut:
    """
    Authenticate a user with email + password.

    On success, issues a signed JWT in an httpOnly cookie and returns the
    public user profile. On failure, returns a generic 401 message that
    does not reveal whether the email or the password was incorrect.
    """
    invalid_credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect email or password.",
    )

    user_doc = await db["users"].find_one({"email": payload.email.lower()})
    if user_doc is None:
        raise invalid_credentials_exception

    if not verify_password(payload.password, user_doc["password"]):
        raise invalid_credentials_exception

    if not user_doc.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated. Contact an administrator.",
        )

    access_token = create_access_token(
        data={"sub": str(user_doc["_id"]), "role": user_doc["role"]}
    )
    _set_auth_cookie(response, access_token)

    user_doc["_id"] = str(user_doc["_id"])
    return UserOut(**user_doc)


@router.post("/logout", response_model=MessageResponse)
async def logout(response: Response) -> MessageResponse:
    """
    Log the current user out by clearing the auth cookie.
    This endpoint intentionally does not require authentication so that
    a stale/expired session can always be cleared client-side.
    """
    response.delete_cookie(
        key=settings.COOKIE_NAME,
        domain=settings.COOKIE_DOMAIN,
        path="/",
    )
    return MessageResponse(message="Successfully logged out.")


@router.get("/me", response_model=UserOut)
async def get_me(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    """Return the profile of the currently authenticated user."""
    return current_user
