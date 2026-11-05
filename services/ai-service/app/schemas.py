from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.ml.dataset import CROP_PROFILES

CropType = Literal[tuple(CROP_PROFILES)]  # type: ignore[valid-type]


class ApiModel(BaseModel):
    """camelCase on the wire (JS/TS consumers), snake_case in Python."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class YieldRequest(ApiModel):
    crop: CropType
    area_ha: float = Field(gt=0, le=100_000, description="Field area in hectares")
    rainfall_mm: float = Field(ge=0, le=6000, description="Expected annual rainfall")
    avg_temp_c: float = Field(ge=-5, le=45)
    soil_ph: float = Field(default=6.0, ge=3, le=10)
    vegetation_coverage: float = Field(
        default=0.7, ge=0, le=1, description="Canopy coverage from the latest image analysis"
    )


class YieldRange(ApiModel):
    p10: float
    p50: float
    p90: float


class YieldResponse(ApiModel):
    crop: str
    yield_t_ha: YieldRange
    total_t: YieldRange
    model_version: str


class VegetationResponse(ApiModel):
    vegetation_coverage: float
    stress_ratio: float
    exg_mean: float
    health: Literal["healthy", "moderate", "stressed", "bare"]
    analyzed_width: int
    analyzed_height: int


class ModelInfo(ApiModel):
    version: str
    trained_at: str
    metrics: dict[str, float]
    crops: list[str]


class Problem(BaseModel):
    """RFC 9457 problem details."""

    type: str = "about:blank"
    title: str
    status: int
    detail: str | None = None
