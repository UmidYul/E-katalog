"""add admin alert events table

Revision ID: 20260225_01
Revises: 20260224_02
Create Date: 2026-02-25
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260225_01"
down_revision = "20260224_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "admin_alert_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column(
            "uuid",
            postgresql.UUID(as_uuid=False),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("code", sa.String(length=96), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'open'")),
        sa.Column("metric_value", sa.Numeric(precision=18, scale=6), nullable=False, server_default=sa.text("0")),
        sa.Column("threshold_value", sa.Numeric(precision=18, scale=6), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "context",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("uuid", name="uq_admin_alert_events_uuid"),
    )
    op.create_index("ix_admin_alert_events_created_at", "admin_alert_events", ["created_at"])
    op.create_index(
        "ix_admin_alert_events_status_severity_created",
        "admin_alert_events",
        ["status", "severity", "created_at"],
    )
    op.create_index("ix_admin_alert_events_source_code", "admin_alert_events", ["source", "code"])


def downgrade() -> None:
    op.drop_index("ix_admin_alert_events_source_code", table_name="admin_alert_events")
    op.drop_index("ix_admin_alert_events_status_severity_created", table_name="admin_alert_events")
    op.drop_index("ix_admin_alert_events_created_at", table_name="admin_alert_events")
    op.drop_table("admin_alert_events")
