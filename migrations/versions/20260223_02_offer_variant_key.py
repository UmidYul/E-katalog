"""add variant key support for legacy offers

Revision ID: 20260223_02
Revises: 20260223_01
Create Date: 2026-02-23
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260223_02"
down_revision = "20260223_01"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return inspector.has_table(table_name)


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    try:
        columns = inspector.get_columns(table_name)
    except Exception:
        return False
    return any(column.get("name") == column_name for column in columns)


def upgrade() -> None:
    # This revision targets a legacy scraper table (`offers`).
    # In the production catalog schema we only have `catalog_offers`,
    # so the migration must be a no-op on fresh environments.
    if not _table_exists("offers"):
        return

    if not _column_exists("offers", "variant_key"):
        op.add_column(
            "offers",
            sa.Column("variant_key", sa.String(length=190), nullable=False, server_default="default"),
        )

    if not _column_exists("offers", "variant_attrs"):
        op.add_column(
            "offers",
            sa.Column("variant_attrs", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        )
    op.execute(sa.text("update offers set variant_key = 'default' where variant_key is null or variant_key = ''"))

    op.execute("alter table offers drop constraint if exists uq_offer_shop_link")
    op.execute("alter table offers drop constraint if exists uq_offer_shop_link_variant")
    op.create_unique_constraint("uq_offer_shop_link_variant", "offers", ["shop_id", "link", "variant_key"])


def downgrade() -> None:
    if not _table_exists("offers"):
        return

    op.execute("alter table offers drop constraint if exists uq_offer_shop_link_variant")
    op.create_unique_constraint("uq_offer_shop_link", "offers", ["shop_id", "link"])
    op.drop_column("offers", "variant_attrs")
    op.drop_column("offers", "variant_key")
