from __future__ import annotations

import asyncio
from dataclasses import dataclass

import pytest
from sqlalchemy.exc import ProgrammingError

from services.scraper.app.parsers import factory as factory_module


class _FakeScalars:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def all(self) -> list[object]:
        return self._rows


class _FakeMappings:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def all(self) -> list[dict]:
        return self._rows


class _FakeResult:
    def __init__(
        self,
        *,
        scalars_rows: list[object] | None = None,
        mappings_rows: list[dict] | None = None,
    ) -> None:
        self._scalars_rows = scalars_rows or []
        self._mappings_rows = mappings_rows or []

    def scalars(self) -> _FakeScalars:
        return _FakeScalars(self._scalars_rows)

    def mappings(self) -> _FakeMappings:
        return _FakeMappings(self._mappings_rows)


class _FakeSession:
    def __init__(self, *, results: list[_FakeResult] | None = None, error: Exception | None = None) -> None:
        self._results = list(results or [])
        self._error = error
        self.rollback_called = False

    async def execute(self, statement, params=None):  # noqa: ANN001
        del statement, params
        if self._error is not None:
            raise self._error
        if self._results:
            return self._results.pop(0)
        return _FakeResult()

    async def rollback(self) -> None:
        self.rollback_called = True


@dataclass
class _ParserStub:
    shop_name: str
    shop_url: str


def _programming_error() -> ProgrammingError:
    return ProgrammingError("select 1", {}, Exception("boom"))


def test_normalize_provider_explicit_and_hint_paths() -> None:
    assert factory_module._normalize_provider("mediapark") == "mediapark"
    assert factory_module._normalize_provider(None, base_url="https://ALIFSHOP.uz") == "alifshop"
    assert factory_module._normalize_provider("unknown", store_name="Texnomart Main") == "texnomart"
    assert factory_module._normalize_provider("unknown") == "example"


def test_build_parser_returns_expected_parser_types() -> None:
    parsers = [
        factory_module.build_parser("mediapark"),
        factory_module.build_parser("texnomart"),
        factory_module.build_parser("alifshop"),
        factory_module.build_parser("example"),
    ]

    try:
        assert parsers[0].__class__ is factory_module.MediaParkParser
        assert parsers[1].__class__ is factory_module.TexnomartParser
        assert parsers[2].__class__ is factory_module.AlifshopParser
        assert parsers[3].__class__ is factory_module.ExampleStoreParser
    finally:
        for parser in parsers:
            asyncio.run(parser.aclose())


def test_fallback_category_urls_joins_base_and_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(factory_module.settings, "mediapark_base_url", "https://mediapark.uz", raising=False)
    monkeypatch.setattr(factory_module.settings, "mediapark_category_paths", ["/c1", "c2"], raising=False)

    assert factory_module._fallback_category_urls("mediapark") == [
        "https://mediapark.uz/c1",
        "https://mediapark.uz/c2",
    ]


def test_override_parser_store_updates_name_and_url() -> None:
    parser = _ParserStub(shop_name="old", shop_url="https://old")
    factory_module._override_parser_store(parser, store_name="new", store_base_url="https://new")

    assert parser.shop_name == "new"
    assert parser.shop_url == "https://new"


def test_build_category_urls_prefers_db_rows() -> None:
    session = _FakeSession(results=[_FakeResult(scalars_rows=["https://a", "https://b"])])
    urls = asyncio.run(factory_module.build_category_urls(session, provider="texnomart"))

    assert urls == ["https://a", "https://b"]
    assert session.rollback_called is False


def test_build_category_urls_falls_back_on_programming_error(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession(error=_programming_error())
    monkeypatch.setattr(factory_module.settings, "alifshop_base_url", "https://alifshop.uz", raising=False)
    monkeypatch.setattr(factory_module.settings, "alifshop_category_paths", ["/x", "y"], raising=False)

    urls = asyncio.run(factory_module.build_category_urls(session, provider="alifshop"))

    assert urls == ["https://alifshop.uz/x", "https://alifshop.uz/y"]
    assert session.rollback_called is True


def test_build_scrape_targets_groups_dedupes_and_resolves_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        {
            "store_id": 10,
            "store_name": "Texnomart Main",
            "provider": "texnomart",
            "base_url": "https://texnomart.uz",
            "source_url": "https://texnomart.uz/cat/a",
        },
        {
            "store_id": 10,
            "store_name": "Texnomart Main",
            "provider": "texnomart",
            "base_url": "https://texnomart.uz",
            "source_url": "https://texnomart.uz/cat/b",
        },
        {
            "store_id": 10,
            "store_name": "Texnomart Main",
            "provider": "texnomart",
            "base_url": "https://texnomart.uz",
            "source_url": "https://texnomart.uz/cat/a",
        },
        {
            "store_id": 20,
            "store_name": "Alif Seller",
            "provider": "generic",
            "base_url": "https://alifshop.uz",
            "source_url": "https://alifshop.uz/ru/categories/phones",
        },
    ]
    session = _FakeSession(results=[_FakeResult(mappings_rows=rows)])

    called_providers: list[str] = []

    def _fake_build_parser(provider: str):  # noqa: ANN202
        called_providers.append(provider)
        return _ParserStub(shop_name=f"default-{provider}", shop_url=f"https://{provider}.example")

    monkeypatch.setattr(factory_module, "build_parser", _fake_build_parser)

    targets = asyncio.run(factory_module.build_scrape_targets(session))

    assert called_providers == ["texnomart", "alifshop"]
    assert len(targets) == 2

    first, second = targets
    assert first.store_id == 10
    assert first.provider == "texnomart"
    assert first.category_urls == ["https://texnomart.uz/cat/a", "https://texnomart.uz/cat/b"]
    assert first.parser.shop_name == "Texnomart Main"
    assert first.parser.shop_url == "https://texnomart.uz"

    assert second.store_id == 20
    assert second.provider == "alifshop"
    assert second.category_urls == ["https://alifshop.uz/ru/categories/phones"]
    assert second.parser.shop_name == "Alif Seller"
    assert second.parser.shop_url == "https://alifshop.uz"


def test_build_scrape_targets_falls_back_on_programming_error(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession(error=_programming_error())

    monkeypatch.setattr(factory_module.settings, "scraper_provider", "example", raising=False)
    monkeypatch.setattr(factory_module.settings, "example_store_base_url", "https://example.uz", raising=False)
    monkeypatch.setattr(factory_module.settings, "example_store_category_paths", ["/phones", "/laptops"], raising=False)

    def _fake_build_parser(provider: str):  # noqa: ANN202
        assert provider == "example"
        return _ParserStub(shop_name="Fallback Store", shop_url="https://fallback.example")

    monkeypatch.setattr(factory_module, "build_parser", _fake_build_parser)

    targets = asyncio.run(factory_module.build_scrape_targets(session))

    assert session.rollback_called is True
    assert len(targets) == 1
    target = targets[0]
    assert target.provider == "example"
    assert target.store_id is None
    assert target.store_name == "Fallback Store"
    assert target.store_base_url == "https://fallback.example"
    assert target.category_urls == ["https://example.uz/phones", "https://example.uz/laptops"]
