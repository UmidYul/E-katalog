from __future__ import annotations

import html
import re
from decimal import Decimal
from urllib.parse import urljoin, urlsplit, urlunsplit

from app.core.config import settings
from app.parsers.base import ParseResult, ParsedProduct, StoreParser
from app.utils.http_client import ScraperHTTPClient
from app.utils.specs import normalize_product_specs


class AlifshopParser(StoreParser):
    shop_name = "Alifshop UZ"
    shop_url = str(settings.alifshop_base_url)

    def __init__(self) -> None:
        self._http = ScraperHTTPClient(rate_limit_per_second=1)
        self._product_cache: dict[str, ParsedProduct] = {}

    async def discover_product_links(self, category_url: str) -> list[str]:
        response = await self._http.get(category_url)
        source = response.text.replace("\\/", "/")
        links: set[str] = set()
        patterns = (
            r"https?://[^\"'\s<>]*/(?:ru|uz)/moderated-offer/[^\"'\s<>]+",
            r"/(?:ru|uz)/moderated-offer/[^\"'\s<>]+",
        )
        for pattern in patterns:
            for match in re.findall(pattern, source, flags=re.IGNORECASE):
                normalized = self._normalize_product_url(urljoin(category_url, match))
                if normalized:
                    links.add(normalized)

        ordered = sorted(links)
        limit = max(0, settings.scrape_product_limit)
        if limit:
            return ordered[:limit]
        return ordered

    async def parse_product(self, product_url: str) -> ParsedProduct:
        cached = self._product_cache.get(product_url)
        if cached:
            return cached

        response = await self._http.get(product_url)
        source = response.text

        title = self._extract_title(source) or "Unknown product"
        price = self._extract_price(source)
        if price is None:
            raise ValueError("price not found")

        availability = self._extract_availability(source)
        images = self._extract_images(source, product_url)
        description = self._extract_meta(source, "description")
        specs = normalize_product_specs(title, {}, category_hint="smartphone", extra_text=description)

        parsed = ParsedProduct(
            title=title,
            price=price,
            old_price=None,
            availability=availability,
            images=images,
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

    @staticmethod
    def _normalize_product_url(url: str) -> str | None:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return None
        if not re.search(r"/(?:ru|uz)/moderated-offer/", parsed.path, flags=re.IGNORECASE):
            return None
        normalized_path = re.sub(r"/+$", "", parsed.path)
        return urlunsplit((parsed.scheme, parsed.netloc, normalized_path, "", ""))

    @staticmethod
    def _extract_meta(source: str, name_or_property: str) -> str | None:
        patterns = (
            rf'<meta[^>]+name="{re.escape(name_or_property)}"[^>]+content="([^"]+)"',
            rf'<meta[^>]+property="{re.escape(name_or_property)}"[^>]+content="([^"]+)"',
        )
        for pattern in patterns:
            match = re.search(pattern, source, flags=re.IGNORECASE)
            if not match:
                continue
            value = html.unescape(match.group(1)).strip()
            if value:
                return value
        return None

    @classmethod
    def _extract_title(cls, source: str) -> str | None:
        title = None
        title_match = re.search(r"<title>(.*?)</title>", source, flags=re.IGNORECASE | re.DOTALL)
        if title_match:
            title = html.unescape(title_match.group(1)).strip()
        if not title:
            title = cls._extract_meta(source, "og:title")
        if not title:
            return None
        title = re.sub(r"^\s*E-BOZOR\s*-\s*", "", title, flags=re.IGNORECASE)
        title = re.sub(r"^\s*Купить\s+", "", title, flags=re.IGNORECASE)
        title = re.sub(r"\s+онлайн\s+с\s+доставкой.*$", "", title, flags=re.IGNORECASE)
        title = re.sub(r"\s+", " ", title).strip(" -")
        return title or None

    @classmethod
    def _extract_price(cls, source: str) -> Decimal | None:
        raw = cls._extract_meta(source, "product:price:amount")
        if raw:
            parsed = cls._parse_decimal(raw)
            if parsed is not None:
                return parsed
        return None

    @staticmethod
    def _extract_availability(source: str) -> str:
        raw = AlifshopParser._extract_meta(source, "product:availability")
        if not raw:
            return "unknown"
        lowered = raw.lower()
        if "in stock" in lowered:
            return "in_stock"
        if "out of stock" in lowered:
            return "out_of_stock"
        return "unknown"

    @classmethod
    def _extract_images(cls, source: str, product_url: str) -> list[str]:
        candidates = []
        for key in ("og:image", "twitter:image"):
            value = cls._extract_meta(source, key)
            if value:
                candidates.append(urljoin(product_url, value))
        unique: list[str] = []
        seen: set[str] = set()
        for item in candidates:
            if item in seen:
                continue
            seen.add(item)
            unique.append(item)
        return unique

    @staticmethod
    def _parse_decimal(value: str) -> Decimal | None:
        filtered = "".join(ch for ch in value if ch.isdigit() or ch in {".", ","}).replace(",", ".")
        if not filtered:
            return None
        try:
            return Decimal(filtered)
        except Exception:  # noqa: BLE001
            return None
