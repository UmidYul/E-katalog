"""canonical active learning review cases

Revision ID: 20260226_08
Revises: 20260226_07
Create Date: 2026-02-26 19:45:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260226_08"
down_revision = "20260226_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_canonical_review_cases",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("uuid", postgresql.UUID(as_uuid=False), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("store_product_id", sa.BigInteger(), nullable=False),
        sa.Column("canonical_product_id", sa.BigInteger(), nullable=False),
        sa.Column("candidate_canonical_id", sa.BigInteger(), nullable=True),
        sa.Column("canonical_key", sa.String(length=255), nullable=False),
        sa.Column("signal_type", sa.String(length=32), nullable=False, server_default="low_confidence"),
        sa.Column("confidence_score", sa.Numeric(5, 4), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["store_product_id"], ["catalog_store_products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["canonical_product_id"], ["catalog_canonical_products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["candidate_canonical_id"], ["catalog_canonical_products.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("uuid", name="uq_catalog_canonical_review_cases_uuid"),
        sa.UniqueConstraint(
            "store_product_id",
            "canonical_product_id",
            "signal_type",
            name="uq_catalog_canonical_review_case_signal",
        ),
        sa.CheckConstraint(
            "confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)",
            name="ck_catalog_review_case_confidence",
        ),
    )
    op.create_index(
        "ix_catalog_review_case_status_created",
        "catalog_canonical_review_cases",
        ["status", sa.text("created_at desc")],
    )
    op.create_index(
        "ix_catalog_review_case_signal_status",
        "catalog_canonical_review_cases",
        ["signal_type", "status"],
    )
    op.create_index(
        "ix_catalog_review_case_canonical_created",
        "catalog_canonical_review_cases",
        ["canonical_product_id", sa.text("created_at desc")],
    )


def downgrade() -> None:
    op.drop_index("ix_catalog_review_case_canonical_created", table_name="catalog_canonical_review_cases")
    op.drop_index("ix_catalog_review_case_signal_status", table_name="catalog_canonical_review_cases")
    op.drop_index("ix_catalog_review_case_status_created", table_name="catalog_canonical_review_cases")
    op.drop_table("catalog_canonical_review_cases")
