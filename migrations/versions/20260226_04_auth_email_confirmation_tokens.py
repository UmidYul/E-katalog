"""add auth email confirmation tokens table

Revision ID: 20260226_04
Revises: 20260226_03
Create Date: 2026-02-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260226_04"
down_revision = "20260226_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_email_confirmation_tokens",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("token_hash", name="uq_auth_email_confirmation_tokens_hash"),
    )
    op.create_index(
        "ix_auth_email_confirmation_tokens_user_expires",
        "auth_email_confirmation_tokens",
        ["user_id", "expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_auth_email_confirmation_tokens_user_expires", table_name="auth_email_confirmation_tokens")
    op.drop_table("auth_email_confirmation_tokens")
