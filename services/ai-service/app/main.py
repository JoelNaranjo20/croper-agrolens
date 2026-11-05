from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import health_router, router
from app.config import Settings, get_settings
from app.logging_config import configure_logging
from app.ml.yield_model import YieldModel

logger = logging.getLogger("ai-service")


def _problem(status: int, title: str, detail: object = None) -> JSONResponse:
    body: dict[str, object] = {"type": "about:blank", "title": title, "status": status}
    if detail is not None:
        body["detail"] = detail
    return JSONResponse(body, status_code=status, media_type="application/problem+json")


def create_app(settings: Settings | None = None, model: YieldModel | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if model is not None:
            app.state.yield_model = model
        elif settings.model_path.exists():
            app.state.yield_model = YieldModel.load(settings.model_path)
            logger.info("Loaded yield model v%s", app.state.yield_model.version)
        else:
            # Start anyway (liveness OK) but report not-ready so the orchestrator holds traffic.
            app.state.yield_model = None
            logger.error("Model artifact not found at %s", settings.model_path)
        yield

    app = FastAPI(
        title="AgroLens AI Service",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None if settings.env == "production" else "/docs",
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        if not request.url.path.startswith("/health"):
            logger.info(
                "request",
                extra={
                    "request_id": request_id,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                },
            )
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_exc(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _problem(exc.status_code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_exc(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{"loc": e["loc"], "msg": e["msg"]} for e in exc.errors()]
        return _problem(422, "Validation failed", errors)

    app.state.settings = settings
    app.include_router(health_router)
    app.include_router(router, prefix="/v1")
    return app


app = create_app()
