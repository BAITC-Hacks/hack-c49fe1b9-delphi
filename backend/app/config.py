from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str
    storage_path: Path
    max_upload_bytes: int = Field(gt=0)
    max_uncompressed_bytes: int = Field(gt=0)
    max_documents_per_analysis: int = Field(gt=1)
    openai_api_key: SecretStr | None = None
    openai_model: str | None = None
    request_timeout_seconds: float = Field(gt=0)
    run_timeout_seconds: float = Field(gt=0)
    max_tool_rounds: int = Field(ge=1, le=12)
    max_batch_chars: int = Field(ge=2000)

    @field_validator("database_url")
    @classmethod
    def require_postgresql(cls, value: str) -> str:
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL must use postgresql+asyncpg")
        return value

    @field_validator("openai_api_key", "openai_model", mode="before")
    @classmethod
    def empty_provider_value(cls, value):
        return None if value == "" else value

    @field_validator("storage_path")
    @classmethod
    def resolve_storage(cls, value: Path) -> Path:
        return value if value.is_absolute() else (BACKEND_DIR / value).resolve()

    @property
    def ai_configured(self) -> bool:
        return self.openai_api_key is not None and self.openai_model is not None


@lru_cache
def get_settings() -> Settings:
    return Settings()
