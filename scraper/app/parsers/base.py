from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal


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
