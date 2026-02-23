from __future__ import annotations

import html
import re
from decimal import Decimal
from urllib.parse import urljoin, urlsplit, urlunsplit

from app.core.config import settings
from app.parsers.base import ParseResult, ParsedProduct, ParsedVariant, StoreParser
from app.utils.http_client import ScraperHTTPClient
from app.utils.specs import normalize_product_specs
from app.utils.variants import infer_variants


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
        raw_specs = self._extract_specs(source)
        specs = normalize_product_specs(title, raw_specs, category_hint="smartphone", extra_text=description)
        variants = infer_variants(
            title=title,
            specs=specs,
            source_text=description or "",
            price=price,
            old_price=None,
            availability=availability,
            images=images,
            product_url=product_url,
            color_image_map=self._extract_color_image_map(source),
        )
        variants = self._filter_variants_by_primary_color(variants, specs.get("color"), title)

        parsed = ParsedProduct(
            title=title,
            price=price,
            old_price=None,
            availability=availability,
            images=images,
            specifications=specs,
            product_url=product_url,
            description=description,
            variants=variants,
        )
        self._product_cache[product_url] = parsed
        return parsed

    @staticmethod
    def _normalize_color_token(value: str | None) -> str:
        token = re.sub(r"[^a-zA-Z\u0400-\u04FF0-9]+", " ", str(value or "").lower())
        return re.sub(r"\s+", " ", token).strip()

    def _filter_variants_by_primary_color(
        self,
        variants: list[ParsedVariant],
        primary_color: str | None,
        title: str,
    ) -> list[ParsedVariant]:
        if not variants:
            return variants
        anchor = primary_color or self._extract_color_from_source(title)
        normalized_anchor = self._normalize_color_token(anchor)
        if not normalized_anchor:
            return variants

        filtered = [variant for variant in variants if self._normalize_color_token(variant.color) == normalized_anchor]
        return filtered or variants

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
        title = re.sub(r"^\s*\u041a\u0443\u043f\u0438\u0442\u044c\s+", "", title, flags=re.IGNORECASE)
        title = re.sub(
            r"\s+\u043e\u043d\u043b\u0430\u0439\u043d\s+\u0441\s+\u0434\u043e\u0441\u0442\u0430\u0432\u043a\u043e\u0439.*$",
            "",
            title,
            flags=re.IGNORECASE,
        )
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
        normalized_source = source.replace("\\/", "/")
        candidates: list[str] = []
        for key in ("og:image", "twitter:image"):
            value = cls._extract_meta(source, key)
            if value:
                candidates.append(urljoin(product_url, value))
        candidates.extend(
            re.findall(
                r"https?://s3\.fortifai\.uz/shop/moderation/[^\"'\s<>]+",
                normalized_source,
                flags=re.IGNORECASE,
            )
        )
        unique: list[str] = []
        seen: set[str] = set()
        for item in candidates:
            if item in seen:
                continue
            seen.add(item)
            unique.append(item)
        return unique

    @classmethod
    def _extract_specs(cls, source: str) -> dict[str, str]:
        normalized = source.replace("\\/", "/")
        specs: dict[str, str] = {}
        specs_rows_patterns = (
            re.compile(
                r'<div[^>]*border-b[^>]*>\s*<div[^>]*>\s*<p[^>]*>(?P<key>.*?)</p>\s*<div[^>]*whitespace-break-spaces[^>]*>(?P<value>.*?)</div>',
                flags=re.IGNORECASE | re.DOTALL,
            ),
            re.compile(
                r'<p[^>]*max-w-\[320px\][^>]*>(?P<key>.*?)</p>\s*<div[^>]*whitespace-break-spaces[^>]*>(?P<value>.*?)</div>',
                flags=re.IGNORECASE | re.DOTALL,
            ),
        )

        def pick_preferred(current: str | None, candidate: str) -> str:
            if not current:
                return candidate
            return candidate if len(candidate) > len(current) else current

        for pattern in specs_rows_patterns:
            for match in pattern.finditer(normalized):
                key = cls._strip_html(match.group("key"))
                value = cls._strip_html(match.group("value"))
                if not key or not value:
                    continue
                if len(key) > 140 or len(value) > 300:
                    continue
                specs[key] = pick_preferred(specs.get(key), value)

        storage_match = re.search(r"(?<!\d)(16|32|64|128|256|512|1024|2048)\s*(?:GB|\u0413\u0411)\b", normalized, flags=re.IGNORECASE)
        if storage_match:
            specs["storage_gb"] = storage_match.group(1)

        color = cls._extract_color_from_specs(specs) or cls._extract_color_from_source(normalized)
        if color:
            specs["color"] = color

        return specs

    @staticmethod
    def _is_valid_color_candidate(value: str) -> bool:
        normalized = re.sub(r"\s+", " ", value).strip().strip('"').strip("'")
        if not normalized:
            return False
        lowered = normalized.lower()
        if lowered in {"value", "values", "name", "names", "title", "titles", "slug", "image", "images", "null"}:
            return False
        if re.fullmatch(r"\d+", normalized):
            return False
        return True

    @classmethod
    def _extract_color_from_specs(cls, specs: dict[str, str]) -> str | None:
        for key, value in specs.items():
            key_l = str(key).lower()
            if any(token in key_l for token in ("color", "rang", "\u0446\u0432\u0435\u0442")) and cls._is_valid_color_candidate(str(value)):
                return re.sub(r"\s+", " ", str(value)).strip()
        return None

    @classmethod
    def _extract_color_from_source(cls, source: str) -> str | None:
        patterns = (
            r"(?:\"\u0426\u0432\u0435\u0442\"|\"Color\"|\"Rang\").{0,240}\"([A-Za-z\u0400-\u04FF][A-Za-z\u0400-\u04FF\s-]{2,40})\"",
            r"\b(?:deep blue|cosmic orange|mist blue|silver|black|white|blue|green|pink|yellow|graphite|midnight)\b",
        )
        for pattern in patterns:
            match = re.search(pattern, source, flags=re.IGNORECASE | re.DOTALL)
            if not match:
                continue
            value = match.group(1) if match.groups() else match.group(0)
            normalized = re.sub(r"\s+", " ", value).strip().strip('"')
            if cls._is_valid_color_candidate(normalized):
                return normalized
        return None

    @staticmethod
    def _extract_color_image_map(source: str) -> dict[str, str]:
        normalized = source.replace("\\/", "/")
        mapping: dict[str, str] = {}
        for name, image in re.findall(
            r"\"([A-Za-z][A-Za-z\s-]{2,32})\",\"(https?://s3\.fortifai\.uz/shop/moderation/[^\"'\s<>]+)\"",
            normalized,
            flags=re.IGNORECASE,
        ):
            clean_name = re.sub(r"\s+", " ", name).strip()
            if not clean_name:
                continue
            mapping[clean_name.lower()] = image
        return mapping

    @staticmethod
    def _strip_html(raw: str) -> str:
        text = re.sub(r"<[^>]+>", " ", str(raw))
        text = html.unescape(text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    @staticmethod
    def _parse_decimal(value: str) -> Decimal | None:
        filtered = "".join(ch for ch in value if ch.isdigit() or ch in {".", ","}).replace(",", ".")
        if not filtered:
            return None
        try:
            return Decimal(filtered)
        except Exception:  # noqa: BLE001
            return None
