from __future__ import annotations

import hashlib
import json
from typing import Any

from redis.asyncio import Redis


class CacheService:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis

    @staticmethod
    def key(prefix: str, payload: dict[str, Any]) -> str:
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        return f"{prefix}:{digest}"

    async def get_json(self, key: str) -> Any | None:
        raw = await self.redis.get(key)
        if raw is None:
            return None
        return json.loads(raw)

    async def set_json(self, key: str, value: Any, ttl_seconds: int) -> None:
        await self.redis.set(key, json.dumps(value, default=str), ex=ttl_seconds)
