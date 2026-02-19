from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class BrandOut(BaseModel):
    id: int
    name: str


class CategoryOut(BaseModel):
    id: int
    name: str
    slug: str | None = None
    parent_id: int | None = None


class ProductListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    normalized_title: str
    brand: BrandOut | None = None
    category: CategoryOut
    min_price: float | None = None
    max_price: float | None = None
    store_count: int = 0
    score: float = 0


class OfferOut(BaseModel):
    id: int
    price_amount: float
    old_price_amount: float | None = None
    in_stock: bool
    currency: str
    scraped_at: datetime
    store: dict
    external_url: str


class ProductDetailOut(BaseModel):
    id: int
    normalized_title: str
    attributes: dict
    specs: dict
    status: str


class PriceHistoryPoint(BaseModel):
    date: str
    min_price: float | None = None
    max_price: float | None = None


class SearchResponse(BaseModel):
    items: list[ProductListItem]
    next_cursor: str | None = None
    request_id: str


class CompareRequest(BaseModel):
    product_ids: list[int] = Field(min_length=2, max_length=4)


class ErrorResponse(BaseModel):
    error: dict
    request_id: str
