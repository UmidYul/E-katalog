from __future__ import annotations

import asyncio
import random
from collections import defaultdict
from contextlib import asynccontextmanager
from time import monotonic
from urllib.parse import urlparse

from app.core.config import settings


class DomainLimiter:
    def __init__(self) -> None:
        self._semaphores: dict[str, asyncio.Semaphore] = {}
        self._gate_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._next_allowed_at: dict[str, float] = {}
        self._domain_slot_index: dict[str, int] = defaultdict(int)
        self._index_lock = asyncio.Lock()

    @asynccontextmanager
    async def acquire(self, url: str):
        host = (urlparse(url).hostname or "").lower().strip()
        if not host:
            host = "unknown"
        slot_key = await self._resolve_slot_key(host)
        semaphore = self._semaphores.get(slot_key)
        if semaphore is None:
            concurrency, _ = settings.scrape_limits_for_host(host)
            semaphore = asyncio.Semaphore(max(1, int(concurrency)))
            self._semaphores[slot_key] = semaphore

        async with semaphore:
            await self._wait_with_jitter(slot_key=slot_key, host=host)
            yield

    async def _resolve_slot_key(self, host: str) -> str:
        proxies = settings.proxies_for_host(host)
        slots = ["direct", *proxies]
        if len(slots) <= 1:
            return f"{host}|direct"
        async with self._index_lock:
            index = int(self._domain_slot_index[host] % len(slots))
            self._domain_slot_index[host] = index + 1
            selected = slots[index]
        return f"{host}|{selected}"

    async def _wait_with_jitter(self, *, slot_key: str, host: str) -> None:
        _, base_delay = settings.scrape_limits_for_host(host)
        if base_delay <= 0:
            return
        jitter_ratio = max(0.0, min(1.0, float(settings.scrape_delay_jitter_ratio)))
        jitter_factor = random.uniform(1.0 - jitter_ratio, 1.0 + jitter_ratio)
        delay = max(0.0, base_delay * jitter_factor)
        lock = self._gate_locks[slot_key]
        async with lock:
            now = monotonic()
            next_allowed = float(self._next_allowed_at.get(slot_key, 0.0))
            sleep_for = max(0.0, next_allowed - now)
            if sleep_for > 0:
                await asyncio.sleep(sleep_for)
                now = monotonic()
            self._next_allowed_at[slot_key] = now + delay
