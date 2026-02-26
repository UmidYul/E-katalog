from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from time import perf_counter

from celery import Celery
from fastapi import APIRouter, Depends, Response, status
from redis.asyncio import Redis
from sqlalchemy import text

from app.api.deps import get_redis
from app.core.config import settings
from app.core.observability import http_metrics
from app.db.session import engine

router = APIRouter(tags=["health"])


def _health_error(exc: Exception) -> str:
    message = str(exc).strip()
    if not message:
        return exc.__class__.__name__
    return message[:240]


async def _check_db() -> dict[str, object]:
    started_at = perf_counter()
    try:
        async with engine.connect() as conn:
            await conn.execute(text("select 1"))
        return {"status": "ok", "latency_ms": round((perf_counter() - started_at) * 1000, 2)}
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "down",
            "latency_ms": round((perf_counter() - started_at) * 1000, 2),
            "error": _health_error(exc),
        }


async def _check_redis(redis: Redis) -> dict[str, object]:
    started_at = perf_counter()
    try:
        pong = bool(await redis.ping())
        if not pong:
            raise RuntimeError("redis ping returned false")
        return {"status": "ok", "latency_ms": round((perf_counter() - started_at) * 1000, 2)}
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "down",
            "latency_ms": round((perf_counter() - started_at) * 1000, 2),
            "error": _health_error(exc),
        }


def _check_celery(timeout_seconds: float) -> dict[str, object]:
    started_at = perf_counter()
    app = Celery(
        "api-healthcheck",
        broker=settings.celery_broker_url,
        backend=settings.celery_result_backend,
    )
    try:
        with app.connection_or_acquire() as connection:
            connection.ensure_connection(max_retries=0)
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "down",
            "latency_ms": round((perf_counter() - started_at) * 1000, 2),
            "error": _health_error(exc),
        }

    try:
        inspect = app.control.inspect(timeout=timeout_seconds)
        ping_payload = inspect.ping()
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "degraded",
            "latency_ms": round((perf_counter() - started_at) * 1000, 2),
            "workers_count": 0,
            "error": _health_error(exc),
        }

    if not ping_payload:
        return {
            "status": "degraded",
            "latency_ms": round((perf_counter() - started_at) * 1000, 2),
            "workers_count": 0,
            "error": "no workers responded to ping",
        }

    workers = sorted(str(name) for name in ping_payload.keys())
    return {
        "status": "ok",
        "latency_ms": round((perf_counter() - started_at) * 1000, 2),
        "workers_count": len(workers),
        "workers": workers,
    }


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/live")
async def live() -> dict[str, str]:
    return {"status": "alive", "at": datetime.now(UTC).isoformat()}


@router.get("/ready")
async def ready(response: Response, redis: Redis = Depends(get_redis)) -> dict[str, object]:
    timeout_seconds = max(0.5, float(settings.health_check_timeout_seconds))
    db_check, redis_check, celery_check = await asyncio.gather(
        _check_db(),
        _check_redis(redis),
        asyncio.to_thread(_check_celery, timeout_seconds),
    )

    hard_failure = db_check.get("status") != "ok" or redis_check.get("status") != "ok"
    celery_down = celery_check.get("status") == "down"
    celery_missing_workers = settings.health_require_celery_worker and celery_check.get("status") != "ok"
    not_ready = bool(hard_failure or celery_down or celery_missing_workers)
    if not_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    overall_status = "ready"
    if not_ready:
        overall_status = "not_ready"
    elif celery_check.get("status") != "ok":
        overall_status = "degraded"

    return {
        "status": overall_status,
        "at": datetime.now(UTC).isoformat(),
        "checks": {
            "db": db_check,
            "redis": redis_check,
            "celery": celery_check,
        },
    }


@router.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    return Response(content=http_metrics.render_prometheus(), media_type="text/plain; version=0.0.4; charset=utf-8")
