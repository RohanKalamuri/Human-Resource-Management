"""
Application configuration.
All values are loaded from environment variables (or a local .env file)
using pydantic-settings so nothing sensitive is hard-coded.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- MongoDB ---
    MONGO_URI: str = "mongodb://localhost:27017"
    DB_NAME: str = "hrms_db"

    # --- JWT / Auth ---
    JWT_SECRET_KEY: str = "CHANGE_THIS_SECRET_IN_PRODUCTION"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours

    # --- Cookie ---
    COOKIE_NAME: str = "hrms_access_token"
    COOKIE_SECURE: bool = False  # set True in production (requires HTTPS)
    COOKIE_SAMESITE: str = "lax"
    COOKIE_DOMAIN: str | None = None

    # --- CORS ---
    FRONTEND_ORIGIN: str = "http://localhost:3000"

    # --- App ---
    APP_NAME: str = "HRMS API"
    ENVIRONMENT: str = "development"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
