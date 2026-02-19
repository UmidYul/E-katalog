"""production catalog schema

Revision ID: 20260219_01
Revises:
Create Date: 2026-02-19
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260219_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")

    op.create_table(
        "catalog_categories",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("parent_id", sa.BigInteger(), sa.ForeignKey("catalog_categories.id", ondelete="SET NULL")),
        sa.Column("slug", sa.String(length=160), nullable=False, unique=True),
        sa.Column("name_uz", sa.String(length=255), nullable=False),
        sa.Column("name_ru", sa.String(length=255)),
        sa.Column("name_en", sa.String(length=255)),
        sa.Column("lft", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rgt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_categories_parent_id", "catalog_categories", ["parent_id"])
    op.create_index("ix_catalog_categories_lft_rgt", "catalog_categories", ["lft", "rgt"])

    op.create_table(
        "catalog_brands",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False, unique=True),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("aliases", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_brands_normalized_name", "catalog_brands", ["normalized_name"])
    op.create_index("ix_catalog_brands_aliases", "catalog_brands", ["aliases"], postgresql_using="gin")

    op.create_table(
        "catalog_stores",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("slug", sa.String(length=120), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=False, server_default="UZ"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("trust_score", sa.Numeric(3, 2), nullable=False, server_default="0"),
        sa.Column("crawl_priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("trust_score >= 0 and trust_score <= 1", name="ck_catalog_stores_trust_score"),
    )
    op.create_index("ix_catalog_stores_is_active", "catalog_stores", ["is_active"])
    op.create_index("ix_catalog_stores_crawl_priority", "catalog_stores", ["crawl_priority"])

    op.create_table(
        "catalog_products",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("category_id", sa.BigInteger(), sa.ForeignKey("catalog_categories.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("brand_id", sa.BigInteger(), sa.ForeignKey("catalog_brands.id", ondelete="SET NULL")),
        sa.Column("canonical_sku", sa.String(length=128)),
        sa.Column("gtin", sa.String(length=32)),
        sa.Column("mpn", sa.String(length=128)),
        sa.Column("normalized_title", sa.String(length=512), nullable=False),
        sa.Column("attributes", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("specs", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_products_category_brand", "catalog_products", ["category_id", "brand_id"])
    op.create_index("ix_catalog_products_status", "catalog_products", ["status"])
    op.create_index("ix_catalog_products_attributes", "catalog_products", ["attributes"], postgresql_using="gin")
    op.create_index("ix_catalog_products_specs", "catalog_products", ["specs"], postgresql_using="gin")
    op.execute("CREATE INDEX ix_catalog_products_title_trgm ON catalog_products USING gin (lower(normalized_title) gin_trgm_ops)")

    op.create_table(
        "catalog_product_variants",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("variant_key", sa.String(length=190), nullable=False),
        sa.Column("color", sa.String(length=64)),
        sa.Column("storage", sa.String(length=64)),
        sa.Column("ram", sa.String(length=64)),
        sa.Column("other_attrs", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("product_id", "variant_key", name="uq_catalog_product_variant_key"),
    )
    op.create_index("ix_catalog_product_variants_product_id", "catalog_product_variants", ["product_id"])

    op.create_table(
        "catalog_store_products",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("store_id", sa.BigInteger(), sa.ForeignKey("catalog_stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="SET NULL")),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("external_url", sa.Text(), nullable=False),
        sa.Column("title_raw", sa.Text(), nullable=False),
        sa.Column("title_clean", sa.Text()),
        sa.Column("description_raw", sa.Text()),
        sa.Column("image_url", sa.Text()),
        sa.Column("availability", sa.String(length=32)),
        sa.Column("rating", sa.Numeric(3, 2)),
        sa.Column("review_count", sa.Integer()),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("store_id", "external_id", name="uq_catalog_store_products_store_external"),
    )
    op.create_index("ix_catalog_store_products_store_id", "catalog_store_products", ["store_id"])
    op.create_index("ix_catalog_store_products_product_id", "catalog_store_products", ["product_id"])
    op.create_index("ix_catalog_store_products_last_seen_at", "catalog_store_products", ["last_seen_at"])

    op.create_table(
        "catalog_offers",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("store_product_id", sa.BigInteger(), sa.ForeignKey("catalog_store_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_variant_id", sa.BigInteger(), sa.ForeignKey("catalog_product_variants.id", ondelete="SET NULL")),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="UZS"),
        sa.Column("price_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("old_price_amount", sa.Numeric(12, 2)),
        sa.Column("in_stock", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("shipping_cost", sa.Numeric(12, 2)),
        sa.Column("scraped_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_valid", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("price_amount >= 0", name="ck_catalog_offers_price_nonnegative"),
        sa.CheckConstraint("old_price_amount is null or old_price_amount >= 0", name="ck_catalog_offers_old_price_nonnegative"),
        sa.CheckConstraint("shipping_cost is null or shipping_cost >= 0", name="ck_catalog_offers_shipping_nonnegative"),
    )
    op.create_index("ix_catalog_offers_store_product_scraped", "catalog_offers", ["store_product_id", "scraped_at"])
    op.create_index("ix_catalog_offers_valid_stock_price", "catalog_offers", ["is_valid", "in_stock", "price_amount"])
    op.create_index("ix_catalog_offers_scraped_at", "catalog_offers", ["scraped_at"])

    op.create_table(
        "catalog_price_history",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("offer_id", sa.BigInteger(), sa.ForeignKey("catalog_offers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("price_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("in_stock", sa.Boolean(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_price_history_offer_captured", "catalog_price_history", ["offer_id", "captured_at"])
    op.create_index("ix_catalog_price_history_captured_at", "catalog_price_history", ["captured_at"])

    op.create_table(
        "catalog_product_embeddings",
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("embedding", Vector(768), nullable=False),
        sa.Column("model_name", sa.String(length=128), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_product_embeddings_model", "catalog_product_embeddings", ["model_name", "model_version"])
    op.execute(
        "CREATE INDEX ix_catalog_product_embeddings_vector ON catalog_product_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 200)"
    )

    op.create_table(
        "catalog_product_search",
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tsv", postgresql.TSVECTOR(), nullable=False),
        sa.Column("min_price", sa.Numeric(12, 2)),
        sa.Column("max_price", sa.Numeric(12, 2)),
        sa.Column("store_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_product_search_min_price", "catalog_product_search", ["min_price"])
    op.create_index("ix_catalog_product_search_max_price", "catalog_product_search", ["max_price"])
    op.create_index("ix_catalog_product_search_store_count", "catalog_product_search", ["store_count"])
    op.create_index("ix_catalog_product_search_tsv", "catalog_product_search", ["tsv"], postgresql_using="gin")

    op.create_table(
        "catalog_duplicate_candidates",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("product_id_a", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id_b", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("score", sa.Numeric(5, 4), nullable=False),
        sa.Column("reason", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("product_id_a", "product_id_b", name="uq_catalog_duplicate_pair"),
        sa.CheckConstraint("score >= 0 and score <= 1", name="ck_catalog_duplicate_score"),
    )
    op.create_index("ix_catalog_duplicate_status_score", "catalog_duplicate_candidates", ["status", "score"])

    op.create_table(
        "catalog_crawl_jobs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("store_id", sa.BigInteger(), sa.ForeignKey("catalog_stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", sa.BigInteger(), sa.ForeignKey("catalog_categories.id", ondelete="SET NULL")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_summary", sa.Text()),
    )
    op.create_index("ix_catalog_crawl_jobs_store_started", "catalog_crawl_jobs", ["store_id", "started_at"])

    op.create_table(
        "catalog_crawl_job_items",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("crawl_job_id", sa.BigInteger(), sa.ForeignKey("catalog_crawl_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text()),
    )
    op.create_index("ix_catalog_crawl_job_items_job_status", "catalog_crawl_job_items", ["crawl_job_id", "status"])

    op.create_table(
        "catalog_ai_enrichment_jobs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stage", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_ai_jobs_status_stage", "catalog_ai_enrichment_jobs", ["status", "stage"])
    op.create_index("ix_catalog_ai_jobs_product_id", "catalog_ai_enrichment_jobs", ["product_id"])


def downgrade() -> None:
    op.drop_table("catalog_ai_enrichment_jobs")
    op.drop_table("catalog_crawl_job_items")
    op.drop_table("catalog_crawl_jobs")
    op.drop_table("catalog_duplicate_candidates")
    op.drop_table("catalog_product_search")
    op.drop_table("catalog_product_embeddings")
    op.drop_table("catalog_price_history")
    op.drop_table("catalog_offers")
    op.drop_table("catalog_store_products")
    op.drop_table("catalog_product_variants")
    op.drop_table("catalog_products")
    op.drop_table("catalog_stores")
    op.drop_table("catalog_brands")
    op.drop_table("catalog_categories")
