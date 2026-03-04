from __future__ import annotations

import asyncio
import json
from decimal import Decimal
from pathlib import Path

import pytest
from selectolax.parser import HTMLParser

from services.scraper.app.parsers.example_store import ExampleStoreParser


FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "scraper"


def _fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://example.uz/ru/product/1234567/", "https://example.uz/ru/product/1234567"),
        ("https://example.uz/uz/product/detail/7654321", "https://example.uz/uz/product/detail/7654321"),
        ("https://example.uz/product/super-phone-987654", "https://example.uz/ru/product/987654"),
        ("ftp://example.uz/ru/product/1", None),
        ("https://example.uz/catalog/phones", None),
    ],
)
def test_normalize_product_url(url: str, expected: str | None) -> None:
    assert ExampleStoreParser._normalize_product_url(url) == expected


def test_extract_product_links_collects_dom_and_payload_candidates() -> None:
    links = ExampleStoreParser._extract_product_links(
        _fixture("example_store_category.html"),
        base_url="https://example.uz/ru/category/phones",
    )

    assert links == [
        "https://example.uz/ru/product/100001",
        "https://example.uz/ru/product/1112223",
        "https://example.uz/ru/product/1234567",
        "https://example.uz/ru/product/555444",
        "https://example.uz/ru/product/987654",
        "https://example.uz/ru/product/detail/7654321",
    ]


def test_extract_title_from_jsonld_or_meta_prefers_jsonld() -> None:
    html = _fixture("example_store_product.html")
    assert ExampleStoreParser._extract_title_from_jsonld_or_meta(html) == "JSONLD Product Name"

    meta_only = '<meta property="og:title" content="Meta Fallback" />'
    assert ExampleStoreParser._extract_title_from_jsonld_or_meta(meta_only) == "Meta Fallback"


def test_extract_price_from_html_handles_jsonld_and_variable_reference() -> None:
    html = _fixture("example_store_product.html")
    assert ExampleStoreParser._extract_price_from_html(html) == Decimal("1299000")

    variable_ref = 'lowPrice:g;<script>const g = "1 199 500";</script>'
    assert ExampleStoreParser._extract_price_from_html(variable_ref) == Decimal("1199500")


def test_extract_old_price_from_html() -> None:
    html = _fixture("example_store_product.html")
    assert ExampleStoreParser._extract_old_price_from_html(html) == Decimal("1499000")


def test_extract_price_from_network_payloads_picks_first_positive_value() -> None:
    payload_objects = json.loads(_fixture("example_store_network_payloads.json"))
    payloads = [json.dumps(obj) for obj in payload_objects]

    assert ExampleStoreParser._extract_price_from_network_payloads(payloads) == Decimal("1111000")


def test_extract_product_images_normalizes_dedupes_and_skips_data_urls() -> None:
    html = _fixture("example_store_product.html")
    tree = HTMLParser(html)

    images = ExampleStoreParser._extract_product_images(
        tree=tree,
        html=html,
        product_url="https://example.uz/ru/product/1234567",
    )

    assert "https://example.uz/images/photo-1.jpg" in images
    assert "https://cdn.example.com/photo-2.jpg" in images
    assert "https://example.uz/images/photo-3.jpg" in images
    assert "https://example.uz/images/photo-3@2x.jpg" in images
    assert "https://example.uz/images/meta-og.jpg" in images
    assert all(not item.startswith("data:") for item in images)
    assert len(images) == len(set(images))


def test_cache_products_from_texnomart_jsonld_populates_only_valid_items() -> None:
    parser = ExampleStoreParser()
    category_url = "https://example.uz/ru/category/phones"

    try:
        parser._cache_products_from_texnomart_jsonld(_fixture("example_store_category.html"), category_url)
    finally:
        asyncio.run(parser.aclose())

    assert "https://example.uz/ru/product/100001" in parser._product_cache
    cached = parser._product_cache["https://example.uz/ru/product/100001"]
    assert cached.title == "Phone X 8/256"
    assert cached.price == Decimal("999999")
    assert "https://cdn.example.com/phone-x.jpg" in cached.images
    assert "https://example.uz/ru/product/broken-item" not in parser._product_cache


def test_cache_products_from_graphql_builds_parsed_products() -> None:
    parser = ExampleStoreParser()
    category_url = "https://example.uz/ru/category/phones"

    try:
        parser._cache_products_from_graphql(_fixture("example_store_graphql_payload.json"), category_url)
    finally:
        asyncio.run(parser.aclose())

    product_url = "https://example.uz/ru/product/12345"
    assert product_url in parser._product_cache
    cached = parser._product_cache[product_url]
    assert cached.title == "GraphQL Phone 8/256 Blue"
    assert cached.price == Decimal("1299000")
    assert cached.old_price == Decimal("1499000")
    assert cached.availability == "in_stock"
    assert cached.specifications["storage_gb"] == "256 GB"
    assert cached.specifications["color"] == "Blue"


def test_extract_specs_from_product_api_and_availability_helpers() -> None:
    payload = {
        "characteristics": [
            {"title": "Storage", "values": [{"title": "256 GB"}]},
            {"title": "Color", "values": [{"title": "Black"}]},
        ],
        "attributes": [
            {"title": "Display", "value": "6.7 inch"},
        ],
    }
    specs = ExampleStoreParser._extract_specs_from_product_api(payload)

    assert specs["Storage"] == "256 GB"
    assert specs["Color"] == "Black"
    assert specs["Display"] == "6.7 inch"

    assert ExampleStoreParser._availability_from_catalog_card({"buyingOptions": {"deliveryOptions": {"stockType": "in"}}}) == (
        "in_stock"
    )
    assert ExampleStoreParser._availability_from_catalog_card({"buyingOptions": {}}) == "unknown"

    assert ExampleStoreParser._availability_from_product_api({"totalAvailableAmount": 3}) == "in_stock"
    assert ExampleStoreParser._availability_from_product_api({"totalAvailableAmount": 0}) == "out_of_stock"
    assert ExampleStoreParser._availability_from_product_api({"totalAvailableAmount": "n/a"}) == "unknown"
