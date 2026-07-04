"""
HRMS backend application entrypoint.

Run locally with:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_mongo_connection, connect_to_mongo, create_indexes
from app.routers import auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup ---
    await connect_to_mongo()
    await create_indexes()
    yield
    # --- Shutdown ---
    await close_mongo_connection()


app = FastAPI(
    title=settings.APP_NAME,
    description="Human Resource Management System API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS must allow credentials so the browser will send/receive the auth cookie.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)


@app.get("/api/health", tags=["Health"])
async def health_check() -> dict[str, str]:
    """Simple liveness/readiness probe."""
    return {"status": "ok", "service": settings.APP_NAME}
