from collections.abc import Mapping

import httpx

from app.core.config import settings
from app.core.errors import UpstreamRateLimitedError
from app.utils.proxy import ProxyRotator
from app.utils.rate_limiter import AsyncRateLimiter
from app.utils.user_agent import UserAgentRotator


class ScraperHTTPClient:
    def __init__(self, *, rate_limit_per_second: int = 5) -> None:
        self._rate_limiter = AsyncRateLimiter(rate=rate_limit_per_second)
        self._proxy_rotator = ProxyRotator(settings.proxies)
        self._ua_rotator = UserAgentRotator(settings.user_agents)
        verify: bool | str = settings.http_verify_ssl
        if settings.http_ca_bundle:
            verify = settings.http_ca_bundle
        self._client_kwargs = {
            "timeout": settings.default_timeout_seconds,
            "follow_redirects": True,
            "verify": verify,
        }
        self._client = httpx.AsyncClient(**self._client_kwargs)
        self._proxy_clients: dict[str, httpx.AsyncClient] = {}

    async def get(self, url: str, *, headers: Mapping[str, str] | None = None) -> httpx.Response:
        await self._rate_limiter.acquire()
        merged_headers = dict(headers or {})
        merged_headers["User-Agent"] = self._ua_rotator.next()
        proxy = self._proxy_rotator.next_proxy()
        client = self._get_client(proxy)
        response = await client.get(url, headers=merged_headers)
        body_lower = response.text.lower()
        if response.status_code in {403, 429, 503} and ("error 1015" in body_lower or "you are being rate limited" in body_lower):
            raise UpstreamRateLimitedError(f"upstream blocked requests for {url} (cloudflare 1015)")
        response.raise_for_status()
        return response

    def _get_client(self, proxy: str | None) -> httpx.AsyncClient:
        if not proxy:
            return self._client

        existing = self._proxy_clients.get(proxy)
        if existing:
            return existing

        try:
            client = httpx.AsyncClient(proxy=proxy, **self._client_kwargs)
        except TypeError:
            client = httpx.AsyncClient(proxies=proxy, **self._client_kwargs)
        self._proxy_clients[proxy] = client
        return client

    async def aclose(self) -> None:
        await self._client.aclose()
        for client in self._proxy_clients.values():
            await client.aclose()
