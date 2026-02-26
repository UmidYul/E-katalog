from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
UUIDRef = Annotated[str, StringConstraints(pattern=UUID_REF_PATTERN)]


class BrandOut(BaseModel):
    id: str
    name: str


class CategoryOut(BaseModel):
    id: str
    name: str
    slug: str | None = None
    parent_id: str | None = None


class ProductListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    normalized_title: str
    image_url: str | None = None
    brand: BrandOut | None = None
    category: CategoryOut
    min_price: float | None = None
    max_price: float | None = None
    store_count: int = 0
    score: float = 0


class OfferOut(BaseModel):
    id: str
    seller_id: str | None = None
    seller_name: str
    price_amount: float
    old_price_amount: float | None = None
    in_stock: bool
    currency: str
    delivery_days: int | None = None
    scraped_at: datetime
    link: str


class ProductDetailOut(BaseModel):
    id: str
    title: str
    category: str
    brand: str | None = None
    main_image: str | None = None
    gallery_images: list[str] = Field(default_factory=list)
    short_description: str | None = None
    whats_new: list[str] = Field(default_factory=list)
    specs: dict


class OffersByStoreOut(BaseModel):
    store_id: str
    store: str
    minimal_price: float
    offers_count: int
    offers: list[OfferOut]


class CanonicalProductDetailOut(ProductDetailOut):
    offers_by_store: list[OffersByStoreOut] = []


class PriceHistoryPoint(BaseModel):
    date: str
    min_price: float | None = None
    max_price: float | None = None


class SearchResponse(BaseModel):
    items: list[ProductListItem]
    next_cursor: str | None = None
    request_id: str


class CompareRequest(BaseModel):
    product_ids: list[UUIDRef] = Field(min_length=2, max_length=4)


class CompareShareCreateRequest(BaseModel):
    product_ids: list[UUIDRef] = Field(min_length=2, max_length=4)
    ttl_days: int = Field(default=30, ge=1, le=180)


class CompareShareCreateOut(BaseModel):
    token: str
    product_ids: list[str]
    share_path: str
    expires_at: str
    request_id: str


class CompareShareResolveOut(BaseModel):
    product_ids: list[str]
    expires_at: str
    request_id: str


class ProductPriceAlertUpsertIn(BaseModel):
    alerts_enabled: bool | None = None
    target_price: float | None = Field(default=None, ge=0)
    baseline_price: float | None = Field(default=None, ge=0)
    current_price: float | None = Field(default=None, ge=0)
    channel: str = Field(default="telegram", pattern="^(telegram|email)$")


class ProductPriceAlertOut(BaseModel):
    id: str
    product_id: str
    channel: str
    alerts_enabled: bool
    baseline_price: float | None = None
    target_price: float | None = None
    last_seen_price: float | None = None
    last_notified_at: str | None = None
    updated_at: str


class ProductReviewCreate(BaseModel):
    author: str = Field(min_length=2, max_length=120)
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=10, max_length=3000)
    pros: str | None = Field(default=None, max_length=500)
    cons: str | None = Field(default=None, max_length=500)


class ProductReviewOut(BaseModel):
    id: str
    product_id: str
    author: str
    rating: int
    comment: str
    pros: str | None = None
    cons: str | None = None
    is_verified_purchase: bool = False
    helpful_votes: int = 0
    not_helpful_votes: int = 0
    status: str
    created_at: str
    updated_at: str
    moderated_by: str | None = None
    moderated_at: str | None = None


class ProductQuestionCreate(BaseModel):
    author: str = Field(min_length=2, max_length=120)
    question: str = Field(min_length=8, max_length=2000)


class ProductAnswerCreate(BaseModel):
    author: str | None = Field(default=None, min_length=2, max_length=120)
    text: str = Field(min_length=2, max_length=2000)
    is_official: bool = False


class ProductAnswerOut(BaseModel):
    id: str
    question_id: str
    product_id: str
    author: str
    text: str
    status: str
    is_official: bool = False
    is_pinned: bool = False
    pinned_at: str | None = None
    pinned_by: str | None = None
    created_at: str
    updated_at: str
    moderated_by: str | None = None
    moderated_at: str | None = None


class ProductQuestionOut(BaseModel):
    id: str
    product_id: str
    author: str
    question: str
    status: str
    created_at: str
    updated_at: str
    moderated_by: str | None = None
    moderated_at: str | None = None
    answers: list[ProductAnswerOut] = []


class ProductFeedbackModerationIn(BaseModel):
    status: str = Field(pattern="^(published|rejected|pending)$")


class ProductFeedbackModerationOut(BaseModel):
    ok: bool
    status: str


class ProductReviewVoteIn(BaseModel):
    helpful: bool


class ProductReviewVoteOut(BaseModel):
    ok: bool
    review_id: str
    helpful_votes: int
    not_helpful_votes: int
    user_vote: str


class ProductFeedbackReportIn(BaseModel):
    reason: str = Field(min_length=3, max_length=400)


class ProductFeedbackReportOut(BaseModel):
    ok: bool
    target_id: str
    kind: str
    reports_total: int
    created_at: str


class ProductAnswerPinIn(BaseModel):
    pinned: bool = True


class ProductAnswerPinOut(BaseModel):
    ok: bool
    answer_id: str
    pinned: bool
    pinned_at: str | None = None
    pinned_by: str | None = None


class ProductFeedbackQueueItem(BaseModel):
    kind: str
    id: str
    product_id: str
    author: str
    body: str
    rating: int | None = None
    status: str
    created_at: str
    updated_at: str
    moderated_by: str | None = None
    moderated_at: str | None = None


class ProductFeedbackQueueOut(BaseModel):
    items: list[ProductFeedbackQueueItem]
    total: int
    status_counts: dict[str, int]
    kind_counts: dict[str, int]


class ErrorResponse(BaseModel):
    error: dict
    request_id: str
