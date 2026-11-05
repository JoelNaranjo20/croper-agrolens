from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Runtime configuration, loaded from environment variables (12-factor)."""

    model_config = SettingsConfigDict(env_prefix="AI_", env_file=".env", extra="ignore")

    env: str = "development"
    log_level: str = "INFO"
    model_path: Path = BASE_DIR / "models" / "yield_model.joblib"
    dataset_path: Path = BASE_DIR / "data" / "agro_training.db"
    max_image_bytes: int = Field(default=5 * 1024 * 1024, ge=1024)
    # Images are downscaled before analysis: keeps latency flat regardless of camera resolution.
    analysis_max_side: int = Field(default=512, ge=64, le=2048)


@lru_cache
def get_settings() -> Settings:
    return Settings()
