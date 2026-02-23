from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal


@dataclass(slots=True)
class ParsedVariant:
    variant_key: str
    price: Decimal
    availability: str
    old_price: Decimal | None = None
    color: str | None = None
    storage: str | None = None
    ram: str | None = None
    images: list[str] = field(default_factory=list)
    specifications: dict[str, str] = field(default_factory=dict)
    product_url: str | None = None


@dataclass(slots=True)
class ParsedProduct:
    title: str
    price: Decimal
    old_price: Decimal | None
    availability: str
    images: list[str]
    specifications: dict[str, str]
    product_url: str
    description: str | None = None
    variants: list[ParsedVariant] = field(default_factory=list)


@dataclass(slots=True)
class ParseResult:
    category_url: str
    products: list[ParsedProduct] = field(default_factory=list)


class StoreParser(ABC):
    shop_name: str
    shop_url: str

    @abstractmethod
    async def discover_product_links(self, category_url: str) -> list[str]:
        raise NotImplementedError

    @abstractmethod
    async def parse_product(self, product_url: str) -> ParsedProduct:
        raise NotImplementedError

    @abstractmethod
    async def parse_category(self, category_url: str) -> ParseResult:
        raise NotImplementedError

    @abstractmethod
    async def aclose(self) -> None:
        raise NotImplementedError
