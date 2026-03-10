from __future__ import annotations

import asyncio
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from services.scraper.app.parsers import asaxiy as asaxiy_module
from services.scraper.app.parsers.asaxiy import AsaxiyParser


FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "scraper"


def _fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


class _FakeHTTP:
    def __init__(self, mapping: dict[str, str | list[str | Exception] | Exception]) -> None:
        self._mapping = mapping
        self._attempt_index: dict[str, int] = defaultdict(int)
        self.calls: list[str] = []

    async def get(self, url: str, *, headers=None):  # noqa: ANN201
        del headers
        self.calls.append(url)
        item = self._mapping[url]
        if isinstance(item, list):
            idx = self._attempt_index[url]
            self._attempt_index[url] = idx + 1
            value = item[min(idx, len(item) - 1)]
        else:
            value = item
        if isinstance(value, Exception):
            raise value
        return SimpleNamespace(text=value)

    async def aclose(self) -> None:
        return None


def test_discover_product_links_paginates_and_caches_listing_products(monkeypatch: pytest.MonkeyPatch) -> None:
    parser = AsaxiyParser()
    category_url = "https://asaxiy.uz/product/telefony-i-gadzhety/telefony/smartfony"
    page_2 = f"{category_url}/page=2"
    parser._http = _FakeHTTP(
        {
            category_url: _fixture("asaxiy_category_page_1.html"),
            page_2: _fixture("asaxiy_category_page_2.html"),
        }
    )

    async def _no_wait_between_requests() -> None:
        return None

    monkeypatch.setattr(parser, "_wait_between_requests", _no_wait_between_requests)
    original_limit = asaxiy_module.settings.scrape_product_limit
    asaxiy_module.settings.scrape_product_limit = 0
    try:
        links = asyncio.run(parser.discover_product_links(category_url))
        first = asyncio.run(parser.parse_product(links[0]))
        second = asyncio.run(parser.parse_product(links[1]))
    finally:
        asaxiy_module.settings.scrape_product_limit = original_limit
        asyncio.run(parser.aclose())

    assert links == [
        "https://asaxiy.uz/product/phone-a-8256-black",
        "https://asaxiy.uz/product/phone-b-12256-blue",
        "https://asaxiy.uz/product/phone-c-8256-gold",
    ]
    assert parser._http.calls == [category_url, page_2]
    assert first.price == Decimal("4299000")
    assert first.specifications["sku"] == "T111"
    assert first.specifications["brand"] == "Honor"
    assert first.specifications["installment_monthly_uzs"] == "523100"
    assert second.availability == "out_of_stock"


def test_parse_product_extracts_detail_fields() -> None:
    parser = AsaxiyParser()
    product_url = "https://asaxiy.uz/product/phone-a-8256-black"
    parser._http = _FakeHTTP({product_url: _fixture("asaxiy_product.html")})

    product = asyncio.run(parser.parse_product(product_url))
    asyncio.run(parser.aclose())

    assert product.title == "Phone A 8/256 Black"
    assert product.price == Decimal("4299000")
    assert product.old_price == Decimal("4899000")
    assert product.availability == "in_stock"
    assert product.images[0] == "https://assets.example/phone-a-main.jpg"
    assert product.specifications["sku"] == "T111"
    assert product.specifications["brand"] == "Honor"
    assert product.specifications["installment_monthly_uzs"] == "523100"
    assert product.specifications["installment_months"] == "12"
    assert product.specifications["color"] == "Black"


def test_parse_product_retries_network_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    parser = AsaxiyParser()
    product_url = "https://asaxiy.uz/product/phone-a-8256-black"
    parser._http = _FakeHTTP(
        {
            product_url: [
                httpx.ReadTimeout("timeout"),
                httpx.ConnectError("connection reset"),
                _fixture("asaxiy_product.html"),
            ]
        }
    )

    async def _no_wait_between_requests() -> None:
        return None

    async def _no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(parser, "_wait_between_requests", _no_wait_between_requests)
    monkeypatch.setattr(asaxiy_module.asyncio, "sleep", _no_sleep)

    product = asyncio.run(parser.parse_product(product_url))
    asyncio.run(parser.aclose())

    assert product.price == Decimal("4299000")
    assert parser._http.calls == [product_url, product_url, product_url]


def test_normalize_category_url_supports_legacy_telefon_path() -> None:
    parser = AsaxiyParser()
    normalized = parser._normalize_category_url("https://asaxiy.uz/product/telefon")
    asyncio.run(parser.aclose())
    assert normalized == "https://asaxiy.uz/product/telefony-i-gadzhety/telefony/smartfony"
