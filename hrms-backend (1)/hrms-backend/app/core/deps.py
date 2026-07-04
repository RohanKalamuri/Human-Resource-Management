"""
FastAPI dependencies for cookie-based JWT authentication and
role-based access control.
"""
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, HTTPException, Request, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import settings
from app.core.security import decode_access_token
from app.database import get_database
from app.models.schemas import UserOut, UserRole


async def get_current_user(
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserOut:
    """
    Resolve the currently authenticated user from the JWT stored in the
    httpOnly auth cookie. Raises 401 if the cookie is missing, the token
    is invalid/expired, or the referenced user no longer exists/is inactive.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token = request.cookies.get(settings.COOKIE_NAME)
    if not token:
        raise credentials_exception

    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception

    user_id = payload.get("sub")
    if not user_id:
        raise credentials_exception

    try:
        object_id = ObjectId(user_id)
    except (InvalidId, TypeError):
        raise credentials_exception

    user_doc = await db["users"].find_one({"_id": object_id})
    if user_doc is None:
        raise credentials_exception

    if not user_doc.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated. Contact an administrator.",
        )

    user_doc["_id"] = str(user_doc["_id"])
    return UserOut(**user_doc)


async def require_admin(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    """
    Dependency that only allows access to users with the 'admin' or 'hr' role.
    Raises 403 for any other role.
    """
    if current_user.role not in (UserRole.admin, UserRole.hr):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have sufficient privileges to perform this action.",
        )
    return current_user
