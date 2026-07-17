from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PAPERPILOT_",
        env_file=".env",
        extra="ignore",
    )

    env: str = "development"
    auto_create_schema: bool = True
    database_url: str = "sqlite:///./paperpilot.db"
    redis_url: str = "redis://localhost:6379/0"
    web_origin: str = "http://localhost:3000"
    demo_mode: bool = True
    local_auth_enabled: bool = True
    task_always_eager: bool = True
    auth_secret: str = "development-only-change-this-secret"
    storage_backend: str = "local"
    storage_path: Path = Path("./uploads")
    oss_endpoint: str | None = None
    oss_bucket: str | None = None
    oss_access_key_id: str | None = None
    oss_access_key_secret: str | None = None
    oss_kms_key_id: str | None = None
    upload_retention_hours: int = Field(default=24, ge=1, le=168)
    grobid_url: str = "http://localhost:8070"
    ncbi_email: str = "researcher@example.com"
    ncbi_api_key: str | None = None
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-pro"

    @model_validator(mode="after")
    def require_deepseek_for_live_runs(self) -> "Settings":
        if not self.demo_mode and not self.deepseek_api_key:
            raise ValueError("PAPERPILOT_DEEPSEEK_API_KEY is required when demo mode is disabled")
        return self
