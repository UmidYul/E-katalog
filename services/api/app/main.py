from __future__ import annotations

import uuid
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import get_redis
from app.api.v1.routers.auth import ensure_seed_admin
from app.api.v1.routers import api_router
from app.core.config import settings
from app.core.logging import configure_logging, logger
from app.core.observability import http_metrics, init_sentry, route_label_from_scope
from app.db.session import AsyncSessionLocal

configure_logging(settings.log_level)
init_sentry()

app = FastAPI(title="E-katalog API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    started_at = http_metrics.mark_start()
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request.state.request_id = request_id
    status_code = 500
    try:
        response = await call_next(request)
        status_code = int(response.status_code)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time-Ms"] = f"{(perf_counter() - started_at) * 1000:.2f}"
        if request.url.path.startswith("/api/"):
            response.headers["X-API-Version"] = str(settings.api_version_header_value or "v1")
        return response
    finally:
        http_metrics.mark_done(
            method=request.method,
            route=route_label_from_scope(request.scope),
            status_code=status_code,
            started_at=started_at,
        )


app.include_router(api_router)


@app.on_event("startup")
async def startup_seed_admin() -> None:
    redis = get_redis()
    async with AsyncSessionLocal() as db:
        user = await ensure_seed_admin(redis, db=db)
    if user:
        logger.info("seed_admin_ready", email=user["email"], role=user["role"])
