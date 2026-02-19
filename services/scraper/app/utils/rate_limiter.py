import asyncio
import time


class AsyncRateLimiter:
    def __init__(self, rate: int, period: float = 1.0) -> None:
        self._rate = rate
        self._period = period
        self._allowance = rate
        self._last_check = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        while True:
            async with self._lock:
                current = time.monotonic()
                elapsed = current - self._last_check
                self._last_check = current
                self._allowance += elapsed * (self._rate / self._period)
                if self._allowance > self._rate:
                    self._allowance = self._rate
                if self._allowance >= 1.0:
                    self._allowance -= 1.0
                    return
            await asyncio.sleep(self._period / self._rate)
