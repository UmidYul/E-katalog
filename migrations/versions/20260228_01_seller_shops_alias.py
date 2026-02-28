"""add seller_shops alias table for seller workspace

Revision ID: 20260228_01
Revises: 20260227_02
Create Date: 2026-02-28 15:30:00
"""

from __future__ import annotations

from alembic import op


revision = "20260228_01"
down_revision = "20260227_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("create extension if not exists pgcrypto")
    op.execute(
        """
        create table if not exists seller_shops (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_uuid uuid not null unique,
            owner_user_uuid uuid not null unique,
            slug varchar(120) not null unique,
            shop_name varchar(255) not null,
            status varchar(16) not null default 'active',
            website_url text,
            contact_email varchar(255) not null,
            contact_phone varchar(64) not null,
            is_auto_paused boolean not null default false,
            metadata jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('active', 'paused', 'banned', 'suspended'))
        )
        """
    )
    op.execute("create index if not exists ix_seller_shops_status on seller_shops (status)")
    op.execute("create index if not exists ix_seller_shops_updated_at on seller_shops (updated_at desc)")

    op.execute(
        """
        insert into seller_shops (
            org_uuid,
            owner_user_uuid,
            slug,
            shop_name,
            status,
            website_url,
            contact_email,
            contact_phone,
            metadata
        )
        select
            cast(l.provisioned_org_uuid as uuid) as org_uuid,
            cast(l.provisioned_user_uuid as uuid) as owner_user_uuid,
            left(
                regexp_replace(
                    lower(coalesce(nullif(o.slug, ''), nullif(l.company_name, ''), 'seller-shop')),
                    '[^a-z0-9]+',
                    '-',
                    'g'
                ),
                120
            ) as slug,
            coalesce(nullif(l.company_name, ''), nullif(o.name, ''), 'Seller Shop') as shop_name,
            case
                when o.status = 'active' then 'active'
                when o.status = 'pending' then 'paused'
                when o.status = 'suspended' then 'suspended'
                else 'paused'
            end as status,
            o.website_url,
            coalesce(nullif(l.email, ''), 'unknown@example.local') as contact_email,
            coalesce(nullif(l.phone, ''), '+998000000000') as contact_phone,
            jsonb_build_object(
                'seeded_from', 'b2b_partner_leads',
                'lead_uuid', l.uuid::text,
                'org_uuid', o.uuid::text
            ) as metadata
        from b2b_partner_leads l
        join b2b_organizations o on o.uuid = cast(l.provisioned_org_uuid as uuid)
        where l.status = 'approved'
          and l.provisioning_status = 'ready'
          and l.provisioned_org_uuid is not null
          and l.provisioned_user_uuid is not null
        on conflict (org_uuid) do nothing
        """
    )


def downgrade() -> None:
    op.execute("drop index if exists ix_seller_shops_updated_at")
    op.execute("drop index if exists ix_seller_shops_status")
    op.execute("drop table if exists seller_shops")
