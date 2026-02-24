"""add ai copy fields to canonical products

Revision ID: 20260224_01
Revises: 20260223_02
Create Date: 2026-02-24
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260224_01"
down_revision = "20260223_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("catalog_canonical_products", sa.Column("ai_short_description", sa.Text(), nullable=True))
    op.add_column(
        "catalog_canonical_products",
        sa.Column(
            "ai_whats_new",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column("catalog_canonical_products", sa.Column("ai_copy_source_hash", sa.String(length=64), nullable=True))
    op.add_column("catalog_canonical_products", sa.Column("ai_copy_generated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("catalog_canonical_products", "ai_copy_generated_at")
    op.drop_column("catalog_canonical_products", "ai_copy_source_hash")
    op.drop_column("catalog_canonical_products", "ai_whats_new")
    op.drop_column("catalog_canonical_products", "ai_short_description")
