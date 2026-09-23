from functools import lru_cache
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_DEV_JWT_SECRET = "college-schedule-local-dev-secret-change-me"


class Settings(BaseSettings):
    app_name: str = "College Schedule API"
    environment: str = "development"
    database_url: str = (
        "postgresql+psycopg://college_schedule:college_schedule_dev"
        "@localhost:5432/college_schedule"
    )
    backend_cors_origins: str = "https://college-schedule-flame.vercel.app,http://localhost:3000"
    semester_start: str = "2025-09-01"
    wipe_secret: str | None = None
    # Stable only for local development; deployments must override this.
    jwt_secret_key: str = DEFAULT_DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    auth_cookie_secure: bool = False
    auth_cookie_name: str = "college_schedule_refresh"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")


    @model_validator(mode="after")
    def validate_production_secret(self) -> 'Settings':
        if self.environment.lower() == "production" and self.jwt_secret_key == DEFAULT_DEV_JWT_SECRET:
            raise ValueError("JWT_SECRET_KEY must be overridden in production!")
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
