"""store sources for admin scraper control

Revision ID: 20260219_03
Revises: 20260219_02
Create Date: 2026-02-19 12:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260219_03"
down_revision = "20260219_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "catalog_stores",
        sa.Column("provider", sa.String(length=64), nullable=False, server_default="generic"),
    )
    op.add_column("catalog_stores", sa.Column("base_url", sa.Text(), nullable=True))
    op.create_index("ix_catalog_stores_provider", "catalog_stores", ["provider"])

    op.create_table(
        "catalog_scrape_sources",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("store_id", sa.BigInteger(), sa.ForeignKey("catalog_stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False, server_default="category"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("store_id", "url", name="uq_catalog_scrape_sources_store_url"),
    )
    op.create_index("ix_catalog_scrape_sources_store_id", "catalog_scrape_sources", ["store_id"])
    op.create_index("ix_catalog_scrape_sources_is_active", "catalog_scrape_sources", ["is_active"])
    op.create_index("ix_catalog_scrape_sources_priority", "catalog_scrape_sources", ["priority"])

    op.execute(
        sa.text(
            """
            update catalog_stores
            set provider = case
                when lower(name) like '%texnomart%' then 'texnomart'
                else 'generic'
            end
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_catalog_scrape_sources_priority", table_name="catalog_scrape_sources")
    op.drop_index("ix_catalog_scrape_sources_is_active", table_name="catalog_scrape_sources")
    op.drop_index("ix_catalog_scrape_sources_store_id", table_name="catalog_scrape_sources")
    op.drop_table("catalog_scrape_sources")

    op.drop_index("ix_catalog_stores_provider", table_name="catalog_stores")
    op.drop_column("catalog_stores", "base_url")
    op.drop_column("catalog_stores", "provider")
