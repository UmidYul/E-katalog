from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


SellerApplicationStatus = Literal["pending", "review", "approved", "rejected"]


class SellerApplicationCreateIn(BaseModel):
    shop_name: str = Field(min_length=2, max_length=255)
    contact_person: str = Field(min_length=2, max_length=160)
    legal_type: Literal["individual", "llc", "other"] = "individual"
    inn: str = Field(min_length=9, max_length=14, pattern=r"^\d{9,14}$")
    legal_address: str = Field(min_length=3, max_length=400)
    actual_address: str | None = Field(default=None, max_length=400)
    contact_phone: str = Field(min_length=7, max_length=64)
    contact_email: str = Field(min_length=5, max_length=255)
    accepts_terms: bool = False
    has_website: bool = False
    website_url: str | None = Field(default=None, max_length=2000)
    work_type: Literal["online", "offline", "both"] = "online"
    delivery_available: bool = False
    pickup_available: bool = False
    product_categories: list[str] = Field(default_factory=list, max_length=20)
    documents: list[dict] = Field(default_factory=list, max_length=20)

    @field_validator("accepts_terms")
    @classmethod
    def validate_accepts_terms(cls, value: bool) -> bool:
        if not value:
            raise ValueError("terms must be accepted")
        return value


class SellerApplicationOut(BaseModel):
    id: str
    status: SellerApplicationStatus
    shop_name: str
    contact_email: str
    contact_phone: str
    review_note: str | None = None
    created_at: str
    updated_at: str


class SellerApplicationStatusLookupOut(BaseModel):
    id: str
    status: SellerApplicationStatus
    review_note: str | None = None
    provisioning_status: str = "pending"
    seller_login_url: str | None = None
    seller_panel_url: str | None = None
    created_at: str
    updated_at: str


class SellerDashboardStatsOut(BaseModel):
    period_days: int
    clicks: int
    spend_uzs: float
    orders: int
    conversion_rate: float


class SellerDashboardChartPoint(BaseModel):
    date: str
    clicks: int
    spend_uzs: float


class SellerDashboardAlertsOut(BaseModel):
    alerts: list[dict]


class SellerShopOut(BaseModel):
    id: str
    org_id: str
    owner_user_id: str
    slug: str
    shop_name: str
    status: str
    website_url: str | None = None
    contact_email: str
    contact_phone: str
    is_auto_paused: bool = False
    metadata: dict = Field(default_factory=dict)
    created_at: str
    updated_at: str


class SellerShopPatchIn(BaseModel):
    shop_name: str | None = Field(default=None, min_length=2, max_length=255)
    website_url: str | None = Field(default=None, max_length=2000)
    contact_email: str | None = Field(default=None, min_length=5, max_length=255)
    contact_phone: str | None = Field(default=None, min_length=7, max_length=64)
    logo_url: str | None = Field(default=None, max_length=2000)
    banner_url: str | None = Field(default=None, max_length=2000)
    brand_color: str | None = Field(default=None, pattern=r"^#?[0-9A-Fa-f]{6}$")


SellerProductStatus = Literal["draft", "pending_moderation", "active", "rejected", "archived"]
SellerProductMutableStatus = Literal["draft", "pending_moderation", "archived"]
SellerTimelineActorRole = Literal["seller", "admin", "system"]


class SellerProductOut(BaseModel):
    id: str
    shop_id: str
    source: str
    title: str
    description: str | None = None
    category_id: str | None = None
    images: list[dict] = Field(default_factory=list)
    price: float
    old_price: float | None = None
    sku: str | None = None
    barcode: str | None = None
    status: SellerProductStatus
    moderation_comment: str | None = None
    track_inventory: bool = True
    stock_quantity: int = 0
    stock_reserved: int = 0
    stock_alert_threshold: int | None = None
    attributes: dict = Field(default_factory=dict)
    views_count: int = 0
    clicks_count: int = 0
    created_at: str
    updated_at: str


class SellerProductCreateIn(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    description: str | None = None
    category_id: str | None = None
    images: list[dict] = Field(default_factory=list)
    price: float = Field(ge=0)
    old_price: float | None = Field(default=None, ge=0)
    sku: str | None = Field(default=None, max_length=120)
    barcode: str | None = Field(default=None, max_length=120)
    track_inventory: bool = True
    stock_quantity: int = Field(default=0, ge=0)
    stock_alert_threshold: int | None = Field(default=None, ge=0)
    attributes: dict = Field(default_factory=dict)
    publish: bool = False


class SellerProductPatchIn(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=255)
    description: str | None = None
    category_id: str | None = None
    images: list[dict] | None = None
    price: float | None = Field(default=None, ge=0)
    old_price: float | None = Field(default=None, ge=0)
    sku: str | None = Field(default=None, max_length=120)
    barcode: str | None = Field(default=None, max_length=120)
    status: SellerProductMutableStatus | None = None
    track_inventory: bool | None = None
    stock_alert_threshold: int | None = Field(default=None, ge=0)
    attributes: dict | None = None


class SellerProductStockPatchIn(BaseModel):
    quantity: int = Field(ge=0)
    comment: str | None = Field(default=None, max_length=500)


class SellerInventoryLogOut(BaseModel):
    id: int
    product_id: str
    action: str
    quantity_before: int
    quantity_after: int
    delta: int
    reference_id: str | None = None
    comment: str | None = None
    created_by_user_id: str | None = None
    created_at: str


class SellerInventoryLogListOut(BaseModel):
    items: list[SellerInventoryLogOut] = Field(default_factory=list)
    total: int
    limit: int
    offset: int


class SellerProductStatusEventOut(BaseModel):
    id: str
    product_id: str
    from_status: SellerProductStatus | None = None
    to_status: SellerProductStatus
    event_type: str
    reason_code: str | None = None
    reason_label: str
    comment: str | None = None
    actor_role: SellerTimelineActorRole
    actor_user_id: str | None = None
    actor_label: str
    metadata: dict = Field(default_factory=dict)
    created_at: str


class SellerProductStatusEventListOut(BaseModel):
    items: list[SellerProductStatusEventOut] = Field(default_factory=list)
    total: int
    limit: int
    offset: int
