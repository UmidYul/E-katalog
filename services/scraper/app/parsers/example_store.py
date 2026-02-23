from __future__ import annotations

import asyncio
import json
import re
from decimal import Decimal
from urllib.parse import urljoin, urlparse

from playwright.async_api import async_playwright
from selectolax.parser import HTMLParser

from app.core.config import settings
from app.core.errors import UpstreamRateLimitedError
from app.core.logging import logger
from app.ai.spec_extractor import ai_extract_specs
from app.parsers.base import ParseResult, ParsedProduct, StoreParser
from app.utils.http_client import ScraperHTTPClient
from app.utils.specs import missing_required_fields, needs_ai_enrichment, normalize_product_specs
from app.utils.variants import extract_variants_from_network_payloads, infer_variants


class ExampleStoreParser(StoreParser):
    shop_name = "Example Store UZ"
    shop_url = str(settings.example_store_base_url)

    def __init__(self) -> None:
        self._http = ScraperHTTPClient(rate_limit_per_second=2)
        self._product_cache: dict[str, ParsedProduct] = {}

    async def discover_product_links(self, category_url: str) -> list[str]:
        response = await self._http.get(category_url)
        self._cache_products_from_texnomart_jsonld(response.text, category_url)
        links = self._extract_product_links(response.text, category_url)
        if links:
            logger.info("category_links_extracted_http", category_url=category_url, count=len(links))
            return links

        # Dynamic storefront fallback when initial HTML has no product anchors.
        graphql_product_ids: set[str] = set()

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=settings.playwright_headless)
            context = await browser.new_context()
            page = await context.new_page()
            graphql_responses = []

            def _on_graphql_response(resp) -> None:
                try:
                    url = str(resp.url).lower()
                    method = str(resp.request.method).upper()
                except Exception:  # noqa: BLE001
                    return
                if "graphql.uzum.uz" not in url:
                    return
                if method != "POST":
                    return
                graphql_responses.append(resp)

            page.on("response", _on_graphql_response)

            await page.goto(category_url, wait_until="domcontentloaded")
            for _ in range(8):
                await page.mouse.wheel(0, 4000)
                await asyncio.sleep(0.45)
            await asyncio.sleep(2.0)
            page.remove_listener("response", _on_graphql_response)
            for graphql_response in graphql_responses:
                try:
                    if graphql_response.status >= 400:
                        continue
                except Exception:  # noqa: BLE001
                    continue
                try:
                    body = await graphql_response.text()
                except Exception:  # noqa: BLE001
                    continue
                graphql_product_ids.update(re.findall(r'"productId"\s*:\s*(\d+)', body))
                self._cache_products_from_graphql(body, category_url)

            html = await page.content()
            self._raise_if_rate_limited_page(html, category_url)
            dom_hrefs = await page.eval_on_selector_all("a[href]", "els => els.map(el => el.getAttribute('href'))")
            state_chunks = await page.evaluate(
                """() => {
                    const keys = ['__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__', '__NEXT_DATA__'];
                    const out = [];
                    for (const key of keys) {
                        const value = window[key];
                        if (!value) continue;
                        try { out.push(JSON.stringify(value)); } catch (e) {}
                    }
                    return out;
                }"""
            )
            await context.close()
            await browser.close()

        links = set(self._extract_product_links(html, category_url))
        from_state = 0
        for chunk in state_chunks:
            extracted = self._extract_product_links(chunk, category_url)
            from_state += len(extracted)
            links.update(extracted)
        from_dom = 0
        for href in dom_hrefs:
            if href and "/product/" in href:
                normalized = self._normalize_product_url(urljoin(category_url, href))
                if normalized:
                    links.add(normalized)
                    from_dom += 1
        parsed = urlparse(category_url)
        locale = "ru"
        locale_match = re.search(r"/(ru|uz)(/|$)", parsed.path)
        if locale_match:
            locale = locale_match.group(1)
        for product_id in graphql_product_ids:
            product_url = f"{parsed.scheme}://{parsed.netloc}/{locale}/product/{product_id}"
            links.add(product_url)
        await self._enrich_cached_products_from_api(parsed.scheme, parsed.netloc, locale, graphql_product_ids)
        logger.info(
            "category_links_extracted_playwright",
            category_url=category_url,
            count=len(links),
            dom_anchors=len(dom_hrefs),
            dom_product_hrefs=from_dom,
            state_candidates=from_state,
            graphql_product_ids=len(graphql_product_ids),
            graphql_responses=len(graphql_responses),
        )
        return sorted(links)

    async def parse_product(self, product_url: str) -> ParsedProduct:
        cached = self._product_cache.get(product_url)
        if cached:
            return cached

        # Playwright for dynamic content fallback
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=settings.playwright_headless)
            context = await browser.new_context()
            page = await context.new_page()
            api_responses = []

            def _on_response(resp) -> None:
                try:
                    url = str(resp.url).lower()
                    method = str(resp.request.method).upper()
                    resource_type = str(resp.request.resource_type)
                except Exception:  # noqa: BLE001
                    return
                if method != "GET":
                    return
                if resource_type not in {"xhr", "fetch"}:
                    return
                if "graphql" not in url and "/api/" not in url and "catalog" not in url:
                    return
                if any(marker in url for marker in ("metrics", "analytics", "pixel", "sentry", "collect", "counter")):
                    return
                api_responses.append(resp)

            page.on("response", _on_response)
            response = await page.goto(product_url, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(1800)
            html = await page.content()
            if response is not None and response.status in {403, 429, 503}:
                self._raise_if_rate_limited_page(html, product_url)
            self._raise_if_rate_limited_page(html, product_url)
            page.remove_listener("response", _on_response)
            network_payloads: list[str] = []
            for api_resp in api_responses:
                try:
                    if api_resp.status >= 400:
                        continue
                except Exception:  # noqa: BLE001
                    continue
                try:
                    body = await api_resp.text()
                except Exception:  # noqa: BLE001
                    continue
                if body:
                    network_payloads.append(body)
            await context.close()
            await browser.close()

        tree = HTMLParser(html)
        title_node = tree.css_first("h1.product-title") or tree.css_first("h1")
        title = title_node.text(strip=True) if title_node else ""

        price_node = (
            tree.css_first("span.price-current")
            or tree.css_first("[data-testid='product-price']")
            or tree.css_first(".product-price")
        )
        price_raw = price_node.text(strip=True) if price_node else ""
        old_price_node = tree.css_first("span.price-old")
        availability_node = tree.css_first("div.stock-status")

        if not title:
            title = self._extract_title_from_jsonld_or_meta(html) or "Unknown product"

        price = self._parse_price_safe(price_raw)
        if price is None and cached:
            price = cached.price
        if price is None:
            price = self._extract_price_from_html(html)
        if price is None:
            price = self._extract_price_from_network_payloads(network_payloads)
        if price is None:
            raise ValueError("price not found")

        old_price = self._parse_price_safe(old_price_node.text(strip=True)) if old_price_node else None
        if old_price is None:
            old_price = self._extract_old_price_from_html(html)
        availability = availability_node.text(strip=True) if availability_node else "unknown"
        images = self._extract_product_images(tree=tree, html=html, product_url=product_url)
        specs = {
            row.css_first("span.spec-name").text(strip=True): row.css_first("span.spec-value").text(strip=True)
            for row in tree.css("div.spec-row")
            if row.css_first("span.spec-name") and row.css_first("span.spec-value")
        }
        description_node = tree.css_first("div.product-description")
        description = description_node.text(strip=True) if description_node else None
        variants = self._extract_store_specific_variants(
            network_payloads=network_payloads,
            price=price,
            old_price=old_price,
            availability=availability,
            images=images,
            specs=specs,
            product_url=product_url,
        )
        if not variants:
            variants = extract_variants_from_network_payloads(
                network_payloads,
                default_price=price,
                default_old_price=old_price,
                default_availability=availability,
                default_images=images,
                default_specs=specs,
                product_url=product_url,
                store_hint="generic",
            )
        if not variants:
            variants = infer_variants(
                title=title,
                specs=specs,
                source_text=f"{html}\n" + "\n".join(network_payloads),
                price=price,
                old_price=old_price,
                availability=availability,
                images=images,
                product_url=product_url,
            )

        return ParsedProduct(
            title=title,
            price=price,
            old_price=old_price,
            availability=availability,
            images=images,
            specifications=specs,
            product_url=product_url,
            description=description,
            variants=variants,
        )

    @staticmethod
    def _extract_product_images(tree: HTMLParser, html: str, product_url: str, limit: int = 12) -> list[str]:
        def normalize(url: str | None) -> str | None:
            if not url:
                return None
            value = url.strip()
            if not value or value.startswith("data:"):
                return None
            if value.startswith("//"):
                value = "https:" + value
            return urljoin(product_url, value)

        candidates: list[str] = []
        for img in tree.css("img"):
            attrs = img.attributes
            for key in ("src", "data-src", "data-original", "data-lazy", "data-zoom-image"):
                value = normalize(attrs.get(key))
                if value:
                    candidates.append(value)
            srcset = attrs.get("srcset") or attrs.get("data-srcset")
            if srcset:
                for part in srcset.split(","):
                    value = normalize(part.strip().split(" ")[0])
                    if value:
                        candidates.append(value)

        for pattern in [
            r'"image"\s*:\s*"([^"]+)"',
            r'"imageUrl"\s*:\s*"([^"]+)"',
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        ]:
            for match in re.findall(pattern, html):
                value = normalize(match.replace("\\/", "/"))
                if value:
                    candidates.append(value)

        unique: list[str] = []
        seen: set[str] = set()
        for value in candidates:
            if value in seen:
                continue
            seen.add(value)
            unique.append(value)
            if len(unique) >= limit:
                break
        return unique

    async def parse_category(self, category_url: str) -> ParseResult:
        links = await self.discover_product_links(category_url)
        products = []
        for link in links:
            products.append(await self.parse_product(link))
        return ParseResult(category_url=category_url, products=products)

    async def aclose(self) -> None:
        await self._http.aclose()

    def _extract_store_specific_variants(
        self,
        *,
        network_payloads: list[str],
        price: Decimal,
        old_price: Decimal | None,
        availability: str,
        images: list[str],
        specs: dict[str, str],
        product_url: str,
    ) -> list:
        del network_payloads, price, old_price, availability, images, specs, product_url
        return []

    @staticmethod
    def _parse_price(raw: str) -> Decimal:
        filtered = "".join(ch for ch in raw if ch.isdigit() or ch in {".", ","}).replace(",", ".")
        return Decimal(filtered)

    @staticmethod
    def _parse_price_safe(raw: str | None) -> Decimal | None:
        if not raw:
            return None
        filtered = "".join(ch for ch in raw if ch.isdigit() or ch in {".", ","}).replace(",", ".")
        if not filtered:
            return None
        try:
            return Decimal(filtered)
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _extract_title_from_jsonld_or_meta(html: str) -> str | None:
        script_pattern = r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>'
        for script_text in re.findall(script_pattern, html, flags=re.DOTALL | re.IGNORECASE):
            try:
                payload = json.loads(script_text.strip())
            except Exception:  # noqa: BLE001
                continue
            blocks = payload if isinstance(payload, list) else [payload]
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                if block.get("@type") in {"Product", "Offer", "ItemList"}:
                    name = block.get("name")
                    if isinstance(name, str) and name.strip():
                        return name.strip()
                if block.get("@type") == "ItemList":
                    items = block.get("itemListElement")
                    if isinstance(items, list):
                        for element in items:
                            item = element.get("item") if isinstance(element, dict) else None
                            if isinstance(item, dict):
                                name = item.get("name")
                                if isinstance(name, str) and name.strip():
                                    return name.strip()

        og_title_match = re.search(
            r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
            html,
            flags=re.IGNORECASE,
        )
        if og_title_match:
            return og_title_match.group(1).strip()
        return None

    @staticmethod
    def _extract_price_from_html(html: str) -> Decimal | None:
        # JSON-LD / inline JSON: "price": 12345
        for match in re.findall(r'"price"\s*:\s*"?([0-9][0-9\s.,]*)"?', html, flags=re.IGNORECASE):
            parsed = ExampleStoreParser._parse_price_safe(match)
            if parsed is not None and parsed > 0:
                return parsed

        # Generic data attributes often used in storefront templates.
        for match in re.findall(r'data-price\s*=\s*"([^"]+)"', html, flags=re.IGNORECASE):
            parsed = ExampleStoreParser._parse_price_safe(match)
            if parsed is not None and parsed > 0:
                return parsed

        # Nuxt bundle pattern: offers may contain lowPrice/highPrice as variable refs (e.g., lowPrice:g).
        var_names = set(
            re.findall(
                r"(?:lowPrice|highPrice)\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)",
                html,
                flags=re.IGNORECASE,
            )
        )
        for name in var_names:
            assign_pattern = rf"(?:const|let|var)\s+{re.escape(name)}\s*=\s*['\"]?([0-9][0-9\s.,]*)['\"]?"
            for match in re.findall(assign_pattern, html):
                parsed = ExampleStoreParser._parse_price_safe(match)
                if parsed is not None and parsed > 0:
                    return parsed

        # FAQ fallback occasionally contains explicit amount text.
        faq_match = re.search(r"составляет\s+([0-9][0-9\s.,]*)\s+сум", html, flags=re.IGNORECASE)
        if faq_match:
            parsed = ExampleStoreParser._parse_price_safe(faq_match.group(1))
            if parsed is not None and parsed > 0:
                return parsed
        return None

    @staticmethod
    def _extract_old_price_from_html(html: str) -> Decimal | None:
        for match in re.findall(r'"oldPrice"\s*:\s*"?([0-9][0-9\s.,]*)"?', html, flags=re.IGNORECASE):
            parsed = ExampleStoreParser._parse_price_safe(match)
            if parsed is not None and parsed > 0:
                return parsed
        for match in re.findall(r'"fullPrice"\s*:\s*"?([0-9][0-9\s.,]*)"?', html, flags=re.IGNORECASE):
            parsed = ExampleStoreParser._parse_price_safe(match)
            if parsed is not None and parsed > 0:
                return parsed
        return None

    @staticmethod
    def _extract_price_from_network_payloads(payloads: list[str]) -> Decimal | None:
        patterns = [
            r'"minSellPrice"\s*:\s*"?([0-9][0-9\s.,]*)"?',
            r'"sellPrice"\s*:\s*"?([0-9][0-9\s.,]*)"?',
            r'"fullPrice"\s*:\s*"?([0-9][0-9\s.,]*)"?',
            r'"price"\s*:\s*"?([0-9][0-9\s.,]*)"?',
        ]
        for body in payloads:
            for pattern in patterns:
                for match in re.findall(pattern, body, flags=re.IGNORECASE):
                    parsed = ExampleStoreParser._parse_price_safe(match)
                    if parsed is not None and parsed > 0:
                        return parsed
        return None

    @staticmethod
    def _raise_if_rate_limited_page(html: str, url: str) -> None:
        lowered = html.lower()
        if "error 1015" in lowered and "you are being rate limited" in lowered:
            raise UpstreamRateLimitedError(f"upstream blocked requests for {url} (cloudflare 1015)")

    @staticmethod
    def _extract_product_links(html: str, base_url: str) -> list[str]:
        links: set[str] = set()
        tree = HTMLParser(html)
        for node in tree.css("a[href]"):
            href = node.attributes.get("href")
            if href and ("/product/" in href or "/product/detail/" in href):
                normalized = ExampleStoreParser._normalize_product_url(urljoin(base_url, href))
                if normalized:
                    links.add(normalized)

        normalized = html.replace("\\/", "/")

        patterns = [
            r"(https?://[^\"'\\s<>]*/product/detail/\d+/?[^\"'\\s<>]*)",
            r"(https?://[^\"'\\s<>]*/product/[^\"'\\s<>]+)",
            r"(/(?:ru|uz)/product/detail/\d+/?[^\"'\\s<>]*)",
            r"(/(?:ru|uz)/product/[^\"'\\s<>]+)",
            r"(/product/detail/\d+/?[^\"'\\s<>]*)",
            r"(/product/[^\"'\\s<>]+)",
        ]
        for pattern in patterns:
            for href in re.findall(pattern, normalized):
                normalized_href = ExampleStoreParser._normalize_product_url(urljoin(base_url, href))
                if normalized_href:
                    links.add(normalized_href)
        return sorted(links)

    @staticmethod
    def _normalize_product_url(url: str) -> str | None:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return None
        path = parsed.path.rstrip("/")
        if "/product/" not in path:
            return None

        # Valid variants:
        # - /ru/product/1234567
        # - /product/some-slug-1234567
        # - /ru/product/detail/123456
        if re.fullmatch(r"/(?:ru|uz)/product/\d+", path):
            return f"{parsed.scheme}://{parsed.netloc}{path}"
        if re.fullmatch(r"/(?:ru|uz)/product/detail/\d+", path):
            return f"{parsed.scheme}://{parsed.netloc}{path}"
        slug_match = re.fullmatch(r"/product/[\w\-]+-(\d+)", path)
        if slug_match:
            product_id = slug_match.group(1)
            return f"{parsed.scheme}://{parsed.netloc}/ru/product/{product_id}"
        return None

    def _cache_products_from_texnomart_jsonld(self, html: str, category_url: str) -> None:
        script_pattern = r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>'
        scripts = re.findall(script_pattern, html, flags=re.DOTALL | re.IGNORECASE)
        if not scripts:
            return

        for script_text in scripts:
            script_text = script_text.strip()
            if not script_text:
                continue
            try:
                payload = json.loads(script_text)
            except json.JSONDecodeError:
                continue

            blocks = payload if isinstance(payload, list) else [payload]
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                if block.get("@type") != "ItemList":
                    continue
                items = block.get("itemListElement")
                if not isinstance(items, list):
                    continue
                for element in items:
                    item = element.get("item") if isinstance(element, dict) else None
                    if not isinstance(item, dict):
                        continue

                    product_url = item.get("url")
                    title = item.get("name")
                    image = item.get("image")
                    offer = item.get("offers") if isinstance(item.get("offers"), dict) else {}
                    price_raw = offer.get("price")

                    if not product_url or not title or price_raw is None:
                        continue
                    normalized_url = self._normalize_product_url(urljoin(category_url, str(product_url)))
                    if not normalized_url:
                        continue
                    try:
                        price = Decimal(str(price_raw))
                    except Exception:  # noqa: BLE001
                        continue

                    images: list[str] = []
                    if image:
                        normalized_image = urljoin(category_url, str(image))
                        images.append(normalized_image)

                    self._product_cache[normalized_url] = ParsedProduct(
                        title=str(title),
                        price=price,
                        old_price=None,
                        availability="in_stock",
                        images=images,
                        specifications={},
                        product_url=normalized_url,
                        description=None,
                    )

    def _cache_products_from_graphql(self, body: str, category_url: str) -> None:
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            return

        items = payload.get("data", {}).get("makeSearch", {}).get("items", [])
        if not isinstance(items, list):
            return

        parsed_category = urlparse(category_url)
        locale = "ru"
        locale_match = re.search(r"/(ru|uz)(/|$)", parsed_category.path)
        if locale_match:
            locale = locale_match.group(1)

        for item in items:
            catalog_card = item.get("catalogCard") if isinstance(item, dict) else None
            if not isinstance(catalog_card, dict):
                continue

            product_id = catalog_card.get("productId")
            title = catalog_card.get("title")
            min_sell_price = catalog_card.get("minSellPrice")
            if not product_id or not title or min_sell_price is None:
                continue

            try:
                price = Decimal(str(min_sell_price))
            except Exception:  # noqa: BLE001
                continue

            old_price_raw = catalog_card.get("minFullPrice")
            old_price: Decimal | None = None
            if old_price_raw is not None:
                try:
                    old_price = Decimal(str(old_price_raw))
                except Exception:  # noqa: BLE001
                    old_price = None

            photos = catalog_card.get("photos") or []
            images = []
            if isinstance(photos, list):
                for photo in photos:
                    if not isinstance(photo, dict):
                        continue
                    high = ((photo.get("link") or {}).get("high")) if isinstance(photo.get("link"), dict) else None
                    if high:
                        images.append(high)

            specs: dict[str, str] = {}
            char_values = catalog_card.get("characteristicValues") or []
            if isinstance(char_values, list):
                for entry in char_values:
                    if not isinstance(entry, dict):
                        continue
                    key = entry.get("title")
                    value = entry.get("value")
                    if key and value:
                        specs[str(key)] = str(value)
            specs = normalize_product_specs(str(title), specs, category_url)

            product_url = f"{parsed_category.scheme}://{parsed_category.netloc}/{locale}/product/{product_id}"
            self._product_cache[product_url] = ParsedProduct(
                title=str(title),
                price=price,
                old_price=old_price,
                availability=self._availability_from_catalog_card(catalog_card),
                images=images,
                specifications=specs,
                product_url=product_url,
                description=None,
            )

    async def _enrich_cached_products_from_api(
        self,
        scheme: str,
        netloc: str,
        locale: str,
        product_ids: set[str],
    ) -> None:
        async def enrich(product_id: str) -> None:
            product_url = f"{scheme}://{netloc}/{locale}/product/{product_id}"
            cached = self._product_cache.get(product_url)
            if not cached or cached.specifications:
                return

            try:
                response = await self._http.get(f"https://api.uzum.uz/api/v2/product/{product_id}")
                payload = response.json().get("payload", {}).get("data", {})
            except Exception:  # noqa: BLE001
                return

            specs = normalize_product_specs(
                cached.title,
                self._extract_specs_from_product_api(payload),
                extra_text=str(payload.get("description") or ""),
            )
            if needs_ai_enrichment(specs):
                ai_specs = await ai_extract_specs(
                    title=cached.title,
                    description=str(payload.get("description") or ""),
                    category_hint=locale,
                )
                for key, value in ai_specs.items():
                    specs.setdefault(key, value)
            if settings.ai_spec_strict_mode:
                for _ in range(max(0, settings.ai_spec_max_attempts - 1)):
                    missing = missing_required_fields(specs)
                    if not missing:
                        break
                    ai_specs = await ai_extract_specs(
                        title=cached.title,
                        description=str(payload.get("description") or ""),
                        category_hint=locale,
                        required_keys=missing,
                    )
                    for key, value in ai_specs.items():
                        specs.setdefault(key, value)
            availability = self._availability_from_product_api(payload)
            if not specs and availability == "unknown":
                return

            self._product_cache[product_url] = ParsedProduct(
                title=cached.title,
                price=cached.price,
                old_price=cached.old_price,
                availability=availability if availability != "unknown" else cached.availability,
                images=cached.images,
                specifications=specs or cached.specifications,
                product_url=cached.product_url,
                description=cached.description,
            )

        semaphore = asyncio.Semaphore(6)

        async def guarded(product_id: str) -> None:
            async with semaphore:
                await enrich(product_id)

        await asyncio.gather(*(guarded(pid) for pid in product_ids))

    @staticmethod
    def _extract_specs_from_product_api(payload: dict) -> dict[str, str]:
        specs: dict[str, str] = {}

        characteristics = payload.get("characteristics") or []
        if isinstance(characteristics, list):
            for characteristic in characteristics:
                if not isinstance(characteristic, dict):
                    continue
                title = characteristic.get("title")
                values = characteristic.get("values") or []
                if not title or not isinstance(values, list):
                    continue
                value_titles = [str(v.get("title")) for v in values if isinstance(v, dict) and v.get("title")]
                if value_titles:
                    specs[str(title)] = ", ".join(value_titles)

        attributes = payload.get("attributes") or []
        if isinstance(attributes, list):
            for attribute in attributes:
                if not isinstance(attribute, dict):
                    continue
                title = attribute.get("title")
                value = attribute.get("value")
                if title and value:
                    specs[str(title)] = str(value)

        return specs

    @staticmethod
    def _availability_from_catalog_card(catalog_card: dict) -> str:
        buying_options = catalog_card.get("buyingOptions") or {}
        if not isinstance(buying_options, dict):
            return "unknown"
        delivery_options = buying_options.get("deliveryOptions") or {}
        if isinstance(delivery_options, dict) and delivery_options.get("stockType"):
            return "in_stock"
        return "unknown"

    @staticmethod
    def _availability_from_product_api(payload: dict) -> str:
        total_available = payload.get("totalAvailableAmount")
        try:
            if total_available is not None and int(total_available) > 0:
                return "in_stock"
            if total_available is not None and int(total_available) <= 0:
                return "out_of_stock"
        except Exception:  # noqa: BLE001
            return "unknown"
        return "unknown"
