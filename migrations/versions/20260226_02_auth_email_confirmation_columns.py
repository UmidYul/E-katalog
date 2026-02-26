"""add email confirmation columns to auth users

Revision ID: 20260226_02
Revises: 20260226_01
Create Date: 2026-02-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260226_02"
down_revision = "20260226_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "auth_users",
        sa.Column("email_confirmed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "auth_users",
        sa.Column("email_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("auth_users", "email_confirmed_at")
    op.drop_column("auth_users", "email_confirmed")
