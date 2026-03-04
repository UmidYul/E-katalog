from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any

from sqlalchemy import text

from app.celery_app import celery_app
from app.core.asyncio_runner import run_async_task
from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from shared.utils.time import UTC


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


@celery_app.task(bind=True)
def generate_b2b_subscription_invoices(self, limit: int = 500) -> dict[str, Any]:
    return run_async_task(_generate_b2b_subscription_invoices(limit=limit))


async def _generate_b2b_subscription_invoices(*, limit: int = 500) -> dict[str, Any]:
    effective_limit = max(1, min(int(limit), 5000))
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                text(
                    """
                    with candidates as (
                        select
                            s.id as subscription_id,
                            s.org_id,
                            p.monthly_fee,
                            p.currency,
                            p.code as plan_code
                        from b2b_subscriptions s
                        join b2b_plan_catalog p on p.id = s.plan_id
                        where s.status in ('active', 'past_due', 'trial')
                          and not exists (
                              select 1
                              from b2b_invoices i
                              where i.subscription_id = s.id
                                and date_trunc('month', i.created_at) = date_trunc('month', now())
                                and i.status in ('draft', 'issued', 'partially_paid', 'paid')
                          )
                        order by s.updated_at asc
                        limit :limit
                    )
                    insert into b2b_invoices (
                        org_id,
                        subscription_id,
                        invoice_number,
                        status,
                        currency,
                        subtotal,
                        tax_amount,
                        total_amount,
                        paid_amount,
                        period_from,
                        period_to,
                        due_at,
                        issued_at,
                        created_at,
                        updated_at
                    )
                    select
                        c.org_id,
                        c.subscription_id,
                        concat('INV-', to_char(now(), 'YYYYMMDD'), '-', upper(substring(md5(random()::text) from 1 for 6))),
                        'issued',
                        c.currency,
                        c.monthly_fee,
                        0,
                        c.monthly_fee,
                        0,
                        date_trunc('month', now())::date,
                        (date_trunc('month', now()) + interval '1 month - 1 day')::date,
                        now() + interval '7 day',
                        now(),
                        now(),
                        now()
                    from candidates c
                    returning id, subscription_id, subtotal, org_id
                    """
                ),
                {"limit": effective_limit},
            )
        ).mappings().all()

        created = 0
        for row in rows:
            await session.execute(
                text(
                    """
                    insert into b2b_invoice_lines (
                        invoice_id,
                        line_type,
                        description,
                        quantity,
                        unit_price,
                        amount,
                        metadata
                    )
                    select
                        :invoice_id,
                        'subscription',
                        concat('Subscription monthly fee #', cast(:subscription_id as text)),
                        1,
                        :amount,
                        :amount,
                        cast(:metadata as jsonb)
                    """
                ),
                {
                    "invoice_id": int(row["id"]),
                    "subscription_id": int(row["subscription_id"]),
                    "amount": float(row["subtotal"]),
                    "metadata": '{"source":"worker.invoice_scheduler"}',
                },
            )
            created += 1

        await session.commit()

    logger.info("b2b_subscription_invoices_generated", created=created, limit=effective_limit)
    return {"created": created, "limit": effective_limit, "at": _now_iso()}


@celery_app.task(bind=True)
def generate_b2b_acts_for_paid_invoices(self, limit: int = 1000) -> dict[str, Any]:
    return run_async_task(_generate_b2b_acts_for_paid_invoices(limit=limit))


async def _generate_b2b_acts_for_paid_invoices(*, limit: int = 1000) -> dict[str, Any]:
    effective_limit = max(1, min(int(limit), 5000))
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                text(
                    """
                    with paid as (
                        select i.id, i.org_id
                        from b2b_invoices i
                        where i.status = 'paid'
                          and not exists (select 1 from b2b_acts a where a.invoice_id = i.id)
                        order by i.updated_at asc
                        limit :limit
                    )
                    insert into b2b_acts (
                        org_id,
                        invoice_id,
                        act_number,
                        status,
                        document_url,
                        issued_at,
                        created_at,
                        updated_at
                    )
                    select
                        p.org_id,
                        p.id,
                        concat('ACT-', to_char(now(), 'YYYYMM'), '-', upper(substring(md5(random()::text) from 1 for 6))),
                        'issued',
                        concat('/documents/acts/', p.id, '-', :suffix, '.pdf'),
                        now(),
                        now(),
                        now()
                    from paid p
                    returning id
                    """
                ),
                {"limit": effective_limit, "suffix": secrets.token_hex(2)},
            )
        ).mappings().all()
        await session.commit()

    created = len(rows)
    logger.info("b2b_acts_generated_for_paid_invoices", created=created, limit=effective_limit)
    return {"created": created, "limit": effective_limit, "at": _now_iso()}


@celery_app.task(bind=True)
def scan_b2b_click_fraud_flags(self, limit: int = 5000) -> dict[str, Any]:
    return run_async_task(_scan_b2b_click_fraud_flags(limit=limit))


async def _scan_b2b_click_fraud_flags(*, limit: int = 5000) -> dict[str, Any]:
    effective_limit = max(100, min(int(limit), 50000))
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                text(
                    """
                    with suspicious as (
                        select
                            e.id as click_event_id,
                            count(*) over (
                                partition by e.offer_id, e.ip_hash, date_trunc('minute', e.event_ts)
                            ) as burst_count
                        from b2b_click_events e
                        where e.event_ts >= now() - interval '24 hours'
                        order by e.event_ts desc
                        limit :limit
                    )
                    insert into b2b_fraud_flags (click_event_id, level, code, details, created_at)
                    select
                        s.click_event_id,
                        case when s.burst_count >= 30 then 'critical' else 'high' end,
                        'burst_click_pattern',
                        jsonb_build_object('burst_count', s.burst_count),
                        now()
                    from suspicious s
                    where s.burst_count >= 15
                      and not exists (
                          select 1
                          from b2b_fraud_flags f
                          where f.click_event_id = s.click_event_id
                            and f.code = 'burst_click_pattern'
                      )
                    returning id
                    """
                ),
                {"limit": effective_limit},
            )
        ).mappings().all()
        await session.commit()

    flagged = len(rows)
    logger.info("b2b_fraud_scan_completed", flagged=flagged, limit=effective_limit)
    return {"flagged": flagged, "limit": effective_limit, "at": _now_iso()}


@celery_app.task(bind=True)
def validate_b2b_feed_health(self, stale_hours: int = 12, limit: int = 2000) -> dict[str, Any]:
    return run_async_task(_validate_b2b_feed_health(stale_hours=stale_hours, limit=limit))


async def _validate_b2b_feed_health(*, stale_hours: int = 12, limit: int = 2000) -> dict[str, Any]:
    effective_limit = max(1, min(int(limit), 5000))
    effective_hours = max(1, int(stale_hours))
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                text(
                    """
                    with stale as (
                        select f.id, f.org_id
                        from b2b_feed_sources f
                        where f.is_active = true
                          and (f.last_validated_at is null or f.last_validated_at < now() - make_interval(hours => :stale_hours))
                        order by coalesce(f.last_validated_at, f.created_at) asc
                        limit :limit
                    ),
                    updated as (
                        update b2b_feed_sources f
                        set status = 'error',
                            updated_at = now()
                        from stale s
                        where f.id = s.id
                        returning f.id, f.org_id
                    )
                    insert into b2b_notification_events (org_id, event_type, severity, payload, created_at)
                    select
                        u.org_id,
                        'feed.stale',
                        'warning',
                        jsonb_build_object('feed_id', u.id, 'stale_hours', :stale_hours),
                        now()
                    from updated u
                    returning id
                    """
                ),
                {"stale_hours": effective_hours, "limit": effective_limit},
            )
        ).mappings().all()
        await session.commit()

    notified = len(rows)
    logger.info("b2b_feed_health_validation_completed", notifications=notified, stale_hours=effective_hours, limit=effective_limit)
    return {"notifications": notified, "stale_hours": effective_hours, "limit": effective_limit, "at": _now_iso()}
