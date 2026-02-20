"""soft merge for canonical products + merge audit trail

Revision ID: 20260220_02
Revises: 20260220_01
Create Date: 2026-02-20
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260220_02"
down_revision = "20260220_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "catalog_canonical_products",
        sa.Column("merged_into_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "catalog_canonical_products",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_foreign_key(
        "fk_catalog_canonical_products_merged_into_id",
        "catalog_canonical_products",
        "catalog_canonical_products",
        ["merged_into_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_catalog_canonical_products_is_active", "catalog_canonical_products", ["is_active"])
    op.create_index("ix_catalog_canonical_products_merged_into_id", "catalog_canonical_products", ["merged_into_id"])

    op.execute("drop index if exists uq_catalog_canonical_products_title_brand_category")
    op.execute(
        """
        create unique index uq_catalog_canonical_products_title_brand_category_active
        on catalog_canonical_products (category_id, coalesce(brand_id, 0), lower(normalized_title))
        where is_active = true
        """
    )

    op.create_table(
        "catalog_canonical_merge_events",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("from_product_id", sa.BigInteger(), sa.ForeignKey("catalog_canonical_products.id", ondelete="SET NULL")),
        sa.Column("to_product_id", sa.BigInteger(), sa.ForeignKey("catalog_canonical_products.id", ondelete="SET NULL")),
        sa.Column("reason", sa.String(length=128), nullable=False),
        sa.Column("score", sa.Numeric(5, 4)),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_canonical_merge_events_from", "catalog_canonical_merge_events", ["from_product_id"])
    op.create_index("ix_catalog_canonical_merge_events_to", "catalog_canonical_merge_events", ["to_product_id"])
    op.create_index("ix_catalog_canonical_merge_events_created_at", "catalog_canonical_merge_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_catalog_canonical_merge_events_created_at", table_name="catalog_canonical_merge_events")
    op.drop_index("ix_catalog_canonical_merge_events_to", table_name="catalog_canonical_merge_events")
    op.drop_index("ix_catalog_canonical_merge_events_from", table_name="catalog_canonical_merge_events")
    op.drop_table("catalog_canonical_merge_events")

    op.execute("drop index if exists uq_catalog_canonical_products_title_brand_category_active")
    op.execute(
        """
        create unique index uq_catalog_canonical_products_title_brand_category
        on catalog_canonical_products (category_id, coalesce(brand_id, 0), lower(normalized_title))
        """
    )

    op.drop_index("ix_catalog_canonical_products_merged_into_id", table_name="catalog_canonical_products")
    op.drop_index("ix_catalog_canonical_products_is_active", table_name="catalog_canonical_products")
    op.drop_constraint("fk_catalog_canonical_products_merged_into_id", "catalog_canonical_products", type_="foreignkey")
    op.drop_column("catalog_canonical_products", "is_active")
    op.drop_column("catalog_canonical_products", "merged_into_id")
