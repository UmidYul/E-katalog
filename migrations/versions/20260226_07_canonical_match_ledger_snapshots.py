"""add canonical match ledger and snapshots

Revision ID: 20260226_07
Revises: 20260226_06
Create Date: 2026-02-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260226_07"
down_revision = "20260226_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_canonical_match_ledger",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "uuid",
            postgresql.UUID(as_uuid=False),
            nullable=False,
            unique=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("store_product_id", sa.BigInteger(), sa.ForeignKey("catalog_store_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("canonical_product_id", sa.BigInteger(), sa.ForeignKey("catalog_canonical_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("canonical_key", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False, server_default="upsert_match"),
        sa.Column("match_type", sa.String(length=32), nullable=False, server_default="normalized"),
        sa.Column("confidence_score", sa.Numeric(5, 4), nullable=True),
        sa.Column("engine_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("flags", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)",
            name="ck_catalog_match_ledger_confidence",
        ),
    )
    op.create_index(
        "ix_catalog_match_ledger_store_product_created",
        "catalog_canonical_match_ledger",
        ["store_product_id", sa.text("created_at desc")],
    )
    op.create_index(
        "ix_catalog_match_ledger_canonical_created",
        "catalog_canonical_match_ledger",
        ["canonical_product_id", sa.text("created_at desc")],
    )
    op.create_index(
        "ix_catalog_match_ledger_key_created",
        "catalog_canonical_match_ledger",
        ["canonical_key", sa.text("created_at desc")],
    )

    op.create_table(
        "catalog_canonical_match_snapshots",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "uuid",
            postgresql.UUID(as_uuid=False),
            nullable=False,
            unique=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("canonical_product_id", sa.BigInteger(), sa.ForeignKey("catalog_canonical_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("canonical_key", sa.String(length=255), nullable=False),
        sa.Column("offers_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_match_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("snapshot_date", "canonical_product_id", "canonical_key", name="uq_catalog_match_snapshot_date_key"),
    )
    op.create_index("ix_catalog_match_snapshot_date", "catalog_canonical_match_snapshots", [sa.text("snapshot_date desc")])
    op.create_index("ix_catalog_match_snapshot_canonical", "catalog_canonical_match_snapshots", ["canonical_product_id"])


def downgrade() -> None:
    op.drop_index("ix_catalog_match_snapshot_canonical", table_name="catalog_canonical_match_snapshots")
    op.drop_index("ix_catalog_match_snapshot_date", table_name="catalog_canonical_match_snapshots")
    op.drop_table("catalog_canonical_match_snapshots")

    op.drop_index("ix_catalog_match_ledger_key_created", table_name="catalog_canonical_match_ledger")
    op.drop_index("ix_catalog_match_ledger_canonical_created", table_name="catalog_canonical_match_ledger")
    op.drop_index("ix_catalog_match_ledger_store_product_created", table_name="catalog_canonical_match_ledger")
    op.drop_table("catalog_canonical_match_ledger")

