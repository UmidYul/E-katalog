"""extend b2b partner leads with tracking and provisioning metadata

Revision ID: 20260227_02
Revises: 20260227_01
Create Date: 2026-02-27 23:20:00
"""

from __future__ import annotations

from alembic import op


revision = "20260227_02"
down_revision = "20260227_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("alter table b2b_partner_leads add column if not exists tracking_token_hash varchar(64)")
    op.execute("alter table b2b_partner_leads add column if not exists provisioning_status varchar(16) not null default 'pending'")
    op.execute("alter table b2b_partner_leads add column if not exists provisioned_user_uuid uuid")
    op.execute("alter table b2b_partner_leads add column if not exists provisioned_org_uuid uuid")
    op.execute("alter table b2b_partner_leads add column if not exists onboarding_application_uuid uuid")
    op.execute("alter table b2b_partner_leads add column if not exists provisioned_at timestamptz")
    op.execute("alter table b2b_partner_leads add column if not exists provisioning_error text")
    op.execute("alter table b2b_partner_leads add column if not exists welcome_email_sent_at timestamptz")
    op.execute(
        """
        do $$
        begin
            if not exists (
                select 1
                from pg_constraint
                where conname = 'ck_b2b_partner_leads_provisioning_status'
            ) then
                alter table b2b_partner_leads
                add constraint ck_b2b_partner_leads_provisioning_status
                check (provisioning_status in ('pending', 'ready', 'failed'));
            end if;
        end;
        $$;
        """
    )
    op.execute(
        """
        create unique index if not exists ix_b2b_partner_leads_tracking_token_hash
        on b2b_partner_leads (tracking_token_hash)
        where tracking_token_hash is not null
        """
    )
    op.execute(
        """
        create index if not exists ix_b2b_partner_leads_provisioning_status_updated
        on b2b_partner_leads (provisioning_status, updated_at desc)
        """
    )


def downgrade() -> None:
    op.execute("drop index if exists ix_b2b_partner_leads_provisioning_status_updated")
    op.execute("drop index if exists ix_b2b_partner_leads_tracking_token_hash")
    op.execute("alter table b2b_partner_leads drop constraint if exists ck_b2b_partner_leads_provisioning_status")
    op.execute("alter table b2b_partner_leads drop column if exists welcome_email_sent_at")
    op.execute("alter table b2b_partner_leads drop column if exists provisioning_error")
    op.execute("alter table b2b_partner_leads drop column if exists provisioned_at")
    op.execute("alter table b2b_partner_leads drop column if exists onboarding_application_uuid")
    op.execute("alter table b2b_partner_leads drop column if exists provisioned_org_uuid")
    op.execute("alter table b2b_partner_leads drop column if exists provisioned_user_uuid")
    op.execute("alter table b2b_partner_leads drop column if exists provisioning_status")
    op.execute("alter table b2b_partner_leads drop column if exists tracking_token_hash")
