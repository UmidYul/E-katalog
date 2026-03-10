from __future__ import annotations

import asyncio
import html
import random
import re
from decimal import Decimal
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from selectolax.parser import HTMLParser

from app.core.config import settings
from app.core.logging import logger
from app.parsers.base import ParseResult, ParsedProduct, StoreParser
from app.utils.http_client import ScraperHTTPClient
from app.utils.specs import normalize_product_specs


class AsaxiyParser(StoreParser):
    shop_name = "Asaxiy UZ"
    shop_url = str(settings.asaxiy_base_url)

    def __init__(self) -> None:
        self._http = ScraperHTTPClient(rate_limit_per_second=1)
        self._product_cache: dict[str, ParsedProduct] = {}
        self._request_lock = asyncio.Lock()
        self._next_request_at = 0.0
        self._retry_attempts = 3

    async def discover_product_links(self, category_url: str) -> list[str]:
        normalized_category_url = self._normalize_category_url(category_url)
        response = await self._get_with_retry(normalized_category_url, context="discover_product_links")
        source = response.text

        links = self._cache_listing_products(source, base_url=normalized_category_url)
        total_pages = max(1, self._extract_total_pages(source))
        page_limit = min(total_pages, 120)
        limit = max(0, settings.scrape_product_limit)
        empty_pages_in_row = 0

        for page in range(2, page_limit + 1):
            if limit and len(links) >= limit:
                break
            page_url = self._build_paginated_url(normalized_category_url, page)
            response = await self._get_with_retry(page_url, context="discover_product_links")
            page_links = self._cache_listing_products(response.text, base_url=page_url)
            new_links = [url for url in page_links if url not in links]
            links.extend(new_links)
            logger.info(
                "asaxiy_category_page_scraped",
                category_url=normalized_category_url,
                page=page,
                links_on_page=len(page_links),
                new_links=len(new_links),
                total_links=len(links),
            )

            if not page_links:
                empty_pages_in_row += 1
            else:
                empty_pages_in_row = 0
            if empty_pages_in_row >= 2:
                break

        unique_ordered = self._unique_preserve_order(links)
        if limit:
            return unique_ordered[:limit]
        return unique_ordered

    async def parse_product(self, product_url: str) -> ParsedProduct:
        normalized_url = self._normalize_product_url(product_url)
        if not normalized_url:
            raise ValueError("invalid product url")

        cached = self._product_cache.get(normalized_url)
        if cached is not None:
            return cached

        response = await self._get_with_retry(normalized_url, context="parse_product")
        source = response.text
        tree = HTMLParser(source)

        title = self._extract_product_title(tree, source) or "Unknown product"
        description = self._extract_meta(source, "description")
        price = self._extract_product_price(tree, source)
        old_price = self._extract_old_price(tree, source)
        availability = self._extract_product_availability(tree, source)
        images = self._extract_product_images(tree, source, normalized_url)
        raw_specs = self._extract_product_specs(tree)

        sku = self._extract_sku(tree, source)
        brand = self._extract_brand(tree, source)
        installment_price, installment_months = self._extract_installment_from_source(source)
        if sku:
            raw_specs.setdefault("sku", sku)
        if brand:
            raw_specs.setdefault("brand", brand)
        if installment_price is not None:
            raw_specs.setdefault("installment_monthly_uzs", str(int(installment_price)))
        if installment_months:
            raw_specs.setdefault("installment_months", installment_months)

        specs = normalize_product_specs(
            title=title,
            raw_specs=raw_specs,
            category_hint="smartphone",
            extra_text=description,
        )
        if sku:
            specs.setdefault("sku", sku)
        if brand:
            specs.setdefault("brand", brand)
        if installment_price is not None:
            specs.setdefault("installment_monthly_uzs", str(int(installment_price)))
        if installment_months:
            specs.setdefault("installment_months", installment_months)

        if price is None or price <= 0:
            raise ValueError("price not found")

        parsed = ParsedProduct(
            title=title,
            price=price,
            old_price=old_price,
            availability=availability,
            images=images,
            specifications=specs,
            product_url=normalized_url,
            description=description,
        )
        self._product_cache[normalized_url] = parsed
        return parsed

    async def parse_category(self, category_url: str) -> ParseResult:
        links = await self.discover_product_links(category_url)
        products: list[ParsedProduct] = []
        for link in links:
            try:
                products.append(await self.parse_product(link))
            except ValueError as exc:
                logger.warning("asaxiy_product_invalid", product_url=link, error=str(exc))
            except Exception as exc:  # noqa: BLE001
                logger.error("asaxiy_product_parse_failed", product_url=link, error=str(exc))
        return ParseResult(category_url=category_url, products=products)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _get_with_retry(self, url: str, *, context: str) -> httpx.Response:
        last_exc: Exception | None = None
        headers = {"Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"}

        # Network retries (3 attempts) with exponential backoff.
        for attempt in range(1, self._retry_attempts + 1):
            await self._wait_between_requests()
            try:
                return await self._http.get(url, headers=headers)
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                logger.warning(
                    "asaxiy_request_retry",
                    url=url,
                    context=context,
                    attempt=attempt,
                    max_attempts=self._retry_attempts,
                    error=str(exc),
                )
                if attempt >= self._retry_attempts:
                    break
                await asyncio.sleep(float(2 ** (attempt - 1)))

        assert last_exc is not None
        logger.error("asaxiy_request_failed", url=url, context=context, error=str(last_exc))
        raise last_exc

    async def _wait_between_requests(self) -> None:
        # Enforce 1-3s delay between outbound requests to asaxiy.uz.
        async with self._request_lock:
            now = asyncio.get_running_loop().time()
            sleep_for = max(0.0, self._next_request_at - now)
            if sleep_for > 0:
                await asyncio.sleep(sleep_for)
            self._next_request_at = asyncio.get_running_loop().time() + random.uniform(1.0, 3.0)

    def _cache_listing_products(self, source: str, *, base_url: str) -> list[str]:
        # Category pages are SSR: extract product cards and prefill cache to avoid per-item detail requests.
        tree = HTMLParser(source)
        containers = tree.css(".loading-more-product-list > div")
        links: list[str] = []

        for container in containers:
            card = container.css_first(".product__item")
            if card is None:
                continue

            link_node = card.css_first("a[href*='/product/']")
            if link_node is None:
                continue
            href = str(link_node.attributes.get("href") or "").strip()
            product_url = self._normalize_product_url(urljoin(base_url, href))
            if not product_url:
                continue
            links.append(product_url)

            product_data = container.css_first("span[id^='product_cart_data_']")
            title = ""
            brand = None
            sku = None
            image = None
            price = None
            old_price = None

            if product_data is not None:
                attrs = product_data.attributes
                title = self._clean_text(attrs.get("data-name") or attrs.get("data-name-ru") or "")
                brand = self._clean_text(attrs.get("data-brand-name") or "") or None
                raw_sku = self._clean_text(attrs.get("data-id") or "")
                if raw_sku:
                    sku = raw_sku if raw_sku.upper().startswith("T") else f"T{raw_sku}"
                image = self._normalize_image_url(attrs.get("data-img"), base_url=product_url)
                price = self._parse_decimal(attrs.get("data-price"))
                old_price = self._parse_decimal(attrs.get("data-old-price"))
                if old_price is not None and old_price <= 0:
                    old_price = None

            if not title:
                title_node = container.css_first(".product__item__info-title")
                title = self._clean_text(title_node.text(separator=" ", strip=True) if title_node else "")
            if not image:
                image_node = container.css_first("img[data-src]") or container.css_first("img[src]")
                raw_image = None
                if image_node is not None:
                    raw_image = image_node.attributes.get("data-src") or image_node.attributes.get("src")
                image = self._normalize_image_url(raw_image, base_url=product_url)
            if price is None:
                price_node = container.css_first(".product__item-price")
                price = self._parse_decimal(price_node.text(separator=" ", strip=True) if price_node else None)
            if old_price is None:
                old_price_node = container.css_first(".product__item-old--price")
                old_price = self._parse_decimal(old_price_node.text(separator=" ", strip=True) if old_price_node else None)

            availability = self._extract_listing_availability(container)
            installment_node = container.css_first(".installment__price")
            installment_text = installment_node.text(separator=" ", strip=True) if installment_node else ""
            installment_price, installment_months = self._extract_installment_from_source(installment_text)

            if not title or price is None or price <= 0:
                continue

            raw_specs: dict[str, str] = {}
            if sku:
                raw_specs["sku"] = sku
            if brand:
                raw_specs["brand"] = brand
            if installment_price is not None:
                raw_specs["installment_monthly_uzs"] = str(int(installment_price))
            if installment_months:
                raw_specs["installment_months"] = installment_months

            specs = normalize_product_specs(
                title=title,
                raw_specs=raw_specs,
                category_hint="smartphone",
            )
            if sku:
                specs.setdefault("sku", sku)
            if brand:
                specs.setdefault("brand", brand)
            if installment_price is not None:
                specs.setdefault("installment_monthly_uzs", str(int(installment_price)))
            if installment_months:
                specs.setdefault("installment_months", installment_months)

            self._product_cache[product_url] = ParsedProduct(
                title=title,
                price=price,
                old_price=old_price,
                availability=availability,
                images=[image] if image else [],
                specifications=specs,
                product_url=product_url,
                description=None,
            )

        return self._unique_preserve_order(links)

    @classmethod
    def _extract_total_pages(cls, source: str) -> int:
        candidates = [1]
        candidates.extend(int(page) for page in re.findall(r"/page=(\d+)", source))
        script_match = re.search(r"totalPages\s*=\s*parseInt\(['\"](\d+)['\"]", source, flags=re.IGNORECASE)
        if script_match:
            candidates.append(int(script_match.group(1)))
        return max(candidates)

    @staticmethod
    def _build_paginated_url(category_url: str, page: int) -> str:
        parts = urlsplit(category_url)
        clean_path = re.sub(r"/page=\d+(?=/|$)", "", parts.path).rstrip("/")
        if not clean_path:
            clean_path = "/"
        if page >= 2:
            clean_path = f"{clean_path}/page={page}"
        return urlunsplit((parts.scheme, parts.netloc, clean_path, parts.query, parts.fragment))

    def _normalize_category_url(self, category_url: str) -> str:
        absolute = urljoin(self.shop_url.rstrip("/") + "/", str(category_url or "").strip())
        parts = urlsplit(absolute)
        path = re.sub(r"/+$", "", parts.path) or "/"
        alias_map = {
            "/product/telefon": "/product/telefony-i-gadzhety/telefony/smartfony",
            "/uz/product/telefon": "/uz/product/telefony-i-gadzhety/telefony/smartfony",
        }
        path = alias_map.get(path, path)
        return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))

    @staticmethod
    def _normalize_product_url(url: str) -> str | None:
        parts = urlsplit(url)
        if parts.scheme not in {"http", "https"} or not parts.netloc:
            return None
        path = re.sub(r"/+$", "", parts.path)
        if "/product/" not in path:
            return None
        return urlunsplit((parts.scheme, parts.netloc, path, "", ""))

    @staticmethod
    def _extract_meta(source: str, key: str) -> str | None:
        patterns = (
            rf'<meta[^>]+name="{re.escape(key)}"[^>]+content="([^"]+)"',
            rf'<meta[^>]+property="{re.escape(key)}"[^>]+content="([^"]+)"',
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
    def _extract_product_title(cls, tree: HTMLParser, source: str) -> str | None:
        title_node = tree.css_first("h1[itemprop='name']") or tree.css_first("h1")
        if title_node is not None:
            title = cls._clean_text(title_node.text(separator=" ", strip=True))
            if title:
                return title

        meta_title = cls._extract_meta(source, "og:title")
        if meta_title:
            cleaned = re.sub(r"\s*[?•]+\s*купить.*$", "", meta_title, flags=re.IGNORECASE)
            cleaned = re.sub(r"\s+", " ", cleaned).strip(" -")
            if cleaned:
                return cleaned
        return None

    @classmethod
    def _extract_product_price(cls, tree: HTMLParser, source: str) -> Decimal | None:
        price_node = tree.css_first("[itemprop='price']")
        if price_node is not None:
            content = price_node.attributes.get("content")
            parsed = cls._parse_decimal(content)
            if parsed is not None:
                return parsed
            parsed = cls._parse_decimal(price_node.text(separator=" ", strip=True))
            if parsed is not None:
                return parsed

        card_node = tree.css_first("span[id^='product_cart_data_']")
        if card_node is not None:
            parsed = cls._parse_decimal(card_node.attributes.get("data-price"))
            if parsed is not None:
                return parsed

        script_price = re.search(r'"price"\s*:\s*"?(?P<price>[0-9][0-9\s.,]*)"?', source, flags=re.IGNORECASE)
        if script_price:
            parsed = cls._parse_decimal(script_price.group("price"))
            if parsed is not None:
                return parsed

        return None

    @classmethod
    def _extract_old_price(cls, tree: HTMLParser, source: str) -> Decimal | None:
        old_price_node = tree.css_first(".price-box_old-price")
        if old_price_node is not None:
            parsed = cls._parse_decimal(old_price_node.text(separator=" ", strip=True))
            if parsed is not None and parsed > 0:
                return parsed

        card_node = tree.css_first("span[id^='product_cart_data_']")
        if card_node is not None:
            parsed = cls._parse_decimal(card_node.attributes.get("data-old-price"))
            if parsed is not None and parsed > 0:
                return parsed

        legacy = re.search(r'"oldPrice"\s*:\s*"?(?P<price>[0-9][0-9\s.,]*)"?', source, flags=re.IGNORECASE)
        if legacy:
            parsed = cls._parse_decimal(legacy.group("price"))
            if parsed is not None and parsed > 0:
                return parsed
        return None

    @classmethod
    def _extract_product_availability(cls, tree: HTMLParser, source: str) -> str:
        availability_link = tree.css_first("link[itemprop='availability']")
        if availability_link is not None:
            href = str(availability_link.attributes.get("href") or "").lower()
            if "instock" in href:
                return "in_stock"
            if "outofstock" in href:
                return "out_of_stock"

        onclick_match = re.search(r"show_one_click_modal\(\s*`?\s*([01])", source)
        if onclick_match:
            return "in_stock" if onclick_match.group(1) == "1" else "out_of_stock"

        availability_lines = [
            cls._clean_text(node.text(separator=" ", strip=True))
            for node in tree.css(".text__content-name")
        ]
        availability_text = " ".join(part.lower() for part in availability_lines if part)
        if "в наличии" in availability_text or "mavjud" in availability_text:
            return "in_stock"
        if "нет в наличии" in availability_text or "out of stock" in availability_text or "mavjud emas" in availability_text:
            return "out_of_stock"
        return "unknown"

    @classmethod
    def _extract_listing_availability(cls, container) -> str:  # noqa: ANN001
        modal_button = container.css_first("button.open__one_click-modal")
        if modal_button is not None:
            onclick = str(modal_button.attributes.get("onclick") or "")
            match = re.search(r"show_one_click_modal\(\s*`?\s*([01])", onclick)
            if match:
                return "in_stock" if match.group(1) == "1" else "out_of_stock"

        if container.css_first("button.product__item-cart-new") is not None:
            return "in_stock"
        return "unknown"

    @classmethod
    def _extract_product_images(cls, tree: HTMLParser, source: str, product_url: str) -> list[str]:
        candidates: list[str] = []
        meta_image = cls._extract_meta(source, "og:image")
        if meta_image:
            normalized = cls._normalize_image_url(meta_image, base_url=product_url)
            if normalized:
                candidates.append(normalized)

        image_selectors = (".swiper-slide img", "img[itemprop='image']", ".product__item-img img")
        for selector in image_selectors:
            for img in tree.css(selector):
                raw = img.attributes.get("data-src") or img.attributes.get("src")
                normalized = cls._normalize_image_url(raw, base_url=product_url)
                if normalized:
                    candidates.append(normalized)

        unique: list[str] = []
        seen: set[str] = set()
        for image in candidates:
            if image in seen:
                continue
            seen.add(image)
            unique.append(image)
        return unique

    @classmethod
    def _extract_product_specs(cls, tree: HTMLParser) -> dict[str, str]:
        specs: dict[str, str] = {}
        for row in tree.css("#characteristics-content tr"):
            cells = row.css("td")
            if len(cells) < 2:
                continue
            key = cls._clean_text(cells[0].text(separator=" ", strip=True))
            value = cls._clean_text(cells[1].text(separator=" ", strip=True))
            if not key or not value:
                continue
            specs[key] = value
        return specs

    @classmethod
    def _extract_sku(cls, tree: HTMLParser, source: str) -> str | None:
        article_node = tree.css_first(".article-value[data-article]")
        if article_node is not None:
            value = cls._clean_text(article_node.attributes.get("data-article") or "")
            if value:
                return value

        sku_match = re.search(r'"item_id"\s*:\s*"SKU[_-]?([0-9]+)"', source, flags=re.IGNORECASE)
        if sku_match:
            return f"T{sku_match.group(1)}"
        return None

    @classmethod
    def _extract_brand(cls, tree: HTMLParser, source: str) -> str | None:
        brand_node = tree.css_first("[itemprop='brand'] [itemprop='name']")
        if brand_node is not None:
            value = cls._clean_text(brand_node.text(separator=" ", strip=True))
            if value:
                return value

        hidden_node = tree.css_first("span[id^='product_cart_data_']")
        if hidden_node is not None:
            value = cls._clean_text(hidden_node.attributes.get("data-brand-name") or "")
            if value:
                return value

        data_layer_brand = re.search(r'"item_brand"\s*:\s*"([^"]+)"', source, flags=re.IGNORECASE)
        if data_layer_brand:
            value = cls._clean_text(html.unescape(data_layer_brand.group(1)))
            if value:
                return value
        return None

    @classmethod
    def _extract_installment_from_source(cls, source: str) -> tuple[Decimal | None, str | None]:
        text = cls._clean_text(source)
        match = re.search(
            r"([0-9][0-9\s]{2,})\s*(?:сум|sum|сўм)\s*x\s*(\d{1,2})",
            text,
            flags=re.IGNORECASE,
        )
        if match:
            return cls._parse_decimal(match.group(1)), match.group(2)

        monthly_match = re.search(r"installment-monthly-graphics[^>]*>\s*([0-9][0-9\s]{2,})\s*<", source, flags=re.IGNORECASE)
        if monthly_match:
            return cls._parse_decimal(monthly_match.group(1)), None
        return None, None

    @staticmethod
    def _normalize_image_url(value: str | None, *, base_url: str) -> str | None:
        if not value:
            return None
        raw = str(value).strip()
        if not raw or raw.startswith("data:"):
            return None
        if raw.startswith("//"):
            raw = "https:" + raw
        return urljoin(base_url, raw)

    @staticmethod
    def _parse_decimal(raw: object) -> Decimal | None:
        if raw is None:
            return None
        if isinstance(raw, Decimal):
            return raw
        if isinstance(raw, (int, float)):
            try:
                return Decimal(str(raw))
            except Exception:  # noqa: BLE001
                return None

        text = str(raw)
        normalized = "".join(ch for ch in text if ch.isdigit() or ch in {".", ","}).replace(",", ".")
        if not normalized:
            return None
        if normalized.count(".") > 1:
            return None
        try:
            value = Decimal(normalized)
        except Exception:  # noqa: BLE001
            return None
        return value if value >= 0 else None

    @staticmethod
    def _clean_text(value: object) -> str:
        return re.sub(r"\s+", " ", str(value or "").replace("\xa0", " ")).strip()

    @staticmethod
    def _unique_preserve_order(values: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            out.append(value)
        return out
