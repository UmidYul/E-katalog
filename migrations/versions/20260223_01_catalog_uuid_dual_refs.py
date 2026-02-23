"""add uuid compatibility columns for catalog entities

Revision ID: 20260223_01
Revises: 20260220_02
Create Date: 2026-02-23
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260223_01"
down_revision = "20260220_02"
branch_labels = None
depends_on = None


UUID_TABLES: tuple[tuple[str, str], ...] = (
    ("catalog_categories", "ix_catalog_categories_uuid"),
    ("catalog_brands", "ix_catalog_brands_uuid"),
    ("catalog_stores", "ix_catalog_stores_uuid"),
    ("catalog_canonical_products", "ix_catalog_canonical_products_uuid"),
    ("catalog_scrape_sources", "ix_catalog_scrape_sources_uuid"),
    ("catalog_products", "ix_catalog_products_uuid"),
    ("catalog_product_variants", "ix_catalog_product_variants_uuid"),
    ("catalog_store_products", "ix_catalog_store_products_uuid"),
    ("catalog_sellers", "ix_catalog_sellers_uuid"),
    ("catalog_offers", "ix_catalog_offers_uuid"),
    ("catalog_price_history", "ix_catalog_price_history_uuid"),
    ("catalog_duplicate_candidates", "ix_catalog_duplicate_candidates_uuid"),
    ("catalog_canonical_merge_events", "ix_catalog_canonical_merge_events_uuid"),
    ("catalog_crawl_jobs", "ix_catalog_crawl_jobs_uuid"),
    ("catalog_crawl_job_items", "ix_catalog_crawl_job_items_uuid"),
    ("catalog_ai_enrichment_jobs", "ix_catalog_ai_enrichment_jobs_uuid"),
)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    for table_name, index_name in UUID_TABLES:
        op.add_column(
            table_name,
            sa.Column(
                "uuid",
                postgresql.UUID(as_uuid=False),
                nullable=True,
                server_default=sa.text("gen_random_uuid()"),
            ),
        )
        op.execute(sa.text(f"update {table_name} set uuid = gen_random_uuid() where uuid is null"))
        op.alter_column(table_name, "uuid", nullable=False)
        op.create_index(index_name, table_name, ["uuid"], unique=True)


def downgrade() -> None:
    for table_name, index_name in reversed(UUID_TABLES):
        op.drop_index(index_name, table_name=table_name)
        op.drop_column(table_name, "uuid")
