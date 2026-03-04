"""add last_retry_at to catalog crawl job items

Revision ID: 20260304_01
Revises: 20260228_03
Create Date: 2026-03-04 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260304_01"
down_revision = "20260228_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("catalog_crawl_job_items", sa.Column("last_retry_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("catalog_crawl_job_items", "last_retry_at")
