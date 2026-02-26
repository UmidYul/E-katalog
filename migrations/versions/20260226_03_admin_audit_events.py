"""add admin audit events table

Revision ID: 20260226_03
Revises: 20260226_02
Create Date: 2026-02-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260226_03"
down_revision = "20260226_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.create_table(
        "admin_audit_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "uuid",
            postgresql.UUID(as_uuid=False),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("actor_user_uuid", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("actor_role", sa.String(length=32), nullable=False, server_default=sa.text("'admin'")),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=255), nullable=True),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("method", sa.String(length=16), nullable=False, server_default=sa.text("''")),
        sa.Column("path", sa.String(length=512), nullable=False, server_default=sa.text("''")),
        sa.Column("ip_address", sa.String(length=64), nullable=False, server_default=sa.text("'unknown'")),
        sa.Column("user_agent", sa.String(length=512), nullable=False, server_default=sa.text("''")),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("uuid", name="uq_admin_audit_events_uuid"),
    )
    op.create_index("ix_admin_audit_events_created_at", "admin_audit_events", ["created_at"])
    op.create_index("ix_admin_audit_events_actor_created", "admin_audit_events", ["actor_user_uuid", "created_at"])
    op.create_index("ix_admin_audit_events_action_created", "admin_audit_events", ["action", "created_at"])
    op.create_index("ix_admin_audit_events_entity_created", "admin_audit_events", ["entity_type", "entity_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_admin_audit_events_entity_created", table_name="admin_audit_events")
    op.drop_index("ix_admin_audit_events_action_created", table_name="admin_audit_events")
    op.drop_index("ix_admin_audit_events_actor_created", table_name="admin_audit_events")
    op.drop_index("ix_admin_audit_events_created_at", table_name="admin_audit_events")
    op.drop_table("admin_audit_events")
