from functools import lru_cache
import os
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_DEV_JWT_SECRET = "college-schedule-local-dev-secret-change-me"


class Settings(BaseSettings):
    APP_TIMEZONE: str = "Europe/Kyiv"
    IMPORT_CRON_SECRET: str | None = None
    app_name: str = "College Schedule API"
    environment: str = "development"
    database_url: str = (
        "postgresql+psycopg://college_schedule:college_schedule_dev"
        "@localhost:5432/college_schedule"
    )
    backend_cors_origins: str = "https://rozklad-dfkr.pp.ua,https://www.rozklad-dfkr.pp.ua,https://college-schedule-flame.vercel.app,http://localhost:3000"
    semester_start: str = "2025-09-01"
    # Stable only for local development; deployments must override this.
    jwt_secret_key: str = DEFAULT_DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 43200  # 30 days persistent admin session
    refresh_token_expire_days: int = 60       # 60 days refresh window
    auth_cookie_secure: bool = False
    auth_cookie_name: str = "college_schedule_refresh"
    google_client_id: str = "1079868158360-ok75uv5l93pcql2iktfcple97sdu180b.apps.googleusercontent.com"
    google_client_secret: str = ""
    classroom_fernet_key: str = ""
    classroom_fernet_old_keys: str = ""
    classroom_legacy_auth: bool = True
    teacher_pin: str = "dfkr2026"
    admin_password: str | None = None
    wipe_secret: str | None = None
    enable_docs: bool = False
    forwarded_allow_ips: str = "127.0.0.1"
    run_schema_bootstrap: bool = False
    auto_import_enabled: bool = True
    auto_import_interval_minutes: int = 30
    classroom_sync_interval_minutes: int = 10
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production" or bool(os.environ.get("DYNO"))

    @model_validator(mode="after")
    def validate_production_secret(self) -> 'Settings':
        if self.environment.lower() == "production":
            if not self.jwt_secret_key or self.jwt_secret_key in (DEFAULT_DEV_JWT_SECRET, "change-me"):
                raise ValueError("JWT_SECRET_KEY must be overridden in production!")
            if self.admin_password == "admin123":
                raise ValueError("Default ADMIN_PASSWORD 'admin123' is forbidden in production!")
        return self

    @property
    def is_cookie_secure(self) -> bool:
        return self.auth_cookie_secure or self.is_production

    @property
    def cors_origins(self) -> list[str]:
        origins = [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip() and origin.strip() != "*"]
        core_origins = ["https://rozklad-dfkr.pp.ua", "https://www.rozklad-dfkr.pp.ua", "https://college-schedule-flame.vercel.app", "http://localhost:3000"]
        for o in core_origins:
            if o not in origins:
                origins.append(o)
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
