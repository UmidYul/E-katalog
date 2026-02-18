from collections.abc import Mapping

import httpx

from app.core.config import settings
from app.utils.proxy import ProxyRotator
from app.utils.rate_limiter import AsyncRateLimiter
from app.utils.user_agent import UserAgentRotator


class ScraperHTTPClient:
    def __init__(self, *, rate_limit_per_second: int = 5) -> None:
        self._rate_limiter = AsyncRateLimiter(rate=rate_limit_per_second)
        self._proxy_rotator = ProxyRotator(settings.proxies)
        self._ua_rotator = UserAgentRotator(settings.user_agents)
        self._client = httpx.AsyncClient(timeout=settings.default_timeout_seconds, follow_redirects=True)

    async def get(self, url: str, *, headers: Mapping[str, str] | None = None) -> httpx.Response:
        await self._rate_limiter.acquire()
        merged_headers = dict(headers or {})
        merged_headers["User-Agent"] = self._ua_rotator.next()
        proxy = self._proxy_rotator.next_proxy()
        response = await self._client.get(url, headers=merged_headers, proxy=proxy)
        response.raise_for_status()
        return response

    async def aclose(self) -> None:
        await self._client.aclose()
