"""add public b2b partner leads intake queue

Revision ID: 20260227_01
Revises: 20260226_09
Create Date: 2026-02-27 16:30:00
"""

from __future__ import annotations

from alembic import op


revision = "20260227_01"
down_revision = "20260226_09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists b2b_partner_leads (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            status varchar(16) not null default 'submitted',
            company_name varchar(255) not null,
            legal_name varchar(255),
            brand_name varchar(255),
            tax_id varchar(64),
            website_url text,
            contact_name varchar(160) not null,
            contact_role varchar(120),
            email varchar(255) not null,
            phone varchar(64) not null,
            telegram varchar(64),
            country_code varchar(2) not null default 'UZ',
            city varchar(120),
            categories jsonb not null default '[]'::jsonb,
            monthly_orders integer,
            avg_order_value numeric(14,2),
            feed_url text,
            logistics_model varchar(32) not null default 'own_warehouse',
            warehouses_count integer,
            marketplaces jsonb not null default '[]'::jsonb,
            returns_policy text,
            goals text,
            notes text,
            review_note text,
            reviewed_by_user_uuid uuid,
            reviewed_at timestamptz,
            submitted_ip varchar(128),
            submitted_user_agent varchar(512),
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('submitted', 'review', 'approved', 'rejected')),
            check (logistics_model in ('own_warehouse', 'dropshipping', 'marketplace_fulfillment', 'hybrid'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_partner_leads_status_created on b2b_partner_leads (status, created_at desc)")
    op.execute("create index if not exists ix_b2b_partner_leads_email_created on b2b_partner_leads (email, created_at desc)")
    op.execute("create index if not exists ix_b2b_partner_leads_country_created on b2b_partner_leads (country_code, created_at desc)")


def downgrade() -> None:
    op.execute("drop index if exists ix_b2b_partner_leads_country_created")
    op.execute("drop index if exists ix_b2b_partner_leads_email_created")
    op.execute("drop index if exists ix_b2b_partner_leads_status_created")
    op.execute("drop table if exists b2b_partner_leads")
