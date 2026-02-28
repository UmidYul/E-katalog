"""add seller products and inventory log tables

Revision ID: 20260228_02
Revises: 20260228_01
Create Date: 2026-02-28 16:05:00
"""

from __future__ import annotations

from alembic import op


revision = "20260228_02"
down_revision = "20260228_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("create extension if not exists pgcrypto")
    op.execute(
        """
        create table if not exists seller_products (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            shop_id bigint not null references seller_shops(id) on delete cascade,
            source varchar(16) not null default 'manual',
            title varchar(255) not null,
            description text,
            category_id bigint references catalog_categories(id) on delete set null,
            images jsonb not null default '[]'::jsonb,
            price numeric(14,2) not null default 0,
            old_price numeric(14,2),
            sku varchar(120),
            barcode varchar(120),
            status varchar(24) not null default 'draft',
            moderation_comment text,
            track_inventory boolean not null default true,
            stock_quantity integer not null default 0,
            stock_reserved integer not null default 0,
            stock_alert_threshold integer,
            attributes jsonb not null default '{}'::jsonb,
            views_count integer not null default 0,
            clicks_count integer not null default 0,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (source in ('manual', 'feed_import', 'api')),
            check (status in ('draft', 'pending_moderation', 'active', 'rejected', 'archived')),
            check (price >= 0),
            check (old_price is null or old_price >= 0),
            check (stock_quantity >= 0),
            check (stock_reserved >= 0)
        )
        """
    )
    op.execute("create index if not exists ix_seller_products_shop_status on seller_products (shop_id, status)")
    op.execute("create index if not exists ix_seller_products_category on seller_products (category_id)")
    op.execute("create index if not exists ix_seller_products_title_trgm on seller_products using gin (lower(title) gin_trgm_ops)")
    op.execute("create index if not exists ix_seller_products_sku on seller_products (sku)")

    op.execute(
        """
        create table if not exists seller_inventory_log (
            id bigserial primary key,
            product_id bigint not null references seller_products(id) on delete cascade,
            shop_id bigint not null references seller_shops(id) on delete cascade,
            action varchar(24) not null,
            quantity_before integer not null,
            quantity_after integer not null,
            delta integer not null,
            reference_id uuid,
            comment text,
            created_by_user_uuid uuid,
            created_at timestamptz not null default now(),
            check (action in ('manual_update', 'order_reserved', 'order_released', 'order_completed', 'order_cancelled', 'import', 'api_update'))
        )
        """
    )
    op.execute("create index if not exists ix_seller_inventory_log_shop_created on seller_inventory_log (shop_id, created_at desc)")
    op.execute("create index if not exists ix_seller_inventory_log_product_created on seller_inventory_log (product_id, created_at desc)")


def downgrade() -> None:
    op.execute("drop index if exists ix_seller_inventory_log_product_created")
    op.execute("drop index if exists ix_seller_inventory_log_shop_created")
    op.execute("drop table if exists seller_inventory_log")
    op.execute("drop index if exists ix_seller_products_sku")
    op.execute("drop index if exists ix_seller_products_title_trgm")
    op.execute("drop index if exists ix_seller_products_category")
    op.execute("drop index if exists ix_seller_products_shop_status")
    op.execute("drop table if exists seller_products")
