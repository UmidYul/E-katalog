"""add catalog ingest quarantine table

Revision ID: 20260309_01
Revises: 20260304_01
Create Date: 2026-03-09 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260309_01"
down_revision = "20260304_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "catalog_ingest_quarantine",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "uuid",
            postgresql.UUID(as_uuid=False),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("store_id", sa.BigInteger(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("product_url", sa.Text(), nullable=False),
        sa.Column("title_raw", sa.Text(), nullable=False),
        sa.Column("description_raw", sa.Text(), nullable=True),
        sa.Column("price_raw", sa.String(length=64), nullable=True),
        sa.Column("currency_raw", sa.String(length=8), nullable=True),
        sa.Column("availability_raw", sa.String(length=64), nullable=True),
        sa.Column("images_raw", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("specs_raw", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("classifier_category", sa.String(length=64), nullable=True),
        sa.Column("classifier_confidence", sa.Numeric(5, 4), nullable=True),
        sa.Column("classifier_reason", sa.String(length=255), nullable=True),
        sa.Column(
            "validation_errors",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("seen_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["catalog_stores.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("uuid", name="uq_catalog_ingest_quarantine_uuid"),
        sa.UniqueConstraint("store_id", "payload_hash", name="uq_catalog_ingest_quarantine_store_payload_hash"),
        sa.CheckConstraint("status in ('open', 'resolved', 'discarded')", name="ck_catalog_ingest_quarantine_status"),
        sa.CheckConstraint(
            "classifier_confidence is null or (classifier_confidence >= 0 and classifier_confidence <= 1)",
            name="ck_catalog_ingest_quarantine_confidence",
        ),
    )
    op.create_index(
        "ix_catalog_ingest_quarantine_status_last_seen",
        "catalog_ingest_quarantine",
        ["status", sa.text("last_seen_at desc")],
    )
    op.create_index(
        "ix_catalog_ingest_quarantine_store_status",
        "catalog_ingest_quarantine",
        ["store_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_catalog_ingest_quarantine_store_status", table_name="catalog_ingest_quarantine")
    op.drop_index("ix_catalog_ingest_quarantine_status_last_seen", table_name="catalog_ingest_quarantine")
    op.drop_table("catalog_ingest_quarantine")
