"""add homepage newsletter subscriptions table

Revision ID: 20260315_01
Revises: 20260309_01
Create Date: 2026-03-15 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260315_01"
down_revision = "20260309_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "catalog_newsletter_subscriptions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "uuid",
            postgresql.UUID(as_uuid=False),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column(
            "categories",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("locale", sa.String(length=32), nullable=False, server_default="ru-RU"),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="homepage"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("uuid", name="uq_catalog_newsletter_subscriptions_uuid"),
        sa.UniqueConstraint("email", name="uq_catalog_newsletter_subscriptions_email"),
        sa.CheckConstraint("jsonb_typeof(categories) = 'array'", name="ck_catalog_newsletter_categories_array"),
    )

    op.create_index(
        "ix_catalog_newsletter_subscriptions_updated_at",
        "catalog_newsletter_subscriptions",
        [sa.text("updated_at desc")],
    )
    op.create_index(
        "ix_catalog_newsletter_subscriptions_active_updated",
        "catalog_newsletter_subscriptions",
        ["is_active", sa.text("updated_at desc")],
    )


def downgrade() -> None:
    op.drop_index("ix_catalog_newsletter_subscriptions_active_updated", table_name="catalog_newsletter_subscriptions")
    op.drop_index("ix_catalog_newsletter_subscriptions_updated_at", table_name="catalog_newsletter_subscriptions")
    op.drop_table("catalog_newsletter_subscriptions")

