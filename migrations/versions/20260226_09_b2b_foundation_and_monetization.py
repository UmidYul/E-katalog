"""add b2b foundation and monetization schema

Revision ID: 20260226_09
Revises: 20260226_08
Create Date: 2026-02-26 22:00:00
"""

from __future__ import annotations

from alembic import op


revision = "20260226_09"
down_revision = "20260226_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute(
        """
        create table if not exists b2b_organizations (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            slug varchar(120) not null unique,
            name varchar(160) not null,
            legal_name varchar(255),
            tax_id varchar(64),
            status varchar(16) not null default 'active',
            country_code varchar(2) not null default 'UZ',
            default_currency varchar(3) not null default 'UZS',
            website_url text,
            created_by_user_uuid uuid,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('active', 'pending', 'suspended', 'archived'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_organizations_status on b2b_organizations (status)")
    op.execute("create index if not exists ix_b2b_organizations_created_at on b2b_organizations (created_at desc)")

    op.execute(
        """
        create table if not exists b2b_org_memberships (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            user_uuid uuid not null,
            role varchar(32) not null,
            status varchar(16) not null default 'active',
            invited_by_user_uuid uuid,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique (org_id, user_uuid),
            check (role in ('owner', 'admin', 'marketing', 'analyst', 'finance', 'operator')),
            check (status in ('active', 'invited', 'disabled'))
        )
        """
    )
    op.execute(
        "create index if not exists ix_b2b_org_memberships_user_org_status on b2b_org_memberships (user_uuid, org_id, status)"
    )
    op.execute("create index if not exists ix_b2b_org_memberships_org_status on b2b_org_memberships (org_id, status)")

    op.execute(
        """
        create table if not exists b2b_org_invites (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            email varchar(255) not null,
            role varchar(32) not null,
            token_hash varchar(64) not null unique,
            status varchar(16) not null default 'pending',
            invited_by_user_uuid uuid not null,
            expires_at timestamptz not null,
            accepted_by_user_uuid uuid,
            accepted_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('pending', 'accepted', 'expired', 'revoked'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_org_invites_org_status on b2b_org_invites (org_id, status)")
    op.execute("create index if not exists ix_b2b_org_invites_email_status on b2b_org_invites (email, status)")

    op.execute(
        """
        create table if not exists b2b_org_audit_events (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            actor_user_uuid uuid,
            action varchar(128) not null,
            entity_type varchar(64) not null,
            entity_id text,
            payload jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now()
        )
        """
    )
    op.execute(
        "create index if not exists ix_b2b_org_audit_events_org_created on b2b_org_audit_events (org_id, created_at desc)"
    )
    op.execute(
        "create index if not exists ix_b2b_org_audit_events_action_created on b2b_org_audit_events (action, created_at desc)"
    )

    op.execute(
        """
        create table if not exists b2b_onboarding_applications (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            status varchar(16) not null default 'draft',
            company_name varchar(255) not null,
            legal_address text,
            billing_email varchar(255) not null,
            contact_name varchar(160) not null,
            contact_phone varchar(64),
            website_domain varchar(255),
            tax_id varchar(64),
            payout_details jsonb not null default '{}'::jsonb,
            rejection_reason text,
            submitted_at timestamptz,
            reviewed_at timestamptz,
            reviewed_by_user_uuid uuid,
            created_by_user_uuid uuid,
            updated_by_user_uuid uuid,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('draft', 'submitted', 'review', 'approved', 'rejected'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_onboarding_org_updated on b2b_onboarding_applications (org_id, updated_at desc)")
    op.execute("create index if not exists ix_b2b_onboarding_status_updated on b2b_onboarding_applications (status, updated_at desc)")

    op.execute(
        """
        create table if not exists b2b_kyc_documents (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            application_id bigint references b2b_onboarding_applications(id) on delete set null,
            document_type varchar(64) not null,
            storage_url text not null,
            checksum varchar(128),
            status varchar(16) not null default 'uploaded',
            review_notes text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('uploaded', 'review', 'approved', 'rejected'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_kyc_documents_org_status on b2b_kyc_documents (org_id, status)")

    op.execute(
        """
        create table if not exists b2b_contract_acceptances (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            contract_version varchar(64) not null,
            accepted_by_user_uuid uuid not null,
            accepted_at timestamptz not null default now(),
            ip_address varchar(128) not null default '',
            user_agent varchar(512) not null default '',
            unique (org_id, contract_version)
        )
        """
    )
    op.execute(
        "create index if not exists ix_b2b_contract_acceptances_org_accepted on b2b_contract_acceptances (org_id, accepted_at desc)"
    )

    op.execute(
        """
        create table if not exists b2b_org_store_links (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            store_id bigint not null references catalog_stores(id) on delete cascade,
            status varchar(16) not null default 'pending',
            ownership_verification_method varchar(64) not null default 'manual',
            verified_by_user_uuid uuid,
            verified_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique (org_id, store_id),
            check (status in ('pending', 'active', 'rejected', 'disabled'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_org_store_links_store_status on b2b_org_store_links (store_id, status)")

    op.execute(
        """
        create table if not exists b2b_feed_sources (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            store_id bigint not null references catalog_stores(id) on delete cascade,
            source_type varchar(32) not null default 'xml',
            source_url text not null,
            auth_config jsonb not null default '{}'::jsonb,
            schedule_cron varchar(64) not null default '0 */6 * * *',
            is_active boolean not null default true,
            status varchar(16) not null default 'active',
            created_by_user_uuid uuid,
            last_validated_at timestamptz,
            last_run_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('active', 'paused', 'error'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_feed_sources_org_updated on b2b_feed_sources (org_id, updated_at desc)")
    op.execute("create index if not exists ix_b2b_feed_sources_store_status on b2b_feed_sources (store_id, status)")

    op.execute(
        """
        create table if not exists b2b_feed_runs (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            feed_id bigint not null references b2b_feed_sources(id) on delete cascade,
            status varchar(16) not null default 'running',
            started_at timestamptz,
            finished_at timestamptz,
            total_items integer not null default 0,
            processed_items integer not null default 0,
            rejected_items integer not null default 0,
            error_summary text,
            quality_snapshot jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('pending', 'running', 'success', 'warning', 'error'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_feed_runs_feed_created on b2b_feed_runs (feed_id, created_at desc)")
    op.execute("create index if not exists ix_b2b_feed_runs_status_created on b2b_feed_runs (status, created_at desc)")

    op.execute(
        """
        create table if not exists b2b_feed_run_errors (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            feed_run_id bigint not null references b2b_feed_runs(id) on delete cascade,
            line_number integer,
            code varchar(64),
            message text not null,
            raw_payload jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now()
        )
        """
    )
    op.execute("create index if not exists ix_b2b_feed_run_errors_run_created on b2b_feed_run_errors (feed_run_id, created_at desc)")

    op.execute(
        """
        create table if not exists b2b_feed_quality_snapshots (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            feed_id bigint not null references b2b_feed_sources(id) on delete cascade,
            run_id bigint references b2b_feed_runs(id) on delete set null,
            availability_ratio numeric(5,4),
            price_anomaly_ratio numeric(5,4),
            duplicate_ratio numeric(5,4),
            stale_ratio numeric(5,4),
            image_quality_ratio numeric(5,4),
            summary jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now()
        )
        """
    )
    op.execute(
        "create index if not exists ix_b2b_feed_quality_snapshots_feed_created on b2b_feed_quality_snapshots (feed_id, created_at desc)"
    )

    op.execute(
        """
        create table if not exists b2b_campaigns (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            store_id bigint not null references catalog_stores(id) on delete cascade,
            name varchar(180) not null,
            status varchar(16) not null default 'draft',
            strategy varchar(32) not null default 'cpc',
            daily_budget numeric(12,2) not null default 0,
            monthly_budget numeric(12,2) not null default 0,
            spent_today numeric(12,2) not null default 0,
            spent_month numeric(12,2) not null default 0,
            bid_default numeric(12,2) not null default 0,
            bid_cap numeric(12,2) not null default 0,
            pacing_mode varchar(32) not null default 'even',
            starts_at timestamptz,
            ends_at timestamptz,
            created_by_user_uuid uuid,
            updated_by_user_uuid uuid,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('draft', 'active', 'paused', 'archived')),
            check (daily_budget >= 0 and monthly_budget >= 0 and bid_default >= 0 and bid_cap >= 0)
        )
        """
    )
    op.execute("create index if not exists ix_b2b_campaigns_org_status_updated on b2b_campaigns (org_id, status, updated_at desc)")
    op.execute("create index if not exists ix_b2b_campaigns_store_status_updated on b2b_campaigns (store_id, status, updated_at desc)")

    op.execute(
        """
        create table if not exists b2b_campaign_targets (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            campaign_id bigint not null references b2b_campaigns(id) on delete cascade,
            target_type varchar(32) not null,
            target_value varchar(255) not null,
            bid_override numeric(12,2),
            is_exclude boolean not null default false,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique (campaign_id, target_type, target_value)
        )
        """
    )
    op.execute("create index if not exists ix_b2b_campaign_targets_campaign on b2b_campaign_targets (campaign_id)")

    op.execute(
        """
        create table if not exists b2b_campaign_states (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            campaign_id bigint not null references b2b_campaigns(id) on delete cascade,
            state varchar(16) not null,
            reason text,
            actor_user_uuid uuid,
            created_at timestamptz not null default now(),
            check (state in ('draft', 'active', 'paused', 'archived'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_campaign_states_campaign_created on b2b_campaign_states (campaign_id, created_at desc)")

    op.execute(
        """
        create table if not exists b2b_campaign_offer_rules (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            campaign_id bigint not null references b2b_campaigns(id) on delete cascade,
            offer_id bigint not null references catalog_offers(id) on delete cascade,
            min_bid numeric(12,2),
            max_bid numeric(12,2),
            is_pinned boolean not null default false,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique (campaign_id, offer_id)
        )
        """
    )
    op.execute("create index if not exists ix_b2b_campaign_offer_rules_campaign on b2b_campaign_offer_rules (campaign_id)")

    op.execute(
        """
        create table if not exists b2b_click_events (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            event_ts timestamptz not null default now(),
            offer_id bigint not null references catalog_offers(id) on delete cascade,
            offer_uuid uuid not null,
            org_id bigint references b2b_organizations(id) on delete set null,
            campaign_id bigint references b2b_campaigns(id) on delete set null,
            store_id bigint references catalog_stores(id) on delete set null,
            source_page varchar(64) not null default 'unknown',
            placement varchar(64) not null default 'unknown',
            session_key varchar(128) not null default '',
            ip_hash varchar(128) not null default '',
            user_agent_hash varchar(128) not null default '',
            referrer text not null default '',
            destination_url text not null,
            attribution_token text not null default '',
            is_billable boolean not null default false,
            billed_amount numeric(12,2) not null default 0,
            status varchar(16) not null default 'valid',
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('valid', 'duplicate', 'fraud', 'void'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_click_events_org_event_ts on b2b_click_events (org_id, event_ts desc)")
    op.execute("create index if not exists ix_b2b_click_events_offer_event_ts on b2b_click_events (offer_id, event_ts desc)")
    op.execute("create index if not exists ix_b2b_click_events_campaign_event_ts on b2b_click_events (campaign_id, event_ts desc)")
    op.execute("create index if not exists ix_b2b_click_events_status_event_ts on b2b_click_events (status, event_ts desc)")
    op.execute("create index if not exists ix_b2b_click_events_source_placement on b2b_click_events (source_page, placement)")

    op.execute(
        """
        create table if not exists b2b_click_dedupe (
            id bigserial primary key,
            dedupe_key varchar(255) not null unique,
            click_event_uuid uuid not null,
            expires_at timestamptz not null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )
        """
    )
    op.execute("create index if not exists ix_b2b_click_dedupe_expires on b2b_click_dedupe (expires_at)")

    op.execute(
        """
        create table if not exists b2b_click_charges (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            click_event_id bigint not null references b2b_click_events(id) on delete cascade,
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            campaign_id bigint references b2b_campaigns(id) on delete set null,
            amount numeric(12,2) not null default 0,
            currency varchar(3) not null default 'UZS',
            status varchar(16) not null default 'posted',
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique (click_event_id),
            check (status in ('posted', 'refunded', 'void'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_click_charges_org_created on b2b_click_charges (org_id, created_at desc)")
    op.execute("create index if not exists ix_b2b_click_charges_campaign_created on b2b_click_charges (campaign_id, created_at desc)")

    op.execute(
        """
        create table if not exists b2b_click_disputes (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            click_charge_id bigint not null references b2b_click_charges(id) on delete cascade,
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            status varchar(16) not null default 'open',
            reason varchar(128),
            message text,
            resolution_note text,
            resolved_by_user_uuid uuid,
            resolved_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('open', 'review', 'accepted', 'rejected'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_click_disputes_org_status_created on b2b_click_disputes (org_id, status, created_at desc)")
    op.execute("create index if not exists ix_b2b_click_disputes_status_created on b2b_click_disputes (status, created_at desc)")

    op.execute(
        """
        create table if not exists b2b_fraud_flags (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            click_event_id bigint not null references b2b_click_events(id) on delete cascade,
            level varchar(16) not null default 'medium',
            code varchar(64) not null,
            details jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now(),
            check (level in ('low', 'medium', 'high', 'critical'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_fraud_flags_level_created on b2b_fraud_flags (level, created_at desc)")
    op.execute("create index if not exists ix_b2b_fraud_flags_click_event on b2b_fraud_flags (click_event_id)")

    op.execute(
        """
        create table if not exists b2b_plan_catalog (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            code varchar(64) not null unique,
            name varchar(120) not null,
            monthly_fee numeric(12,2) not null default 0,
            included_clicks integer not null default 0,
            click_price numeric(12,2) not null default 0,
            currency varchar(3) not null default 'UZS',
            limits jsonb not null default '{}'::jsonb,
            is_active boolean not null default true,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (monthly_fee >= 0 and included_clicks >= 0 and click_price >= 0)
        )
        """
    )
    op.execute("create index if not exists ix_b2b_plan_catalog_active_fee on b2b_plan_catalog (is_active, monthly_fee)")

    op.execute(
        """
        create table if not exists b2b_subscriptions (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            plan_id bigint not null references b2b_plan_catalog(id) on delete restrict,
            status varchar(16) not null default 'active',
            starts_at timestamptz not null default now(),
            renews_at timestamptz,
            ends_at timestamptz,
            cancelled_at timestamptz,
            created_by_user_uuid uuid,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('trial', 'active', 'past_due', 'cancelled'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_subscriptions_org_updated on b2b_subscriptions (org_id, updated_at desc)")
    op.execute("create index if not exists ix_b2b_subscriptions_status_updated on b2b_subscriptions (status, updated_at desc)")

    op.execute(
        """
        create table if not exists b2b_wallet_accounts (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            currency varchar(3) not null default 'UZS',
            balance numeric(14,2) not null default 0,
            credit_limit numeric(14,2) not null default 0,
            status varchar(16) not null default 'active',
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique (org_id),
            check (status in ('active', 'blocked', 'closed'))
        )
        """
    )

    op.execute(
        """
        create table if not exists b2b_wallet_transactions (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            wallet_account_id bigint not null references b2b_wallet_accounts(id) on delete cascade,
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            kind varchar(32) not null,
            amount numeric(14,2) not null,
            currency varchar(3) not null default 'UZS',
            reference_type varchar(64),
            reference_id text,
            note text,
            created_at timestamptz not null default now()
        )
        """
    )
    op.execute(
        "create index if not exists ix_b2b_wallet_transactions_wallet_created on b2b_wallet_transactions (wallet_account_id, created_at desc)"
    )
    op.execute("create index if not exists ix_b2b_wallet_transactions_org_created on b2b_wallet_transactions (org_id, created_at desc)")

    op.execute(
        """
        create table if not exists b2b_invoices (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            subscription_id bigint references b2b_subscriptions(id) on delete set null,
            invoice_number varchar(64) not null unique,
            status varchar(16) not null default 'draft',
            currency varchar(3) not null default 'UZS',
            subtotal numeric(14,2) not null default 0,
            tax_amount numeric(14,2) not null default 0,
            total_amount numeric(14,2) not null default 0,
            paid_amount numeric(14,2) not null default 0,
            period_from date,
            period_to date,
            due_at timestamptz,
            issued_at timestamptz,
            paid_at timestamptz,
            metadata jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_invoices_org_status_created on b2b_invoices (org_id, status, created_at desc)")
    op.execute("create index if not exists ix_b2b_invoices_due_at on b2b_invoices (due_at)")

    op.execute(
        """
        create table if not exists b2b_invoice_lines (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            invoice_id bigint not null references b2b_invoices(id) on delete cascade,
            line_type varchar(32) not null,
            description text not null,
            quantity numeric(12,3) not null default 1,
            unit_price numeric(14,2) not null default 0,
            amount numeric(14,2) not null default 0,
            metadata jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now()
        )
        """
    )
    op.execute("create index if not exists ix_b2b_invoice_lines_invoice on b2b_invoice_lines (invoice_id)")

    op.execute(
        """
        create table if not exists b2b_acts (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            invoice_id bigint not null references b2b_invoices(id) on delete cascade,
            act_number varchar(64) not null unique,
            status varchar(16) not null default 'issued',
            document_url text,
            issued_at timestamptz,
            signed_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique (invoice_id),
            check (status in ('issued', 'signed', 'void'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_acts_org_created on b2b_acts (org_id, created_at desc)")

    op.execute(
        """
        create table if not exists b2b_payments (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            invoice_id bigint not null references b2b_invoices(id) on delete cascade,
            provider varchar(32) not null,
            provider_payment_id varchar(128),
            status varchar(16) not null default 'pending',
            amount numeric(14,2) not null default 0,
            currency varchar(3) not null default 'UZS',
            metadata jsonb not null default '{}'::jsonb,
            paid_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (status in ('pending', 'succeeded', 'failed', 'refunded'))
        )
        """
    )
    op.execute("create index if not exists ix_b2b_payments_invoice_created on b2b_payments (invoice_id, created_at desc)")
    op.execute("create index if not exists ix_b2b_payments_org_created on b2b_payments (org_id, created_at desc)")
    op.execute("create index if not exists ix_b2b_payments_status_created on b2b_payments (status, created_at desc)")

    op.execute(
        """
        create table if not exists b2b_support_tickets (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            subject varchar(200) not null,
            category varchar(64) not null default 'technical',
            priority varchar(16) not null default 'normal',
            status varchar(32) not null default 'open',
            created_by_user_uuid uuid not null,
            assigned_to_user_uuid uuid,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (priority in ('low', 'normal', 'high', 'critical')),
            check (status in ('open', 'in_progress', 'waiting_merchant', 'resolved', 'closed'))
        )
        """
    )
    op.execute(
        "create index if not exists ix_b2b_support_tickets_org_status_updated on b2b_support_tickets (org_id, status, updated_at desc)"
    )
    op.execute("create index if not exists ix_b2b_support_tickets_status_priority on b2b_support_tickets (status, priority)")

    op.execute(
        """
        create table if not exists b2b_support_ticket_messages (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            ticket_id bigint not null references b2b_support_tickets(id) on delete cascade,
            author_user_uuid uuid,
            author_type varchar(16) not null default 'merchant',
            body text not null,
            attachments jsonb not null default '[]'::jsonb,
            created_at timestamptz not null default now(),
            check (author_type in ('merchant', 'admin', 'system'))
        )
        """
    )
    op.execute(
        "create index if not exists ix_b2b_support_ticket_messages_ticket_created on b2b_support_ticket_messages (ticket_id, created_at asc)"
    )

    op.execute(
        """
        create table if not exists b2b_notification_events (
            id bigserial primary key,
            uuid uuid not null unique default gen_random_uuid(),
            org_id bigint not null references b2b_organizations(id) on delete cascade,
            event_type varchar(64) not null,
            severity varchar(16) not null default 'info',
            payload jsonb not null default '{}'::jsonb,
            sent_via jsonb not null default '[]'::jsonb,
            sent_at timestamptz,
            created_at timestamptz not null default now(),
            check (severity in ('info', 'warning', 'critical'))
        )
        """
    )
    op.execute(
        "create index if not exists ix_b2b_notification_events_org_type_created on b2b_notification_events (org_id, event_type, created_at desc)"
    )
    op.execute(
        "create index if not exists ix_b2b_notification_events_severity_created on b2b_notification_events (severity, created_at desc)"
    )


def downgrade() -> None:
    op.execute("drop table if exists b2b_notification_events")
    op.execute("drop table if exists b2b_support_ticket_messages")
    op.execute("drop table if exists b2b_support_tickets")
    op.execute("drop table if exists b2b_payments")
    op.execute("drop table if exists b2b_acts")
    op.execute("drop table if exists b2b_invoice_lines")
    op.execute("drop table if exists b2b_invoices")
    op.execute("drop table if exists b2b_wallet_transactions")
    op.execute("drop table if exists b2b_wallet_accounts")
    op.execute("drop table if exists b2b_subscriptions")
    op.execute("drop table if exists b2b_plan_catalog")
    op.execute("drop table if exists b2b_fraud_flags")
    op.execute("drop table if exists b2b_click_disputes")
    op.execute("drop table if exists b2b_click_charges")
    op.execute("drop table if exists b2b_click_dedupe")
    op.execute("drop table if exists b2b_click_events")
    op.execute("drop table if exists b2b_campaign_offer_rules")
    op.execute("drop table if exists b2b_campaign_states")
    op.execute("drop table if exists b2b_campaign_targets")
    op.execute("drop table if exists b2b_campaigns")
    op.execute("drop table if exists b2b_feed_quality_snapshots")
    op.execute("drop table if exists b2b_feed_run_errors")
    op.execute("drop table if exists b2b_feed_runs")
    op.execute("drop table if exists b2b_feed_sources")
    op.execute("drop table if exists b2b_org_store_links")
    op.execute("drop table if exists b2b_contract_acceptances")
    op.execute("drop table if exists b2b_kyc_documents")
    op.execute("drop table if exists b2b_onboarding_applications")
    op.execute("drop table if exists b2b_org_audit_events")
    op.execute("drop table if exists b2b_org_invites")
    op.execute("drop table if exists b2b_org_memberships")
    op.execute("drop table if exists b2b_organizations")
