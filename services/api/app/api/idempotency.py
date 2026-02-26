from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response
from redis.asyncio import Redis

from app.core.config import settings


IDEMPOTENCY_HEADER = "Idempotency-Key"


def _normalize_idempotency_key(raw_value: str | None) -> str:
    value = str(raw_value or "").strip()
    if not value:
        return ""
    if len(value) > 200:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Idempotency-Key is too long")
    return value


def _fingerprint_request(*, request: Request, body_bytes: bytes, scope: str) -> str:
    payload = {
        "scope": scope,
        "method": request.method.upper(),
        "path": request.url.path,
        "query": request.url.query,
        "body_sha256": hashlib.sha256(body_bytes).hexdigest(),
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def execute_idempotent_json(
    request: Request,
    redis: Redis,
    *,
    scope: str,
    handler: Callable[[], Awaitable[Any]],
    ttl_seconds: int | None = None,
) -> Any:
    if not settings.idempotency_enabled:
        return await handler()

    idempotency_key = _normalize_idempotency_key(request.headers.get(IDEMPOTENCY_HEADER))
    if not idempotency_key:
        return await handler()

    body_bytes = await request.body()
    fingerprint = _fingerprint_request(request=request, body_bytes=body_bytes, scope=scope)
    redis_key = f"idempotency:{scope}:{idempotency_key}"
    cached_raw = await redis.get(redis_key)

    if cached_raw:
        try:
            cached = json.loads(cached_raw)
        except json.JSONDecodeError:
            cached = None
        if isinstance(cached, dict):
            cached_fingerprint = str(cached.get("fingerprint") or "")
            if cached_fingerprint != fingerprint:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Idempotency-Key was already used with different request payload",
                )
            cached_status = int(cached.get("status_code") or 200)
            cached_body = cached.get("response")
            return JSONResponse(
                status_code=cached_status,
                content=cached_body,
                headers={
                    IDEMPOTENCY_HEADER: idempotency_key,
                    "X-Idempotency-Replayed": "true",
                },
            )

    result = await handler()
    if isinstance(result, Response):
        return result

    encoded = jsonable_encoder(result)
    ttl = max(60, int(ttl_seconds or settings.idempotency_ttl_seconds))
    await redis.setex(
        redis_key,
        ttl,
        json.dumps(
            {
                "fingerprint": fingerprint,
                "status_code": 200,
                "response": encoded,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
    )
    return result
