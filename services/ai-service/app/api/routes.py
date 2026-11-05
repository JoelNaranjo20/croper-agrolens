from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from app.config import Settings
from app.ml.dataset import CROP_PROFILES
from app.ml.yield_model import YieldModel
from app.schemas import ModelInfo, VegetationResponse, YieldRange, YieldRequest, YieldResponse
from app.vision.vegetation import InvalidImageError, analyze

router = APIRouter()
health_router = APIRouter(tags=["health"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def get_model(request: Request) -> YieldModel:
    model: YieldModel | None = getattr(request.app.state, "yield_model", None)
    if model is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Yield model not loaded")
    return model


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


ModelDep = Annotated[YieldModel, Depends(get_model)]
SettingsDep = Annotated[Settings, Depends(get_app_settings)]


@health_router.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@health_router.get("/health/ready")
def ready(request: Request) -> dict[str, str]:
    if getattr(request.app.state, "yield_model", None) is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Model not loaded")
    return {"status": "ready"}


@router.get("/models/yield", response_model=ModelInfo, tags=["predictions"])
def model_info(model: ModelDep) -> ModelInfo:
    md = model.metadata
    return ModelInfo(
        version=md["version"],
        trained_at=md["trained_at"],
        metrics=md["metrics"],
        crops=list(CROP_PROFILES),
    )


@router.post("/predictions/yield", response_model=YieldResponse, tags=["predictions"])
def predict_yield(body: YieldRequest, model: ModelDep) -> YieldResponse:
    p = model.predict(
        body.crop, body.rainfall_mm, body.avg_temp_c, body.soil_ph, body.vegetation_coverage
    )
    per_ha = YieldRange(p10=round(p.p10, 3), p50=round(p.p50, 3), p90=round(p.p90, 3))
    total = YieldRange(
        p10=round(p.p10 * body.area_ha, 2),
        p50=round(p.p50 * body.area_ha, 2),
        p90=round(p.p90 * body.area_ha, 2),
    )
    return YieldResponse(
        crop=body.crop, yield_t_ha=per_ha, total_t=total, model_version=model.version
    )


@router.post("/vision/vegetation-index", response_model=VegetationResponse, tags=["vision"])
async def vegetation_index(
    settings: SettingsDep, image: Annotated[UploadFile, File(...)]
) -> VegetationResponse:
    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported type {image.content_type!r}; use JPEG, PNG or WebP",
        )
    # Read at most limit+1 bytes: never buffer an unbounded upload in memory.
    data = await image.read(settings.max_image_bytes + 1)
    if len(data) > settings.max_image_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Image too large")
    try:
        # CPU-bound: keep the event loop free for other requests.
        result = await run_in_threadpool(analyze, data, settings.analysis_max_side)
    except InvalidImageError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return VegetationResponse(
        vegetation_coverage=result.vegetation_coverage,
        stress_ratio=result.stress_ratio,
        exg_mean=result.exg_mean,
        health=result.health.value,
        analyzed_width=result.width,
        analyzed_height=result.height,
    )
