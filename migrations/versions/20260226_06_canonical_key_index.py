"""add canonical key index table

Revision ID: 20260226_06
Revises: 20260226_05
Create Date: 2026-02-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260226_06"
down_revision = "20260226_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_canonical_key_index",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "uuid",
            sa.UUID(as_uuid=False),
            nullable=False,
            unique=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("canonical_key", sa.String(length=255), nullable=False),
        sa.Column(
            "canonical_product_id",
            sa.BigInteger(),
            sa.ForeignKey("catalog_canonical_products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("brand", sa.String(length=64), nullable=False, server_default="unknown"),
        sa.Column("model", sa.String(length=128), nullable=False, server_default="unknown"),
        sa.Column("storage", sa.String(length=32), nullable=False, server_default="unknown"),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="normalize"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("canonical_key", name="uq_catalog_canonical_key_index_key"),
    )

    op.create_index(
        "ix_catalog_canonical_key_index_product",
        "catalog_canonical_key_index",
        ["canonical_product_id"],
    )
    op.create_index(
        "ix_catalog_canonical_key_index_brand_model_storage",
        "catalog_canonical_key_index",
        ["brand", "model", "storage"],
    )
    op.create_index(
        "ix_catalog_canonical_key_index_updated_at",
        "catalog_canonical_key_index",
        [sa.text("updated_at desc")],
    )


def downgrade() -> None:
    op.drop_index("ix_catalog_canonical_key_index_updated_at", table_name="catalog_canonical_key_index")
    op.drop_index("ix_catalog_canonical_key_index_brand_model_storage", table_name="catalog_canonical_key_index")
    op.drop_index("ix_catalog_canonical_key_index_product", table_name="catalog_canonical_key_index")
    op.drop_table("catalog_canonical_key_index")
