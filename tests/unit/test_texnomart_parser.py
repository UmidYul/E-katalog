from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest

from services.scraper.app.parsers import texnomart as texnomart_module
from services.scraper.app.parsers.texnomart import TexnomartParser


def test_extract_store_specific_variants_delegates_to_network_payload_extractor(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    sentinel = ["sentinel-variant"]

    def _fake_extract(payloads, **kwargs):  # noqa: ANN001, ANN202
        captured["payloads"] = payloads
        captured.update(kwargs)
        return sentinel

    parser = TexnomartParser()
    monkeypatch.setattr(texnomart_module, "extract_variants_from_network_payloads", _fake_extract)

    try:
        result = parser._extract_store_specific_variants(
            network_payloads=['{"variant":"a"}'],
            price=Decimal("100"),
            old_price=Decimal("120"),
            availability="in_stock",
            images=["https://img.example/1.jpg"],
            specs={"color": "Black"},
            product_url="https://texnomart.uz/product/1",
        )
    finally:
        asyncio.run(parser.aclose())

    assert result == sentinel
    assert captured["payloads"] == ['{"variant":"a"}']
    assert captured["default_price"] == Decimal("100")
    assert captured["default_old_price"] == Decimal("120")
    assert captured["default_availability"] == "in_stock"
    assert captured["default_images"] == ["https://img.example/1.jpg"]
    assert captured["default_specs"] == {"color": "Black"}
    assert captured["product_url"] == "https://texnomart.uz/product/1"
    assert captured["store_hint"] == "texnomart"
    assert captured["max_variants"] == 30
