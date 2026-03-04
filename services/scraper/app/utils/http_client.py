import asyncio
from collections.abc import Mapping
from urllib.parse import urlparse

import httpx

from app.core.config import settings
from app.core.errors import UpstreamRateLimitedError
from app.utils.rate_limiter import AsyncRateLimiter
from app.utils.user_agent import UserAgentRotator


class ScraperHTTPClient:
    def __init__(self, *, rate_limit_per_second: int = 5) -> None:
        self._rate_limiter = AsyncRateLimiter(rate=rate_limit_per_second)
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
        attempt_proxies = self._build_attempt_proxies(url)
        for attempt_idx, proxy in enumerate(attempt_proxies):
            await self._rate_limiter.acquire()
            merged_headers = dict(headers or {})
            merged_headers["User-Agent"] = self._ua_rotator.next()
            client = self._get_client(proxy)
            response = await client.get(url, headers=merged_headers)

            if not self._is_retryable_rate_limit(response):
                response.raise_for_status()
                return response

            if attempt_idx < len(attempt_proxies) - 1:
                await asyncio.sleep(self._backoff_seconds(attempt_idx))
                continue

            if self._is_cloudflare_1015(response):
                raise UpstreamRateLimitedError(f"upstream blocked requests for {url} (cloudflare 1015)")
            response.raise_for_status()

        raise RuntimeError("unreachable: retry loop ended without returning")

    def _build_attempt_proxies(self, url: str) -> list[str | None]:
        host = urlparse(url).hostname
        domain_proxies = settings.proxies_for_host(host)
        unique_proxies: list[str] = []
        for proxy in domain_proxies:
            if proxy not in unique_proxies:
                unique_proxies.append(proxy)

        attempts: list[str | None] = [None]
        if unique_proxies:
            attempts.append(unique_proxies[0])
        if len(unique_proxies) > 1:
            attempts.append(unique_proxies[1])
        return attempts

    @staticmethod
    def _backoff_seconds(attempt_idx: int) -> float:
        return float(2**attempt_idx)

    @staticmethod
    def _is_cloudflare_1015(response: httpx.Response) -> bool:
        body_lower = response.text.lower()
        return "error 1015" in body_lower and "you are being rate limited" in body_lower

    def _is_retryable_rate_limit(self, response: httpx.Response) -> bool:
        if self._is_cloudflare_1015(response):
            return True
        return response.status_code in {429, 503}

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
