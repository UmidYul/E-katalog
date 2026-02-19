from __future__ import annotations

import time

from fastapi import HTTPException, Request
from redis.asyncio import Redis


async def enforce_rate_limit(
    request: Request,
    redis: Redis,
    *,
    bucket: str,
    limit: int,
    window_seconds: int = 60,
) -> None:
    client_ip = request.client.host if request.client else "unknown"
    now = int(time.time())
    slot = now // window_seconds
    key = f"rl:{bucket}:{client_ip}:{slot}"

    current = await redis.incr(key)
    if current == 1:
        await redis.expire(key, window_seconds + 2)
    if current > limit:
        raise HTTPException(status_code=429, detail="rate limit exceeded")
