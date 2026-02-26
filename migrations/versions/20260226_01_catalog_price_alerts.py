"""add catalog price alerts table

Revision ID: 20260226_01
Revises: 20260225_02
Create Date: 2026-02-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260226_01"
down_revision = "20260225_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "catalog_price_alerts",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "uuid",
            postgresql.UUID(as_uuid=False),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_uuid", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column(
            "product_id",
            sa.BigInteger(),
            sa.ForeignKey("catalog_canonical_products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("channel", sa.String(length=16), nullable=False, server_default=sa.text("'telegram'")),
        sa.Column("alerts_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("baseline_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("target_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("last_seen_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("last_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("uuid", name="uq_catalog_price_alerts_uuid"),
        sa.UniqueConstraint("user_uuid", "product_id", "channel", name="uq_catalog_price_alert_user_product_channel"),
        sa.CheckConstraint("channel in ('telegram','email')", name="ck_catalog_price_alert_channel"),
        sa.CheckConstraint("target_price is null or target_price >= 0", name="ck_catalog_price_alert_target_nonnegative"),
        sa.CheckConstraint("baseline_price is null or baseline_price >= 0", name="ck_catalog_price_alert_baseline_nonnegative"),
        sa.CheckConstraint("last_seen_price is null or last_seen_price >= 0", name="ck_catalog_price_alert_last_seen_nonnegative"),
    )

    op.create_index("ix_catalog_price_alert_user_channel", "catalog_price_alerts", ["user_uuid", "channel"])
    op.create_index("ix_catalog_price_alert_user_enabled", "catalog_price_alerts", ["user_uuid", "alerts_enabled"])
    op.create_index("ix_catalog_price_alert_product_enabled", "catalog_price_alerts", ["product_id", "alerts_enabled"])
    op.create_index("ix_catalog_price_alert_updated_at", "catalog_price_alerts", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_catalog_price_alert_updated_at", table_name="catalog_price_alerts")
    op.drop_index("ix_catalog_price_alert_product_enabled", table_name="catalog_price_alerts")
    op.drop_index("ix_catalog_price_alert_user_enabled", table_name="catalog_price_alerts")
    op.drop_index("ix_catalog_price_alert_user_channel", table_name="catalog_price_alerts")
    op.drop_table("catalog_price_alerts")

