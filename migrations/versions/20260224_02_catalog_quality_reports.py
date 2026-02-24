"""add catalog data quality reports table

Revision ID: 20260224_02
Revises: 20260224_01
Create Date: 2026-02-24
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260224_02"
down_revision = "20260224_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "catalog_data_quality_reports",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column(
            "uuid",
            postgresql.UUID(as_uuid=False),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column(
            "summary",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "checks",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("uuid", name="uq_catalog_data_quality_reports_uuid"),
    )
    op.create_index(
        "ix_catalog_quality_reports_created_at",
        "catalog_data_quality_reports",
        ["created_at"],
    )
    op.create_index(
        "ix_catalog_quality_reports_status_created",
        "catalog_data_quality_reports",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_catalog_quality_reports_status_created", table_name="catalog_data_quality_reports")
    op.drop_index("ix_catalog_quality_reports_created_at", table_name="catalog_data_quality_reports")
    op.drop_table("catalog_data_quality_reports")
