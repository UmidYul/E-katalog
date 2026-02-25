from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.db.base import Base


class CatalogUuidMixin:
    uuid: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        nullable=False,
        unique=True,
        default=lambda: str(uuid4()),
        server_default=text("gen_random_uuid()"),
    )


class CatalogCategory(CatalogUuidMixin, Base):
    __tablename__ = "catalog_categories"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("catalog_categories.id", ondelete="SET NULL"))
    slug: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    name_uz: Mapped[str] = mapped_column(String(255), nullable=False)
    name_ru: Mapped[str | None] = mapped_column(String(255))
    name_en: Mapped[str | None] = mapped_column(String(255))
    lft: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    rgt: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class CatalogBrand(CatalogUuidMixin, Base):
    __tablename__ = "catalog_brands"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    normalized_name: Mapped[str] = mapped_column(String(255), nullable=False)
    aliases: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class CatalogStore(CatalogUuidMixin, Base):
    __tablename__ = "catalog_stores"
    __table_args__ = (
        CheckConstraint("trust_score >= 0 and trust_score <= 1", name="ck_catalog_stores_trust_score"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, default="generic", server_default="generic")
    base_url: Mapped[str | None] = mapped_column(Text)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="UZ", server_default="UZ")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    trust_score: Mapped[Decimal] = mapped_column(Numeric(3, 2), nullable=False, default=0, server_default="0")
    crawl_priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class CatalogCanonicalProduct(CatalogUuidMixin, Base):
    __tablename__ = "catalog_canonical_products"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    normalized_title: Mapped[str] = mapped_column(String(512), nullable=False)
    main_image: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[int] = mapped_column(ForeignKey("catalog_categories.id", ondelete="RESTRICT"), nullable=False)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("catalog_brands.id", ondelete="SET NULL"))
    merged_into_id: Mapped[int | None] = mapped_column(
        ForeignKey("catalog_canonical_products.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    specs: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    ai_short_description: Mapped[str | None] = mapped_column(Text)
    ai_whats_new: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    ai_copy_source_hash: Mapped[str | None] = mapped_column(String(64))
    ai_copy_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(768), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class CatalogScrapeSource(CatalogUuidMixin, Base):
    __tablename__ = "catalog_scrape_sources"
    __table_args__ = (UniqueConstraint("store_id", "url", name="uq_catalog_scrape_sources_store_url"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("catalog_stores.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="category", server_default="category")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class CatalogProduct(CatalogUuidMixin, Base):
    __tablename__ = "catalog_products"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    canonical_product_id: Mapped[int | None] = mapped_column(
        ForeignKey("catalog_canonical_products.id", ondelete="SET NULL"), nullable=True
    )
    category_id: Mapped[int] = mapped_column(ForeignKey("catalog_categories.id", ondelete="RESTRICT"), nullable=False)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("catalog_brands.id", ondelete="SET NULL"))
    canonical_sku: Mapped[str | None] = mapped_column(String(128))
    gtin: Mapped[str | None] = mapped_column(String(32))
    mpn: Mapped[str | None] = mapped_column(String(128))
    normalized_title: Mapped[str] = mapped_column(String(512), nullable=False)
    attributes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    specs: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", server_default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    variants: Mapped[list[CatalogProductVariant]] = relationship(back_populates="product", cascade="all, delete-orphan")


class CatalogProductVariant(CatalogUuidMixin, Base):
    __tablename__ = "catalog_product_variants"
    __table_args__ = (UniqueConstraint("product_id", "variant_key", name="uq_catalog_product_variant_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False)
    variant_key: Mapped[str] = mapped_column(String(190), nullable=False)
    color: Mapped[str | None] = mapped_column(String(64))
    storage: Mapped[str | None] = mapped_column(String(64))
    ram: Mapped[str | None] = mapped_column(String(64))
    other_attrs: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    product: Mapped[CatalogProduct] = relationship(back_populates="variants")


class CatalogStoreProduct(CatalogUuidMixin, Base):
    __tablename__ = "catalog_store_products"
    __table_args__ = (UniqueConstraint("store_id", "external_id", name="uq_catalog_store_products_store_external"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("catalog_stores.id", ondelete="CASCADE"), nullable=False)
    canonical_product_id: Mapped[int | None] = mapped_column(
        ForeignKey("catalog_canonical_products.id", ondelete="SET NULL"), nullable=True
    )
    product_id: Mapped[int | None] = mapped_column(ForeignKey("catalog_products.id", ondelete="SET NULL"))
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    external_url: Mapped[str] = mapped_column(Text, nullable=False)
    title_raw: Mapped[str] = mapped_column(Text, nullable=False)
    title_clean: Mapped[str | None] = mapped_column(Text)
    description_raw: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    availability: Mapped[str | None] = mapped_column(String(32))
    rating: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    review_count: Mapped[int | None] = mapped_column(Integer)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict, server_default="{}")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class CatalogSeller(CatalogUuidMixin, Base):
    __tablename__ = "catalog_sellers"
    __table_args__ = (UniqueConstraint("store_id", "normalized_name", name="uq_catalog_sellers_store_normalized_name"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("catalog_stores.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(255), nullable=False)
    rating: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class CatalogOffer(CatalogUuidMixin, Base):
    __tablename__ = "catalog_offers"
    __table_args__ = (
        CheckConstraint("price_amount >= 0", name="ck_catalog_offers_price_nonnegative"),
        CheckConstraint("old_price_amount is null or old_price_amount >= 0", name="ck_catalog_offers_old_price_nonnegative"),
        CheckConstraint("shipping_cost is null or shipping_cost >= 0", name="ck_catalog_offers_shipping_nonnegative"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    canonical_product_id: Mapped[int] = mapped_column(
        ForeignKey("catalog_canonical_products.id", ondelete="CASCADE"), nullable=False
    )
    store_id: Mapped[int] = mapped_column(ForeignKey("catalog_stores.id", ondelete="CASCADE"), nullable=False)
    seller_id: Mapped[int | None] = mapped_column(ForeignKey("catalog_sellers.id", ondelete="SET NULL"))
    store_product_id: Mapped[int] = mapped_column(ForeignKey("catalog_store_products.id", ondelete="CASCADE"), nullable=False)
    product_variant_id: Mapped[int | None] = mapped_column(ForeignKey("catalog_product_variants.id", ondelete="SET NULL"))
    offer_url: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="UZS", server_default="UZS")
    price_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    old_price_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    in_stock: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    delivery_days: Mapped[int | None] = mapped_column(Integer)
    shipping_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_valid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CatalogPriceHistory(CatalogUuidMixin, Base):
    __tablename__ = "catalog_price_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    offer_id: Mapped[int] = mapped_column(ForeignKey("catalog_offers.id", ondelete="CASCADE"), nullable=False)
    price_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    in_stock: Mapped[bool] = mapped_column(Boolean, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CatalogProductEmbedding(Base):
    __tablename__ = "catalog_product_embeddings"

    product_id: Mapped[int] = mapped_column(
        ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    embedding: Mapped[list[float]] = mapped_column(Vector(768), nullable=False)
    model_name: Mapped[str] = mapped_column(String(128), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CatalogProductSearch(Base):
    __tablename__ = "catalog_product_search"

    product_id: Mapped[int] = mapped_column(
        ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    tsv: Mapped[str] = mapped_column(TSVECTOR, nullable=False)
    min_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    max_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    store_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CatalogDuplicateCandidate(CatalogUuidMixin, Base):
    __tablename__ = "catalog_duplicate_candidates"
    __table_args__ = (
        UniqueConstraint("product_id_a", "product_id_b", name="uq_catalog_duplicate_pair"),
        CheckConstraint("score >= 0 and score <= 1", name="ck_catalog_duplicate_score"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    product_id_a: Mapped[int] = mapped_column(ForeignKey("catalog_canonical_products.id", ondelete="CASCADE"), nullable=False)
    product_id_b: Mapped[int] = mapped_column(ForeignKey("catalog_canonical_products.id", ondelete="CASCADE"), nullable=False)
    score: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False)
    reason: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CatalogCanonicalMergeEvent(CatalogUuidMixin, Base):
    __tablename__ = "catalog_canonical_merge_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    from_product_id: Mapped[int | None] = mapped_column(
        ForeignKey("catalog_canonical_products.id", ondelete="SET NULL"), nullable=True
    )
    to_product_id: Mapped[int | None] = mapped_column(
        ForeignKey("catalog_canonical_products.id", ondelete="SET NULL"), nullable=True
    )
    reason: Mapped[str] = mapped_column(String(128), nullable=False)
    score: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CatalogCrawlJob(CatalogUuidMixin, Base):
    __tablename__ = "catalog_crawl_jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("catalog_stores.id", ondelete="CASCADE"), nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("catalog_categories.id", ondelete="SET NULL"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    error_summary: Mapped[str | None] = mapped_column(Text)


class CatalogCrawlJobItem(CatalogUuidMixin, Base):
    __tablename__ = "catalog_crawl_job_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    crawl_job_id: Mapped[int] = mapped_column(ForeignKey("catalog_crawl_jobs.id", ondelete="CASCADE"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)


class CatalogAIEnrichmentJob(CatalogUuidMixin, Base):
    __tablename__ = "catalog_ai_enrichment_jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("catalog_canonical_products.id", ondelete="CASCADE"), nullable=False)
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CatalogDataQualityReport(CatalogUuidMixin, Base):
    __tablename__ = "catalog_data_quality_reports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    summary: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    checks: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AdminAlertEvent(CatalogUuidMixin, Base):
    __tablename__ = "admin_alert_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(96), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", server_default="open")
    metric_value: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False, default=0, server_default="0")
    threshold_value: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False, default=0, server_default="0")
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


Index("ix_catalog_categories_parent_id", CatalogCategory.parent_id)
Index("ix_catalog_categories_lft_rgt", CatalogCategory.lft, CatalogCategory.rgt)
Index("ix_catalog_brands_normalized_name", CatalogBrand.normalized_name)
Index("ix_catalog_stores_is_active", CatalogStore.is_active)
Index("ix_catalog_stores_crawl_priority", CatalogStore.crawl_priority)
Index("ix_catalog_stores_provider", CatalogStore.provider)
Index("ix_catalog_scrape_sources_store_id", CatalogScrapeSource.store_id)
Index("ix_catalog_scrape_sources_is_active", CatalogScrapeSource.is_active)
Index("ix_catalog_scrape_sources_priority", CatalogScrapeSource.priority)
Index("ix_catalog_canonical_products_category_brand", CatalogCanonicalProduct.category_id, CatalogCanonicalProduct.brand_id)
Index("ix_catalog_canonical_products_is_active", CatalogCanonicalProduct.is_active)
Index("ix_catalog_canonical_products_merged_into_id", CatalogCanonicalProduct.merged_into_id)
Index("ix_catalog_canonical_products_specs", CatalogCanonicalProduct.specs, postgresql_using="gin")
Index("ix_catalog_products_category_brand", CatalogProduct.category_id, CatalogProduct.brand_id)
Index("ix_catalog_products_status", CatalogProduct.status)
Index("ix_catalog_products_canonical_product_id", CatalogProduct.canonical_product_id)
Index("ix_catalog_store_products_store_id", CatalogStoreProduct.store_id)
Index("ix_catalog_store_products_product_id", CatalogStoreProduct.product_id)
Index("ix_catalog_store_products_canonical_product_id", CatalogStoreProduct.canonical_product_id)
Index("ix_catalog_store_products_last_seen_at", CatalogStoreProduct.last_seen_at)
Index("ix_catalog_sellers_store_id", CatalogSeller.store_id)
Index("ix_catalog_sellers_normalized_name", CatalogSeller.normalized_name)
Index("ix_catalog_offers_canonical_product_id", CatalogOffer.canonical_product_id)
Index("ix_catalog_offers_store_id", CatalogOffer.store_id)
Index("ix_catalog_offers_seller_id", CatalogOffer.seller_id)
Index("ix_catalog_offers_store_product_scraped", CatalogOffer.store_product_id, CatalogOffer.scraped_at.desc())
Index("ix_catalog_offers_valid_stock_price", CatalogOffer.is_valid, CatalogOffer.in_stock, CatalogOffer.price_amount)
Index("ix_catalog_offers_scraped_at", CatalogOffer.scraped_at)
Index("ix_catalog_price_history_offer_captured", CatalogPriceHistory.offer_id, CatalogPriceHistory.captured_at.desc())
Index("ix_catalog_price_history_captured_at", CatalogPriceHistory.captured_at)
Index("ix_catalog_product_search_min_price", CatalogProductSearch.min_price)
Index("ix_catalog_product_search_max_price", CatalogProductSearch.max_price)
Index("ix_catalog_product_search_store_count", CatalogProductSearch.store_count)
Index("ix_catalog_product_embeddings_model", CatalogProductEmbedding.model_name, CatalogProductEmbedding.model_version)
Index("ix_catalog_duplicate_status_score", CatalogDuplicateCandidate.status, CatalogDuplicateCandidate.score.desc())
Index("ix_catalog_canonical_merge_events_from", CatalogCanonicalMergeEvent.from_product_id)
Index("ix_catalog_canonical_merge_events_to", CatalogCanonicalMergeEvent.to_product_id)
Index("ix_catalog_canonical_merge_events_created_at", CatalogCanonicalMergeEvent.created_at.desc())
Index("ix_catalog_ai_jobs_status_stage", CatalogAIEnrichmentJob.status, CatalogAIEnrichmentJob.stage)
Index("ix_catalog_ai_jobs_product_id", CatalogAIEnrichmentJob.product_id)
Index("ix_catalog_quality_reports_created_at", CatalogDataQualityReport.created_at.desc())
Index("ix_catalog_quality_reports_status_created", CatalogDataQualityReport.status, CatalogDataQualityReport.created_at.desc())
Index("ix_admin_alert_events_created_at", AdminAlertEvent.created_at.desc())
Index("ix_admin_alert_events_status_severity_created", AdminAlertEvent.status, AdminAlertEvent.severity, AdminAlertEvent.created_at.desc())
Index("ix_admin_alert_events_source_code", AdminAlertEvent.source, AdminAlertEvent.code)
Index("ix_catalog_crawl_jobs_store_started", CatalogCrawlJob.store_id, CatalogCrawlJob.started_at.desc())
Index("ix_catalog_crawl_job_items_job_status", CatalogCrawlJobItem.crawl_job_id, CatalogCrawlJobItem.status)

# Postgres-specific indexes to create in migrations:
# - lower(normalized_title) gin_trgm_ops
# - GIN on attributes/specs
# - GIN on product_search.tsv
# - IVFFLAT on product_embeddings.embedding
