from __future__ import annotations

from decimal import Decimal
from urllib.parse import urljoin

from playwright.async_api import async_playwright
from selectolax.parser import HTMLParser

from app.core.config import settings
from app.parsers.base import ParseResult, ParsedProduct, StoreParser
from app.utils.http_client import ScraperHTTPClient


class ExampleStoreParser(StoreParser):
    shop_name = "Example Store UZ"
    shop_url = str(settings.example_store_base_url)

    def __init__(self) -> None:
        self._http = ScraperHTTPClient(rate_limit_per_second=8)

    async def discover_product_links(self, category_url: str) -> list[str]:
        response = await self._http.get(category_url)
        tree = HTMLParser(response.text)
        links: set[str] = set()
        for node in tree.css("a.product-card"):
            href = node.attributes.get("href")
            if href:
                links.add(urljoin(category_url, href))
        return sorted(links)

    async def parse_product(self, product_url: str) -> ParsedProduct:
        # Playwright for dynamic content fallback
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=settings.playwright_headless)
            context = await browser.new_context(user_agent=settings.user_agents[0])
            page = await context.new_page()
            await page.goto(product_url, wait_until="networkidle")
            html = await page.content()
            await context.close()
            await browser.close()

        tree = HTMLParser(html)
        title = tree.css_first("h1.product-title").text(strip=True)
        price_raw = tree.css_first("span.price-current").text(strip=True)
        old_price_node = tree.css_first("span.price-old")
        availability_node = tree.css_first("div.stock-status")

        price = self._parse_price(price_raw)
        old_price = self._parse_price(old_price_node.text(strip=True)) if old_price_node else None
        availability = availability_node.text(strip=True) if availability_node else "unknown"
        images = [img.attributes.get("src", "") for img in tree.css("img.product-image") if img.attributes.get("src")]
        specs = {
            row.css_first("span.spec-name").text(strip=True): row.css_first("span.spec-value").text(strip=True)
            for row in tree.css("div.spec-row")
            if row.css_first("span.spec-name") and row.css_first("span.spec-value")
        }
        description_node = tree.css_first("div.product-description")
        description = description_node.text(strip=True) if description_node else None

        return ParsedProduct(
            title=title,
            price=price,
            old_price=old_price,
            availability=availability,
            images=images,
            specifications=specs,
            product_url=product_url,
            description=description,
        )

    async def parse_category(self, category_url: str) -> ParseResult:
        links = await self.discover_product_links(category_url)
        products = []
        for link in links:
            products.append(await self.parse_product(link))
        return ParseResult(category_url=category_url, products=products)

    async def aclose(self) -> None:
        await self._http.aclose()

    @staticmethod
    def _parse_price(raw: str) -> Decimal:
        filtered = "".join(ch for ch in raw if ch.isdigit() or ch in {".", ","}).replace(",", ".")
        return Decimal(filtered)
