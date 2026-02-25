"""add postgres auth foundation tables

Revision ID: 20260225_02
Revises: 20260225_01
Create Date: 2026-02-25
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260225_02"
down_revision = "20260225_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "auth_users",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "uuid",
            postgresql.UUID(as_uuid=False),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False, server_default=sa.text("''")),
        sa.Column("role", sa.String(length=32), nullable=False, server_default=sa.text("'user'")),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("phone", sa.String(length=32), nullable=False, server_default=sa.text("''")),
        sa.Column("city", sa.String(length=120), nullable=False, server_default=sa.text("''")),
        sa.Column("telegram", sa.String(length=64), nullable=False, server_default=sa.text("''")),
        sa.Column("about", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "notification_preferences",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("twofa_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("twofa_secret", sa.String(length=255), nullable=True),
        sa.Column(
            "twofa_recovery_codes_hash",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("twofa_pending_secret", sa.String(length=255), nullable=True),
        sa.Column(
            "twofa_pending_recovery_codes_hash",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("auth_provider", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("uuid", name="uq_auth_users_uuid"),
        sa.UniqueConstraint("email", name="uq_auth_users_email"),
    )

    op.create_table(
        "auth_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device", sa.String(length=255), nullable=False, server_default=sa.text("'unknown device'")),
        sa.Column("ip_address", sa.String(length=64), nullable=False, server_default=sa.text("'unknown'")),
        sa.Column("location", sa.String(length=64), nullable=False, server_default=sa.text("'unknown'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "auth_session_tokens",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("auth_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_type", sa.String(length=16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_auth_session_tokens_token_hash"),
        sa.CheckConstraint("token_type in ('access', 'refresh')", name="ck_auth_session_tokens_type"),
    )

    op.create_table(
        "auth_oauth_identities",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("provider_user_id", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("provider", "provider_user_id", name="uq_auth_oauth_provider_user"),
        sa.UniqueConstraint("user_id", "provider", name="uq_auth_oauth_user_provider"),
    )

    op.create_table(
        "auth_password_reset_tokens",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("auth_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("token_hash", name="uq_auth_password_reset_tokens_hash"),
    )

    op.create_index("ix_auth_users_email", "auth_users", ["email"])
    op.create_index("ix_auth_users_role_active", "auth_users", ["role", "is_active"])
    op.create_index("ix_auth_users_last_seen_at", "auth_users", ["last_seen_at"])
    op.create_index("ix_auth_sessions_user_last_seen", "auth_sessions", ["user_id", "last_seen_at"])
    op.create_index("ix_auth_sessions_revoked_at", "auth_sessions", ["revoked_at"])
    op.create_index("ix_auth_session_tokens_session_type", "auth_session_tokens", ["session_id", "token_type"])
    op.create_index("ix_auth_session_tokens_user_type", "auth_session_tokens", ["user_id", "token_type"])
    op.create_index("ix_auth_session_tokens_expires_at", "auth_session_tokens", ["expires_at"])
    op.create_index("ix_auth_oauth_identities_user_id", "auth_oauth_identities", ["user_id"])
    op.create_index(
        "ix_auth_password_reset_tokens_user_expires",
        "auth_password_reset_tokens",
        ["user_id", "expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_auth_password_reset_tokens_user_expires", table_name="auth_password_reset_tokens")
    op.drop_index("ix_auth_oauth_identities_user_id", table_name="auth_oauth_identities")
    op.drop_index("ix_auth_session_tokens_expires_at", table_name="auth_session_tokens")
    op.drop_index("ix_auth_session_tokens_user_type", table_name="auth_session_tokens")
    op.drop_index("ix_auth_session_tokens_session_type", table_name="auth_session_tokens")
    op.drop_index("ix_auth_sessions_revoked_at", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_last_seen", table_name="auth_sessions")
    op.drop_index("ix_auth_users_last_seen_at", table_name="auth_users")
    op.drop_index("ix_auth_users_role_active", table_name="auth_users")
    op.drop_index("ix_auth_users_email", table_name="auth_users")
    op.drop_table("auth_password_reset_tokens")
    op.drop_table("auth_oauth_identities")
    op.drop_table("auth_session_tokens")
    op.drop_table("auth_sessions")
    op.drop_table("auth_users")

