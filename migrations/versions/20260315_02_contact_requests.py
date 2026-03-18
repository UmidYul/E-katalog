"""add contact requests table for public contacts page

Revision ID: 20260315_02
Revises: 20260315_01
Create Date: 2026-03-15 00:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260315_02"
down_revision = "20260315_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "catalog_contact_requests",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "uuid",
            postgresql.UUID(as_uuid=False),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("contact", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=32), nullable=False, server_default="general"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="contacts_page"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="new"),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("uuid", name="uq_catalog_contact_requests_uuid"),
        sa.CheckConstraint(
            "subject in ('general', 'technical', 'partnership', 'other')",
            name="ck_catalog_contact_requests_subject",
        ),
        sa.CheckConstraint("status in ('new', 'processed')", name="ck_catalog_contact_requests_status"),
    )

    op.create_index(
        "ix_catalog_contact_requests_created_at",
        "catalog_contact_requests",
        [sa.text("created_at desc")],
    )
    op.create_index(
        "ix_catalog_contact_requests_status_created",
        "catalog_contact_requests",
        ["status", sa.text("created_at desc")],
    )


def downgrade() -> None:
    op.drop_index("ix_catalog_contact_requests_status_created", table_name="catalog_contact_requests")
    op.drop_index("ix_catalog_contact_requests_created_at", table_name="catalog_contact_requests")
    op.drop_table("catalog_contact_requests")
