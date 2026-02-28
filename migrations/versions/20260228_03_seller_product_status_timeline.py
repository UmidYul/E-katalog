"""add seller product status timeline

Revision ID: 20260228_03
Revises: 20260228_02
Create Date: 2026-02-28 21:10:00
"""

from __future__ import annotations

from alembic import op


revision = "20260228_03"
down_revision = "20260228_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("create extension if not exists pgcrypto")
    op.execute(
        """
        create table if not exists seller_product_status_events (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            product_id bigint not null references seller_products(id) on delete cascade,
            shop_id bigint not null references seller_shops(id) on delete cascade,
            from_status varchar(24),
            to_status varchar(24) not null,
            event_type varchar(32) not null default 'status_change',
            reason_code varchar(64),
            comment text,
            actor_role varchar(16) not null default 'system',
            actor_user_uuid uuid,
            metadata jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now(),
            check (from_status is null or from_status in ('draft', 'pending_moderation', 'active', 'rejected', 'archived')),
            check (to_status in ('draft', 'pending_moderation', 'active', 'rejected', 'archived')),
            check (actor_role in ('seller', 'admin', 'system'))
        )
        """
    )
    op.execute(
        "create index if not exists ix_seller_product_status_events_product_created "
        "on seller_product_status_events (product_id, created_at desc)"
    )
    op.execute(
        "create index if not exists ix_seller_product_status_events_shop_created "
        "on seller_product_status_events (shop_id, created_at desc)"
    )
    op.execute(
        "create index if not exists ix_seller_product_status_events_to_status_created "
        "on seller_product_status_events (to_status, created_at desc)"
    )
    op.execute(
        """
        insert into seller_product_status_events (
            product_id,
            shop_id,
            from_status,
            to_status,
            event_type,
            reason_code,
            comment,
            actor_role,
            actor_user_uuid,
            metadata,
            created_at
        )
        select
            p.id,
            p.shop_id,
            null,
            p.status,
            'status_snapshot',
            'migration_backfill',
            p.moderation_comment,
            'system',
            null,
            '{}'::jsonb,
            coalesce(p.updated_at, p.created_at)
        from seller_products p
        where not exists (
            select 1
            from seller_product_status_events e
            where e.product_id = p.id
        )
        """
    )


def downgrade() -> None:
    op.execute("drop index if exists ix_seller_product_status_events_to_status_created")
    op.execute("drop index if exists ix_seller_product_status_events_shop_created")
    op.execute("drop index if exists ix_seller_product_status_events_product_created")
    op.execute("drop table if exists seller_product_status_events")
