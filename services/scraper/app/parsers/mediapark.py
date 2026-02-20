from __future__ import annotations

import json
import re
import asyncio
from decimal import Decimal
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from playwright.async_api import Browser, BrowserContext, Playwright, async_playwright

from app.ai.spec_extractor import ai_extract_specs
from app.core.config import settings
from app.core.errors import UpstreamRateLimitedError
from app.core.logging import logger
from app.parsers.base import ParseResult, ParsedProduct, StoreParser
from app.utils.http_client import ScraperHTTPClient
from app.utils.specs import missing_required_fields, needs_ai_enrichment, normalize_product_specs


class MediaParkParser(StoreParser):
    shop_name = "Mediapark"
    shop_url = str(settings.mediapark_base_url)

    def __init__(self) -> None:
        self._http = ScraperHTTPClient(rate_limit_per_second=6)
        self._product_cache: dict[str, ParsedProduct] = {}
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._browser_context: BrowserContext | None = None
        self._playwright_lock = asyncio.Lock()
        self._playwright_semaphore = asyncio.Semaphore(2)

    async def discover_product_links(self, category_url: str) -> list[str]:
        links: set[str] = set()
        empty_pages_in_row = 0
        max_pages = 12
        limit = max(0, settings.scrape_product_limit)

        for page in range(1, max_pages + 1):
            page_url = self._build_paginated_url(category_url, page)
            response = await self._http.get(page_url)
            self._raise_if_rate_limited_page(response.text, page_url)

            page_links = self._extract_product_links(response.text, base_url=page_url)
            page_links_set = set(page_links)
            new_links = page_links_set - links
            links.update(page_links_set)

            logger.info(
                "mediapark_category_page_scraped",
                category_url=category_url,
                page=page,
                links_on_page=len(page_links_set),
                new_links=len(new_links),
                total_links=len(links),
            )

            if not page_links_set:
                empty_pages_in_row += 1
            elif not new_links and page > 1:
                empty_pages_in_row += 1
            else:
                empty_pages_in_row = 0

            if empty_pages_in_row >= 2:
                break
            if limit and len(links) >= limit:
                break

        discovered = sorted(links)
        if limit:
            return discovered[:limit]
        return discovered

    async def parse_product(self, product_url: str) -> ParsedProduct:
        cached = self._product_cache.get(product_url)
        if cached:
            return cached

        response = await self._http.get(product_url)
        html = response.text
        self._raise_if_rate_limited_page(html, product_url)

        product_schema = self._extract_product_schema(html)
        title = self._extract_title(product_schema, html) or "Unknown product"
        price = self._extract_price(product_schema, html)
        if price is None:
            raise ValueError("price not found")
        description = self._extract_description(product_schema)
        raw_specs = await self._extract_specs_with_playwright(product_url)
        specs = await self._build_specs(title=title, description=description, raw_specs=raw_specs)

        parsed = ParsedProduct(
            title=title,
            price=price,
            old_price=None,
            availability=self._extract_availability(product_schema),
            images=self._extract_images(product_schema, html, product_url),
            specifications=specs,
            product_url=product_url,
            description=description,
        )
        self._product_cache[product_url] = parsed
        return parsed

    async def parse_category(self, category_url: str) -> ParseResult:
        links = await self.discover_product_links(category_url)
        products = [await self.parse_product(link) for link in links]
        return ParseResult(category_url=category_url, products=products)

    async def aclose(self) -> None:
        await self._http.aclose()
        if self._browser_context is not None:
            await self._browser_context.close()
            self._browser_context = None
        if self._browser is not None:
            await self._browser.close()
            self._browser = None
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None

    @staticmethod
    def _extract_product_schema(html: str) -> dict:
        scripts = re.findall(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )
        for raw_script in scripts:
            raw_script = raw_script.strip()
            if not raw_script:
                continue
            try:
                payload = json.loads(raw_script)
            except json.JSONDecodeError:
                continue

            if isinstance(payload, dict) and payload.get("@type") == "Product":
                return payload
            if isinstance(payload, list):
                for entry in payload:
                    if isinstance(entry, dict) and entry.get("@type") == "Product":
                        return entry
        return {}

    @staticmethod
    def _extract_title(product_schema: dict, html: str) -> str | None:
        name = product_schema.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()

        match = re.search(
            r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
            html,
            flags=re.IGNORECASE,
        )
        if not match:
            return None
        title = match.group(1).strip()
        if " | " in title:
            title = title.split(" | ", 1)[0].strip()
        return title or None

    @staticmethod
    def _extract_price(product_schema: dict, html: str) -> Decimal | None:
        offers = product_schema.get("offers")
        if isinstance(offers, dict):
            parsed = MediaParkParser._parse_decimal(offers.get("price"))
            if parsed is not None:
                return parsed

        match = re.search(r'"price"\s*:\s*([0-9][0-9\s.,]*)', html, flags=re.IGNORECASE)
        if match:
            return MediaParkParser._parse_decimal(match.group(1))
        return None

    @staticmethod
    def _extract_availability(product_schema: dict) -> str:
        offers = product_schema.get("offers")
        if not isinstance(offers, dict):
            return "unknown"
        value = str(offers.get("availability") or "").lower()
        if "instock" in value:
            return "in_stock"
        if "outofstock" in value:
            return "out_of_stock"
        return "unknown"

    @staticmethod
    def _extract_description(product_schema: dict) -> str | None:
        description = product_schema.get("description")
        if isinstance(description, str):
            description = description.strip()
            return description or None
        return None

    @staticmethod
    def _extract_images(product_schema: dict, html: str, product_url: str) -> list[str]:
        images: list[str] = []
        raw_images = product_schema.get("image")
        if isinstance(raw_images, str):
            raw_images = [raw_images]
        if isinstance(raw_images, list):
            for value in raw_images:
                if not isinstance(value, str):
                    continue
                url = value.strip()
                if not url:
                    continue
                images.append(urljoin(product_url, url))

        if not images:
            match = re.search(
                r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
                html,
                flags=re.IGNORECASE,
            )
            if match:
                images.append(urljoin(product_url, match.group(1).strip()))

        unique: list[str] = []
        seen: set[str] = set()
        for image in images:
            if image in seen:
                continue
            seen.add(image)
            unique.append(image)
        return unique

    @staticmethod
    def _extract_product_links(html: str, *, base_url: str) -> list[str]:
        normalized_html = html.replace("\\/", "/")
        candidates = re.findall(
            r'(https?://[^"\'\s<>]*/products/view/[^"\'\s<>]+|/products/view/[^"\'\s<>]+)',
            normalized_html,
        )

        links: set[str] = set()
        for candidate in candidates:
            clean = candidate.strip().rstrip("\\").rstrip(",")
            absolute = urljoin(base_url, clean)
            if MediaParkParser._is_product_url(absolute):
                links.add(absolute)
        return sorted(links)

    @staticmethod
    def _build_paginated_url(category_url: str, page: int) -> str:
        if page <= 1:
            return category_url
        parts = urlsplit(category_url)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        query["page"] = str(page)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))

    @staticmethod
    def _is_product_url(url: str) -> bool:
        return bool(re.fullmatch(r"https?://[^/]+/products/view/[^/?#]+", url))

    @staticmethod
    def _parse_decimal(raw: object) -> Decimal | None:
        if raw is None:
            return None
        if isinstance(raw, (int, float, Decimal)):
            try:
                return Decimal(str(raw))
            except Exception:  # noqa: BLE001
                return None

        filtered = "".join(ch for ch in str(raw) if ch.isdigit() or ch in {".", ","}).replace(",", ".")
        if not filtered:
            return None
        try:
            return Decimal(filtered)
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _raise_if_rate_limited_page(html: str, url: str) -> None:
        lowered = html.lower()
        if "error 1015" in lowered and "you are being rate limited" in lowered:
            raise UpstreamRateLimitedError(f"upstream blocked requests for {url} (cloudflare 1015)")

    async def _build_specs(self, *, title: str, description: str | None, raw_specs: dict[str, str]) -> dict[str, str]:
        specs = normalize_product_specs(
            title=title,
            raw_specs=raw_specs,
            category_hint="smartphone",
            extra_text=description,
        )
        if not settings.ai_spec_enrichment_enabled:
            return specs
        if not needs_ai_enrichment(specs):
            return specs

        ai_specs = await ai_extract_specs(
            title=title,
            description=description,
            category_hint="smartphone",
        )
        for key, value in ai_specs.items():
            specs.setdefault(key, value)

        if settings.ai_spec_strict_mode:
            for _ in range(max(0, settings.ai_spec_max_attempts - 1)):
                required = missing_required_fields(specs)
                if not required:
                    break
                ai_specs = await ai_extract_specs(
                    title=title,
                    description=description,
                    category_hint="smartphone",
                    required_keys=required,
                )
                for key, value in ai_specs.items():
                    specs.setdefault(key, value)

        return specs

    async def _ensure_playwright_context(self) -> BrowserContext:
        if self._browser_context is not None:
            return self._browser_context

        async with self._playwright_lock:
            if self._browser_context is not None:
                return self._browser_context
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(headless=settings.playwright_headless)
            self._browser_context = await self._browser.new_context()
            return self._browser_context

    async def _extract_specs_with_playwright(self, product_url: str) -> dict[str, str]:
        async with self._playwright_semaphore:
            try:
                context = await self._ensure_playwright_context()
                page = await context.new_page()
                await page.goto(product_url, wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(1200)
                # Some pages keep full specs behind this tab.
                try:
                    tab = page.get_by_text("Характеристики", exact=True).first
                    if await tab.count() > 0:
                        await tab.click(timeout=2000)
                        await page.wait_for_timeout(700)
                except Exception:  # noqa: BLE001
                    pass

                body_text = await page.inner_text("body")
                await page.close()
                return self._parse_specs_from_page_text(body_text)
            except Exception as exc:  # noqa: BLE001
                logger.warning("mediapark_specs_playwright_failed", product_url=product_url, error=str(exc))
                return {}

    @staticmethod
    def _parse_specs_from_page_text(text: str) -> dict[str, str]:
        lines = [line.strip() for line in text.splitlines() if line and line.strip()]
        if not lines:
            return {}

        indices = [idx for idx, line in enumerate(lines) if line == "Характеристики"]
        if not indices:
            return {}

        best_start = indices[-1]
        best_score = -1
        for idx in indices:
            chunk = lines[idx + 1 : idx + 60]
            score = sum(1 for line in chunk if line.endswith(":"))
            if score > best_score:
                best_score = score
                best_start = idx

        stop_markers = {"Наличие в магазинах", "Отзывы", "Описание", "Похожие товары", "Все товары"}
        specs: dict[str, str] = {}
        i = best_start + 1
        while i < len(lines):
            line = lines[i]
            if line in stop_markers and specs:
                break

            if line.endswith(":"):
                key = line[:-1].strip()
                value = ""
                if i + 1 < len(lines):
                    nxt = lines[i + 1].strip()
                    if nxt and not nxt.endswith(":") and nxt not in stop_markers:
                        value = nxt
                        i += 1
                if key and value:
                    specs[key] = value
            elif ":" in line and len(line) < 160:
                # Single-line fallback: "Ключ: значение"
                key, value = line.split(":", 1)
                key = key.strip()
                value = value.strip()
                if key and value:
                    specs[key] = value
            i += 1

        return specs
