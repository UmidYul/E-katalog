from __future__ import annotations

import asyncio
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from services.scraper.app.parsers import alifshop as alifshop_module
from services.scraper.app.parsers.alifshop import AlifshopParser
from services.scraper.app.parsers.base import ParsedVariant


FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "scraper"


def _fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


class _FakeHTTP:
    def __init__(self, mapping: dict[str, str]) -> None:
        self._mapping = mapping
        self.calls: list[str] = []

    async def get(self, url: str):  # noqa: ANN201
        self.calls.append(url)
        return SimpleNamespace(text=self._mapping[url])

    async def aclose(self) -> None:
        return None


def test_discover_product_links_normalizes_dedupes_and_sorts() -> None:
    parser = AlifshopParser()
    category_url = "https://alifshop.uz/ru/categories/smartphones"
    parser._http = _FakeHTTP({category_url: _fixture("alifshop_category.html")})

    original_limit = alifshop_module.settings.scrape_product_limit
    try:
        alifshop_module.settings.scrape_product_limit = 0
        links = asyncio.run(parser.discover_product_links(category_url))
    finally:
        alifshop_module.settings.scrape_product_limit = original_limit
        asyncio.run(parser.aclose())

    assert links == [
        "https://alifshop.uz/ru/moderated-offer/iphone-15-pro-256gb-deep-blue",
        "https://alifshop.uz/ru/moderated-offer/xiaomi-note-13-256gb-green",
        "https://alifshop.uz/uz/moderated-offer/samsung-s24-ultra-512gb-black",
    ]


def test_discover_product_links_respects_limit() -> None:
    parser = AlifshopParser()
    category_url = "https://alifshop.uz/ru/categories/smartphones"
    parser._http = _FakeHTTP({category_url: _fixture("alifshop_category.html")})

    original_limit = alifshop_module.settings.scrape_product_limit
    try:
        alifshop_module.settings.scrape_product_limit = 2
        links = asyncio.run(parser.discover_product_links(category_url))
    finally:
        alifshop_module.settings.scrape_product_limit = original_limit
        asyncio.run(parser.aclose())

    assert links == [
        "https://alifshop.uz/ru/moderated-offer/iphone-15-pro-256gb-deep-blue",
        "https://alifshop.uz/ru/moderated-offer/xiaomi-note-13-256gb-green",
    ]


def test_normalize_product_url_accepts_and_rejects_expected_paths() -> None:
    assert AlifshopParser._normalize_product_url("https://alifshop.uz/ru/moderated-offer/iphone-15/") == (
        "https://alifshop.uz/ru/moderated-offer/iphone-15"
    )
    assert AlifshopParser._normalize_product_url("http://alifshop.uz/uz/moderated-offer/s24-ultra") == (
        "http://alifshop.uz/uz/moderated-offer/s24-ultra"
    )
    assert AlifshopParser._normalize_product_url("ftp://alifshop.uz/ru/moderated-offer/x") is None
    assert AlifshopParser._normalize_product_url("https://alifshop.uz/ru/product/x") is None
    assert AlifshopParser._normalize_product_url("/ru/moderated-offer/x") is None


def test_extract_title_strips_known_noise_tokens() -> None:
    source = (
        "<title>E-BOZOR - "
        "\u041a\u0443\u043f\u0438\u0442\u044c "
        "Apple iPhone 15 Pro "
        "\u043e\u043d\u043b\u0430\u0439\u043d \u0441 "
        "\u0434\u043e\u0441\u0442\u0430\u0432\u043a\u043e\u0439 "
        "\u043f\u043e \u0423\u0437\u0431\u0435\u043a\u0438\u0441\u0442\u0430\u043d\u0443"
        "</title>"
    )
    assert AlifshopParser._extract_title(source) == "Apple iPhone 15 Pro"


def test_extract_title_falls_back_to_og_title() -> None:
    source = '<meta property="og:title" content="E-BOZOR - Pixel 9 Pro" />'
    assert AlifshopParser._extract_title(source) == "Pixel 9 Pro"


def test_extract_price_and_parse_decimal() -> None:
    source = _fixture("alifshop_product.html")
    assert AlifshopParser._extract_price(source) == Decimal("14999000")
    assert AlifshopParser._parse_decimal("12,75") == Decimal("12.75")
    assert AlifshopParser._parse_decimal("n/a") is None


def test_extract_availability_maps_known_statuses() -> None:
    in_stock = '<meta property="product:availability" content="in stock" />'
    out_of_stock = '<meta property="product:availability" content="out of stock" />'
    unknown = '<meta property="product:availability" content="preorder" />'

    assert AlifshopParser._extract_availability(in_stock) == "in_stock"
    assert AlifshopParser._extract_availability(out_of_stock) == "out_of_stock"
    assert AlifshopParser._extract_availability(unknown) == "unknown"


def test_extract_images_collects_meta_and_fortifai_with_dedupe() -> None:
    source = _fixture("alifshop_product.html")
    images = AlifshopParser._extract_images(source, "https://alifshop.uz/ru/moderated-offer/iphone-15")

    assert "https://alifshop.uz/images/iphone-main.jpg" in images
    assert "https://cdn.example.com/iphone-twitter.jpg" in images
    assert "https://s3.fortifai.uz/shop/moderation/partner-1/blue.jpg" in images
    assert "https://s3.fortifai.uz/shop/moderation/partner-1/black.jpg" in images
    assert len(images) == len(set(images))


def test_extract_specs_keeps_real_color_and_storage() -> None:
    specs = AlifshopParser._extract_specs(_fixture("alifshop_product.html"))

    assert specs["Color"] == "Deep Blue"
    assert specs["color"] == "Deep Blue"
    assert specs["storage_gb"] == "256"


def test_extract_specs_does_not_generate_zero_ram_from_noise() -> None:
    source = """
    <div class="border-b-[0.5px] border-light-surface-300 py-2">
      <div class="flex md:gap-4 gap-3">
        <p class="w-full text-sm md:text-md text-light-basic-300 max-w-[320px]">SIM type</p>
        <div class="text-sm md:text-md w-full whitespace-break-spaces"><span>eSIM</span></div>
      </div>
    </div>
    <script>{"id":0,"name":"values","slug":"test"}</script>
    """
    specs = AlifshopParser._extract_specs(source)
    assert "ram_gb" not in specs


def test_extract_color_image_map_builds_lowercased_mapping() -> None:
    mapping = AlifshopParser._extract_color_image_map(_fixture("alifshop_product.html"))
    assert mapping["deep blue"] == "https://s3.fortifai.uz/shop/moderation/partner-1/blue.jpg"
    assert mapping["black"] == "https://s3.fortifai.uz/shop/moderation/partner-1/black.jpg"


def test_filter_variants_by_primary_color_uses_anchor_and_fallback() -> None:
    parser = AlifshopParser()
    variants = [
        ParsedVariant(variant_key="c:deep-blue", price=Decimal("1"), availability="in_stock", color="Deep Blue"),
        ParsedVariant(variant_key="c:black", price=Decimal("1"), availability="in_stock", color="Black"),
    ]
    only_blue = parser._filter_variants_by_primary_color(variants, "Deep Blue", "Apple iPhone 15 Pro")
    no_match_fallback = parser._filter_variants_by_primary_color(variants, "Pink", "Apple iPhone 15 Pro")
    asyncio.run(parser.aclose())

    assert len(only_blue) == 1
    assert only_blue[0].color == "Deep Blue"
    assert no_match_fallback == variants


def test_parse_product_uses_cache_and_returns_structured_payload() -> None:
    parser = AlifshopParser()
    url = "https://alifshop.uz/ru/moderated-offer/iphone-15-pro-256gb-deep-blue"
    parser._http = _FakeHTTP({url: _fixture("alifshop_product.html")})

    first = asyncio.run(parser.parse_product(url))
    second = asyncio.run(parser.parse_product(url))
    asyncio.run(parser.aclose())

    assert first is second
    assert parser._http.calls == [url]
    assert first.title == "Apple iPhone 15 Pro 8/256GB Deep Blue"
    assert first.price == Decimal("14999000")
    assert first.availability == "in_stock"
    assert first.specifications.get("color") == "Deep Blue"
    assert first.variants
