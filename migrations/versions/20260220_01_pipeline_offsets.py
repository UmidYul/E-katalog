"""pipeline offsets for incremental worker jobs

Revision ID: 20260220_01
Revises: 20260219_03
Create Date: 2026-02-20
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260220_01"
down_revision = "20260219_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_pipeline_offsets",
        sa.Column("job_name", sa.Text(), primary_key=True),
        sa.Column("last_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_id", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_catalog_pipeline_offsets_updated_at", "catalog_pipeline_offsets", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_catalog_pipeline_offsets_updated_at", table_name="catalog_pipeline_offsets")
    op.drop_table("catalog_pipeline_offsets")
