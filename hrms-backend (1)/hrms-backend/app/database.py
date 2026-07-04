"""
Async MongoDB connection management using Motor.

The client is created once at application startup and reused for the
lifetime of the process. `get_database` is a FastAPI dependency that
yields the database handle to routers/services.
"""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import settings


class MongoManager:
    client: AsyncIOMotorClient | None = None
    db: AsyncIOMotorDatabase | None = None


mongo_manager = MongoManager()


async def connect_to_mongo() -> None:
    """Initialize the Motor client and database handle. Called on startup."""
    mongo_manager.client = AsyncIOMotorClient(settings.MONGO_URI)
    mongo_manager.db = mongo_manager.client[settings.DB_NAME]
    # Fail fast if MongoDB is unreachable.
    await mongo_manager.client.admin.command("ping")


async def close_mongo_connection() -> None:
    """Close the Motor client. Called on shutdown."""
    if mongo_manager.client is not None:
        mongo_manager.client.close()


async def create_indexes() -> None:
    """Create unique/compound indexes required by the application."""
    db = mongo_manager.db
    if db is None:
        raise RuntimeError("Database connection has not been initialized.")

    await db["users"].create_index("email", unique=True)
    await db["users"].create_index("employee_id", unique=True)

    await db["attendance"].create_index(
        [("employee_id", 1), ("date", 1)], unique=True
    )

    await db["leave_requests"].create_index([("employee_id", 1), ("status", 1)])

    await db["payroll"].create_index(
        [("employee_id", 1), ("month", 1), ("year", 1)], unique=True
    )


def get_database() -> AsyncIOMotorDatabase:
    """FastAPI dependency that returns the active database handle."""
    if mongo_manager.db is None:
        raise RuntimeError("Database connection has not been initialized.")
    return mongo_manager.db
