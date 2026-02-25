from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import get_redis
from app.api.v1.routers.auth import ensure_seed_admin
from app.api.v1.routers import api_router
from app.core.config import settings
from app.core.logging import configure_logging, logger
from app.db.session import AsyncSessionLocal

configure_logging(settings.log_level)

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
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


app.include_router(api_router)


@app.on_event("startup")
async def startup_seed_admin() -> None:
    redis = get_redis()
    async with AsyncSessionLocal() as db:
        user = await ensure_seed_admin(redis, db=db)
    if user:
        logger.info("seed_admin_ready", email=user["email"], role=user["role"])
