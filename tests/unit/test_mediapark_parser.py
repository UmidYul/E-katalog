from __future__ import annotations

import asyncio
from decimal import Decimal
from pathlib import Path

import pytest

from services.scraper.app.parsers import mediapark as mediapark_module
from services.scraper.app.parsers.mediapark import MediaParkParser


FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "scraper"


def _fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


def test_extract_product_schema_ignores_invalid_json_and_finds_product() -> None:
    schema = MediaParkParser._extract_product_schema(_fixture("mediapark_product_schema.html"))
    assert schema["@type"] == "Product"
    assert schema["name"] == "Samsung Galaxy S24"


def test_extract_title_prefers_schema_and_falls_back_to_meta() -> None:
    html = _fixture("mediapark_product_schema.html")
    schema = {"name": "Schema Title"}

    assert MediaParkParser._extract_title(schema, html) == "Schema Title"
    assert MediaParkParser._extract_title({}, html) == "Fallback Title"


def test_extract_price_handles_schema_html_and_invalid_formats() -> None:
    schema = {"offers": {"price": "12 345 678"}}
    assert MediaParkParser._extract_price(schema, "") == Decimal("12345678")
    assert MediaParkParser._extract_price({}, '{"price": 1234567}') == Decimal("1234567")
    assert MediaParkParser._extract_price({}, '{"price": "n/a"}') is None


def test_extract_availability_maps_known_values() -> None:
    assert MediaParkParser._extract_availability({"offers": {"availability": "https://schema.org/InStock"}}) == "in_stock"
    assert MediaParkParser._extract_availability({"offers": {"availability": "https://schema.org/OutOfStock"}}) == "out_of_stock"
    assert MediaParkParser._extract_availability({}) == "unknown"


def test_extract_images_prefers_schema_and_dedupes() -> None:
    html = _fixture("mediapark_product_schema.html")
    schema = MediaParkParser._extract_product_schema(html)

    images = MediaParkParser._extract_images(schema, html, "https://mediapark.uz/products/view/s24")

    assert images == [
        "https://mediapark.uz/img/s24-1.jpg",
        "https://cdn.example.com/s24-2.jpg",
    ]


def test_extract_images_falls_back_to_og_image() -> None:
    html = '<meta property="og:image" content="/img/only-og.jpg" />'
    images = MediaParkParser._extract_images({}, html, "https://mediapark.uz/products/view/x")
    assert images == ["https://mediapark.uz/img/only-og.jpg"]


def test_extract_product_links_filters_to_valid_product_urls() -> None:
    links = MediaParkParser._extract_product_links(
        _fixture("mediapark_product_schema.html"),
        base_url="https://mediapark.uz/categories/smartphones",
    )
    assert links == [
        "https://mediapark.uz/products/view/iphone-15-pro",
        "https://mediapark.uz/products/view/poco-f6",
        "https://mediapark.uz/products/view/samsung-galaxy-s24",
    ]


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://mediapark.uz/products/view/iphone-15", True),
        ("http://mediapark.uz/products/view/s24", True),
        ("https://mediapark.uz/products/view/s24?x=1", False),
        ("https://mediapark.uz/products/not-view/s24", False),
    ],
)
def test_is_product_url(url: str, expected: bool) -> None:
    assert MediaParkParser._is_product_url(url) is expected


def test_build_paginated_url_preserves_query() -> None:
    url = "https://mediapark.uz/products/category/smartphones?sort=asc&page=1"
    page_3 = MediaParkParser._build_paginated_url(url, page=3)

    assert "page=3" in page_3
    assert "sort=asc" in page_3
    assert MediaParkParser._build_paginated_url(url, page=1) == url


def test_parse_decimal_handles_numbers_and_invalid_input() -> None:
    assert MediaParkParser._parse_decimal("1 299 000") == Decimal("1299000")
    assert MediaParkParser._parse_decimal(1299000) == Decimal("1299000")
    assert MediaParkParser._parse_decimal("1,299.50") is None
    assert MediaParkParser._parse_decimal("n/a") is None


def test_raise_if_rate_limited_page_throws_expected_exception() -> None:
    with pytest.raises(mediapark_module.UpstreamRateLimitedError):
        MediaParkParser._raise_if_rate_limited_page(
            "Error 1015 - You are being rate limited",
            "https://mediapark.uz/products/view/s24",
        )


def test_parse_specs_from_page_text_handles_section_stop_markers_and_dotted_rows() -> None:
    specs = MediaParkParser._parse_specs_from_page_text(_fixture("mediapark_body_text_specs.txt"))

    assert specs["Display"] == "6.7 inch"
    assert specs["Battery"] == "5000 mAh"
    assert specs["CPU"] == "Snapdragon 8 Gen 3"
    assert "Ignore this tail" not in specs


def test_parse_specs_from_page_text_parses_key_value_without_section() -> None:
    text = "Intro\nStorage: 512 GB\nColor: Black\n"
    specs = MediaParkParser._parse_specs_from_page_text(text)

    assert specs["Storage"] == "512 GB"
    assert specs["Color"] == "Black"


def test_build_specs_without_ai_returns_normalized_specs(monkeypatch: pytest.MonkeyPatch) -> None:
    parser = MediaParkParser()
    monkeypatch.setattr(mediapark_module.settings, "ai_spec_enrichment_enabled", False, raising=False)

    try:
        specs = asyncio.run(
            parser._build_specs(
                title="Smartphone Test 8/256",
                description="AMOLED display",
                raw_specs={"Color": "Black", "Storage": "256 GB"},
            )
        )
    finally:
        asyncio.run(parser.aclose())

    assert specs["color"] == "Black"
    assert specs["storage_gb"] == "256 GB"


def test_build_specs_with_ai_strict_mode_requests_missing_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    parser = MediaParkParser()
    calls: list[list[str] | None] = []

    async def _fake_ai_extract_specs(*, title: str, description: str | None, category_hint: str, required_keys=None):
        del title, description, category_hint
        calls.append(list(required_keys) if required_keys else None)
        if required_keys:
            return {
                "ram_gb": "8",
                "storage_gb": "256",
                "battery_mah": "5000",
                "camera_mp": "50",
                "display_inches": "6.7",
            }
        return {"cpu": "Snapdragon 8 Gen 3"}

    monkeypatch.setattr(mediapark_module.settings, "ai_spec_enrichment_enabled", True, raising=False)
    monkeypatch.setattr(mediapark_module.settings, "ai_spec_strict_mode", True, raising=False)
    monkeypatch.setattr(mediapark_module.settings, "ai_spec_max_attempts", 2, raising=False)
    monkeypatch.setattr(mediapark_module, "ai_extract_specs", _fake_ai_extract_specs)

    try:
        specs = asyncio.run(
            parser._build_specs(
                title="Smartphone X",
                description="Flagship",
                raw_specs={},
            )
        )
    finally:
        asyncio.run(parser.aclose())

    assert len(calls) == 2
    assert calls[0] is None
    assert calls[1]
    assert specs["cpu"] == "Snapdragon 8 Gen 3"
    assert specs["ram_gb"] == "8"
    assert specs["storage_gb"] == "256"
    assert specs["battery_mah"] == "5000"
    assert specs["camera_mp"] == "50"
    assert specs["display_inches"] == "6.7"


def test_extract_specs_and_payloads_with_playwright_failure_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    parser = MediaParkParser()

    async def _raise_context_error():
        raise RuntimeError("playwright unavailable")

    monkeypatch.setattr(parser, "_ensure_playwright_context", _raise_context_error)

    try:
        specs, payloads = asyncio.run(
            parser._extract_specs_and_payloads_with_playwright("https://mediapark.uz/products/view/s24")
        )
    finally:
        asyncio.run(parser.aclose())

    assert specs == {}
    assert payloads == []
