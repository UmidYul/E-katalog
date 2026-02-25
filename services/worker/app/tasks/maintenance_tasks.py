from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from statistics import median
from typing import Any

from celery import chain
import httpx
from redis.asyncio import Redis
from sqlalchemy import text

from app.platform.services.pipeline_offsets import ensure_offsets_table
from app.core.config import settings
from app.core.logging import logger
from app.db.session import AsyncSessionLocal
from app.celery_app import celery_app


def _to_ratio(count: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return float(count) / float(total)


def _quality_level(*, ratio: float, warn_threshold: float, critical_threshold: float) -> str:
    if ratio >= critical_threshold:
        return "critical"
    if ratio >= warn_threshold:
        return "warning"
    return "ok"


def _resolve_overall_quality_status(levels: list[str]) -> str:
    if "critical" in levels:
        return "critical"
    if "warning" in levels:
        return "warning"
    return "ok"


def _status_rank(value: str) -> int:
    normalized = str(value or "").strip().lower()
    rank_map = {"ok": 0, "warning": 1, "critical": 2}
    return rank_map.get(normalized, 0)


def _alert_severity(value: float, *, warn: float, critical: float) -> str | None:
    if value >= critical:
        return "critical"
    if value >= warn:
        return "warning"
    return None


def _parse_iso_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text_value = str(value).strip()
    if not text_value:
        return None
    normalized = text_value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


async def _fetch_quality_metrics(session) -> dict[str, int]:
    row = (
        await session.execute(
            text(
                """
                with active as (
                    select cp.id, coalesce(cp.main_image, '') as main_image
                    from catalog_canonical_products cp
                    where cp.is_active = true
                ),
                active_offer_counts as (
                    select
                        a.id,
                        count(distinct case when o.is_valid = true and o.in_stock = true then o.store_id end) as valid_store_count
                    from active a
                    left join catalog_offers o on o.canonical_product_id = a.id
                    group by a.id
                ),
                search_consistency as (
                    select
                        aoc.id,
                        aoc.valid_store_count,
                        coalesce(ps.store_count, 0) as index_store_count
                    from active_offer_counts aoc
                    left join catalog_product_search ps on ps.product_id = aoc.id
                ),
                image_quality as (
                    select
                        count(*) filter (
                            where main_image = ''
                               or lower(main_image) ~ '(banner|poster|promo|advert|logo|watermark|placeholder|preview|thumbnail|thumb|frame|photo[ _-][0-9]{4})'
                        ) as low_quality_main_image_products
                    from active
                ),
                valid_offer_stats as (
                    select
                        count(*) as total_valid_offers,
                        count(*) filter (
                            where o.scraped_at < now() - make_interval(hours => cast(:stale_offer_hours as integer))
                        ) as stale_valid_offers
                    from catalog_offers o
                    where o.is_valid = true
                      and o.in_stock = true
                )
                select
                    (select count(*) from active) as active_products,
                    (select count(*) from search_consistency where valid_store_count > 0) as active_with_valid_offers,
                    (select count(*) from search_consistency where valid_store_count = 0) as active_without_valid_offers,
                    (select count(*) from search_consistency where index_store_count <> valid_store_count) as search_mismatch_products,
                    (select low_quality_main_image_products from image_quality) as low_quality_main_image_products,
                    (select total_valid_offers from valid_offer_stats) as total_valid_offers,
                    (select stale_valid_offers from valid_offer_stats) as stale_valid_offers
                """
            ),
            {"stale_offer_hours": settings.quality_report_stale_offer_hours},
        )
    ).mappings().one()
    return {
        "active_products": int(row.get("active_products") or 0),
        "active_with_valid_offers": int(row.get("active_with_valid_offers") or 0),
        "active_without_valid_offers": int(row.get("active_without_valid_offers") or 0),
        "search_mismatch_products": int(row.get("search_mismatch_products") or 0),
        "low_quality_main_image_products": int(row.get("low_quality_main_image_products") or 0),
        "total_valid_offers": int(row.get("total_valid_offers") or 0),
        "stale_valid_offers": int(row.get("stale_valid_offers") or 0),
    }


async def _load_search_mismatch_product_ids(session, *, limit: int) -> list[int]:
    rows = (
        await session.execute(
            text(
                """
                with active_offer_counts as (
                    select
                        cp.id,
                        count(distinct case when o.is_valid = true and o.in_stock = true then o.store_id end) as valid_store_count
                    from catalog_canonical_products cp
                    left join catalog_offers o on o.canonical_product_id = cp.id
                    where cp.is_active = true
                    group by cp.id
                )
                select aoc.id
                from active_offer_counts aoc
                left join catalog_product_search ps on ps.product_id = aoc.id
                where coalesce(ps.store_count, 0) <> aoc.valid_store_count
                order by abs(coalesce(ps.store_count, 0) - aoc.valid_store_count) desc, aoc.id asc
                limit :limit
                """
            ),
            {"limit": max(1, int(limit))},
        )
    ).all()
    return [int(row.id) for row in rows if row.id is not None]


async def _reindex_search_for_products(session, *, product_ids: list[int]) -> int:
    if not product_ids:
        return 0
    unique_ids = sorted({int(product_id) for product_id in product_ids if int(product_id) > 0})
    if not unique_ids:
        return 0

    await session.execute(
        text(
            """
            insert into catalog_product_search (product_id, tsv, min_price, max_price, store_count, updated_at)
            select
                cp.id,
                to_tsvector('simple', coalesce(cp.normalized_title, '')) as tsv,
                min(o.price_amount) as min_price,
                max(o.price_amount) as max_price,
                count(distinct o.store_id) as store_count,
                now() as updated_at
            from catalog_canonical_products cp
            left join catalog_offers o
              on o.canonical_product_id = cp.id
             and o.is_valid = true
             and o.in_stock = true
            where cp.id = any(cast(:product_ids as bigint[]))
            group by cp.id
            on conflict (product_id) do update
              set tsv = excluded.tsv,
                  min_price = excluded.min_price,
                  max_price = excluded.max_price,
                  store_count = excluded.store_count,
                  updated_at = now()
            """
        ),
        {"product_ids": unique_ids},
    )
    return len(unique_ids)


async def _send_quality_alert_webhook(payload: dict[str, Any]) -> bool:
    url = str(settings.quality_report_alert_webhook_url or "").strip()
    if not url:
        return False
    try:
        timeout = httpx.Timeout(timeout=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("catalog_quality_alert_webhook_failed", error=str(exc))
        return False


@celery_app.task(bind=True)
def send_test_quality_alert(self) -> dict[str, Any]:
    return asyncio.run(_send_test_quality_alert())


async def _send_test_quality_alert() -> dict[str, Any]:
    payload = {
        "source": "catalog_quality_report",
        "event": "manual_test_alert",
        "status": "warning",
        "message": "Manual quality alert test",
        "summary": {
            "active_products": 0,
            "active_without_valid_offers": 0,
            "search_mismatch_products": 0,
            "stale_valid_offers": 0,
            "low_quality_main_image_products": 0,
        },
        "checks": {
            "manual_test": {
                "level": "warning",
                "ratio": 0.0,
                "count": 0,
                "total": 0,
            }
        },
        "created_at": datetime.now(UTC).isoformat(),
    }
    delivered = await _send_quality_alert_webhook(payload)
    if delivered:
        logger.info("catalog_quality_alert_webhook_test_sent")
    return {
        "status": "ok" if delivered else "failed",
        "delivered": bool(delivered),
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=5,
)
def generate_catalog_quality_report(self) -> dict:
    return asyncio.run(_generate_catalog_quality_report())


async def _generate_catalog_quality_report() -> dict:
    if not settings.quality_report_enabled:
        return {"status": "disabled", "at": datetime.now(UTC).isoformat()}

    async with AsyncSessionLocal() as session:
        initial_metrics = await _fetch_quality_metrics(session)
        autoheal_payload: dict[str, Any] = {
            "enabled": bool(settings.quality_report_autoheal_enabled),
            "triggered": False,
            "attempted_products": 0,
            "fixed_products": 0,
        }

        metrics = initial_metrics
        if settings.quality_report_autoheal_enabled and int(initial_metrics["search_mismatch_products"] or 0) > 0:
            mismatch_ids = await _load_search_mismatch_product_ids(
                session,
                limit=settings.quality_report_autoheal_max_products,
            )
            autoheal_payload["triggered"] = True
            autoheal_payload["attempted_products"] = len(mismatch_ids)
            fixed_count = await _reindex_search_for_products(session, product_ids=mismatch_ids)
            autoheal_payload["fixed_products"] = fixed_count
            metrics = await _fetch_quality_metrics(session)

        active_products = int(metrics.get("active_products") or 0)
        active_with_valid_offers = int(metrics.get("active_with_valid_offers") or 0)
        active_without_valid_offers = int(metrics.get("active_without_valid_offers") or 0)
        search_mismatch_products = int(metrics.get("search_mismatch_products") or 0)
        low_quality_main_image_products = int(metrics.get("low_quality_main_image_products") or 0)
        total_valid_offers = int(metrics.get("total_valid_offers") or 0)
        stale_valid_offers = int(metrics.get("stale_valid_offers") or 0)

        active_without_offers_ratio = _to_ratio(active_without_valid_offers, active_products)
        search_mismatch_ratio = _to_ratio(search_mismatch_products, active_products)
        stale_offer_ratio = _to_ratio(stale_valid_offers, total_valid_offers)
        low_quality_image_ratio = _to_ratio(low_quality_main_image_products, active_products)

        active_without_offers_level = _quality_level(
            ratio=active_without_offers_ratio,
            warn_threshold=settings.quality_report_active_without_offers_warn_ratio,
            critical_threshold=settings.quality_report_active_without_offers_critical_ratio,
        )
        search_mismatch_level = _quality_level(
            ratio=search_mismatch_ratio,
            warn_threshold=settings.quality_report_search_mismatch_warn_ratio,
            critical_threshold=settings.quality_report_search_mismatch_critical_ratio,
        )
        stale_offer_level = _quality_level(
            ratio=stale_offer_ratio,
            warn_threshold=settings.quality_report_stale_offer_warn_ratio,
            critical_threshold=settings.quality_report_stale_offer_critical_ratio,
        )
        low_quality_image_level = _quality_level(
            ratio=low_quality_image_ratio,
            warn_threshold=settings.quality_report_low_quality_image_warn_ratio,
            critical_threshold=settings.quality_report_low_quality_image_critical_ratio,
        )

        checks = {
            "active_without_valid_offers": {
                "level": active_without_offers_level,
                "count": active_without_valid_offers,
                "total": active_products,
                "ratio": active_without_offers_ratio,
                "warn_threshold": settings.quality_report_active_without_offers_warn_ratio,
                "critical_threshold": settings.quality_report_active_without_offers_critical_ratio,
            },
            "search_store_count_mismatch": {
                "level": search_mismatch_level,
                "count": search_mismatch_products,
                "total": active_products,
                "ratio": search_mismatch_ratio,
                "warn_threshold": settings.quality_report_search_mismatch_warn_ratio,
                "critical_threshold": settings.quality_report_search_mismatch_critical_ratio,
            },
            "stale_valid_offers": {
                "level": stale_offer_level,
                "count": stale_valid_offers,
                "total": total_valid_offers,
                "ratio": stale_offer_ratio,
                "warn_threshold": settings.quality_report_stale_offer_warn_ratio,
                "critical_threshold": settings.quality_report_stale_offer_critical_ratio,
                "stale_offer_hours": settings.quality_report_stale_offer_hours,
            },
            "low_quality_main_image": {
                "level": low_quality_image_level,
                "count": low_quality_main_image_products,
                "total": active_products,
                "ratio": low_quality_image_ratio,
                "warn_threshold": settings.quality_report_low_quality_image_warn_ratio,
                "critical_threshold": settings.quality_report_low_quality_image_critical_ratio,
            },
        }

        status = _resolve_overall_quality_status(
            [
                active_without_offers_level,
                search_mismatch_level,
                stale_offer_level,
                low_quality_image_level,
            ]
        )
        summary = {
            "active_products": active_products,
            "active_with_valid_offers": active_with_valid_offers,
            "active_without_valid_offers": active_without_valid_offers,
            "search_mismatch_products": search_mismatch_products,
            "total_valid_offers": total_valid_offers,
            "stale_valid_offers": stale_valid_offers,
            "low_quality_main_image_products": low_quality_main_image_products,
            "active_without_valid_offers_ratio": active_without_offers_ratio,
            "search_mismatch_ratio": search_mismatch_ratio,
            "stale_offer_ratio": stale_offer_ratio,
            "low_quality_image_ratio": low_quality_image_ratio,
            "autoheal": autoheal_payload,
        }

        inserted = (
            await session.execute(
                text(
                    """
                    insert into catalog_data_quality_reports (status, summary, checks)
                    values (:status, cast(:summary as jsonb), cast(:checks as jsonb))
                    returning id, uuid, created_at
                    """
                ),
                {
                    "status": status,
                    "summary": json.dumps(summary, ensure_ascii=False),
                    "checks": json.dumps(checks, ensure_ascii=False),
                },
            )
        ).mappings().one()
        await session.commit()

    report_id = int(inserted.get("id") or 0)
    report_uuid = str(inserted.get("uuid"))

    logger.info(
        "catalog_quality_report_generated",
        report_id=report_id,
        status=status,
        active_products=active_products,
        active_without_valid_offers=active_without_valid_offers,
        search_mismatch_products=search_mismatch_products,
        stale_valid_offers=stale_valid_offers,
        autoheal=autoheal_payload,
    )
    if status != "ok":
        logger.warning(
            "catalog_quality_report_threshold_exceeded",
            report_id=report_id,
            status=status,
            checks=checks,
        )

    min_alert_status = str(settings.quality_report_alert_min_status or "critical").strip().lower() or "critical"
    if _status_rank(status) >= _status_rank(min_alert_status):
        delivered = await _send_quality_alert_webhook(
            {
                "source": "catalog_quality_report",
                "report_id": report_id,
                "report_uuid": report_uuid,
                "status": status,
                "summary": summary,
                "checks": checks,
                "created_at": datetime.now(UTC).isoformat(),
            }
        )
        if delivered:
            logger.info(
                "catalog_quality_alert_webhook_sent",
                report_id=report_id,
                status=status,
                min_alert_status=min_alert_status,
            )

    return {
        "report_id": report_id,
        "report_uuid": report_uuid,
        "status": status,
        "summary": summary,
        "checks": checks,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def enqueue_catalog_quality_reports(self) -> str:
    return generate_catalog_quality_report.delay().id


async def _collect_order_alert_metrics(redis: Redis) -> dict[str, float]:
    raw_rows = await redis.lrange("admin:orders", 0, -1)
    total_orders = 0
    cancelled_orders = 0
    for raw in raw_rows:
        if not raw:
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            continue
        total_orders += 1
        if str(row.get("status", "")).strip().lower() == "cancelled":
            cancelled_orders += 1
    cancel_rate = (float(cancelled_orders) / float(total_orders)) if total_orders > 0 else 0.0
    return {
        "total_orders": float(total_orders),
        "cancelled_orders": float(cancelled_orders),
        "cancel_rate": cancel_rate,
    }


async def _collect_moderation_alert_metrics(redis: Redis) -> dict[str, float]:
    pending_total = 0
    moderation_minutes: list[float] = []

    async def collect(pattern: str) -> None:
        nonlocal pending_total
        async for key in redis.scan_iter(match=pattern):
            if key.count(":") != 2:
                continue
            if await redis.type(key) != "hash":
                continue
            payload = await redis.hgetall(key)
            if not payload:
                continue
            status = str(payload.get("status", "published")).strip().lower()
            if status == "pending":
                pending_total += 1

            created_at = _parse_iso_datetime(payload.get("created_at"))
            moderated_at = _parse_iso_datetime(payload.get("moderated_at"))
            if created_at and moderated_at and moderated_at >= created_at:
                moderation_minutes.append((moderated_at - created_at).total_seconds() / 60.0)

    await collect("feedback:review:rev_*")
    await collect("feedback:question:q_*")

    median_minutes = float(median(moderation_minutes)) if moderation_minutes else 0.0
    return {
        "pending_total": float(pending_total),
        "median_moderation_minutes": median_minutes,
    }


async def _build_admin_alert_candidates(session, redis: Redis) -> list[dict[str, Any]]:
    latest_quality = (
        await session.execute(
            text(
                """
                select summary
                from catalog_data_quality_reports
                order by created_at desc, id desc
                limit 1
                """
            )
        )
    ).mappings().first()
    quality_summary = latest_quality.get("summary") if latest_quality and isinstance(latest_quality.get("summary"), dict) else {}
    quality_without_offers_ratio = float(quality_summary.get("active_without_valid_offers_ratio") or 0.0)
    quality_search_mismatch_ratio = float(quality_summary.get("search_mismatch_ratio") or 0.0)

    operations_row = (
        await session.execute(
            text(
                """
                select
                    count(*)::int as total_runs,
                    count(*) filter (
                        where lower(status) in ('failed', 'failure', 'error', 'cancelled')
                    )::int as failed_runs
                from catalog_crawl_jobs
                where started_at >= now() - interval '24 hours'
                """
            )
        )
    ).mappings().one()
    total_runs = int(operations_row.get("total_runs") or 0)
    failed_runs = int(operations_row.get("failed_runs") or 0)
    failed_rate = (float(failed_runs) / float(total_runs)) if total_runs > 0 else 0.0

    order_metrics = await _collect_order_alert_metrics(redis)
    moderation_metrics = await _collect_moderation_alert_metrics(redis)

    rules = [
        {
            "code": "catalog_quality.active_without_valid_offers_ratio",
            "title": "Высокая доля товаров без валидных офферов",
            "source": "catalog_quality",
            "metric_value": quality_without_offers_ratio,
            "warn_threshold": float(settings.admin_alert_quality_warn_ratio),
            "critical_threshold": float(settings.admin_alert_quality_critical_ratio),
            "context": {"metric": "active_without_valid_offers_ratio"},
        },
        {
            "code": "catalog_quality.search_mismatch_ratio",
            "title": "Высокий search mismatch в каталоге",
            "source": "catalog_quality",
            "metric_value": quality_search_mismatch_ratio,
            "warn_threshold": float(settings.admin_alert_search_mismatch_warn_ratio),
            "critical_threshold": float(settings.admin_alert_search_mismatch_critical_ratio),
            "context": {"metric": "search_mismatch_ratio"},
        },
        {
            "code": "moderation.pending_total",
            "title": "Очередь модерации растет",
            "source": "moderation",
            "metric_value": float(moderation_metrics["pending_total"]),
            "warn_threshold": float(settings.admin_alert_moderation_pending_warn),
            "critical_threshold": float(settings.admin_alert_moderation_pending_critical),
            "context": {"metric": "pending_total"},
        },
        {
            "code": "orders.cancel_rate",
            "title": "Высокая доля отмен заказов",
            "source": "revenue",
            "metric_value": float(order_metrics["cancel_rate"]),
            "warn_threshold": float(settings.admin_alert_order_cancel_rate_warn),
            "critical_threshold": float(settings.admin_alert_order_cancel_rate_critical),
            "context": {
                "metric": "cancel_rate",
                "total_orders": int(order_metrics["total_orders"]),
                "cancelled_orders": int(order_metrics["cancelled_orders"]),
            },
        },
        {
            "code": "operations.failed_task_rate_24h",
            "title": "Повышенная доля неуспешных операций",
            "source": "operations",
            "metric_value": failed_rate,
            "warn_threshold": float(settings.admin_alert_operation_failed_rate_warn),
            "critical_threshold": float(settings.admin_alert_operation_failed_rate_critical),
            "context": {
                "metric": "failed_task_rate_24h",
                "total_runs": total_runs,
                "failed_runs": failed_runs,
            },
        },
    ]

    candidates: list[dict[str, Any]] = []
    for rule in rules:
        severity = _alert_severity(
            float(rule["metric_value"]),
            warn=float(rule["warn_threshold"]),
            critical=float(rule["critical_threshold"]),
        )
        candidates.append(
            {
                "code": str(rule["code"]),
                "title": str(rule["title"]),
                "source": str(rule["source"]),
                "severity": severity,
                "metric_value": float(rule["metric_value"]),
                "threshold_value": float(rule["critical_threshold"] if severity == "critical" else rule["warn_threshold"]),
                "context": {
                    **(rule.get("context") if isinstance(rule.get("context"), dict) else {}),
                    "warn_threshold": float(rule["warn_threshold"]),
                    "critical_threshold": float(rule["critical_threshold"]),
                },
            }
        )
    return candidates


async def _upsert_admin_alert_events(session, candidates: list[dict[str, Any]]) -> dict[str, int]:
    opened = 0
    resolved = 0
    updated = 0

    for candidate in candidates:
        code = str(candidate["code"])
        current = (
            await session.execute(
                text(
                    """
                    select id, uuid, status
                    from admin_alert_events
                    where code = :code
                      and status in ('open', 'ack')
                    order by created_at desc, id desc
                    limit 1
                    """
                ),
                {"code": code},
            )
        ).mappings().first()

        severity = candidate.get("severity")
        if severity is None:
            if current:
                await session.execute(
                    text(
                        """
                        update admin_alert_events
                        set status = 'resolved',
                            resolved_at = now(),
                            updated_at = now()
                        where id = :id
                        """
                    ),
                    {"id": int(current["id"])},
                )
                resolved += 1
            continue

        payload = {
            "title": str(candidate["title"]),
            "source": str(candidate["source"]),
            "severity": str(severity),
            "metric_value": float(candidate["metric_value"]),
            "threshold_value": float(candidate["threshold_value"]),
            "context": json.dumps(candidate.get("context") or {}, ensure_ascii=False),
        }

        if current:
            await session.execute(
                text(
                    """
                    update admin_alert_events
                    set title = :title,
                        source = :source,
                        severity = :severity,
                        status = 'open',
                        metric_value = :metric_value,
                        threshold_value = :threshold_value,
                        context = cast(:context as jsonb),
                        acknowledged_at = null,
                        resolved_at = null,
                        updated_at = now()
                    where id = :id
                    """
                ),
                {"id": int(current["id"]), **payload},
            )
            updated += 1
            continue

        await session.execute(
            text(
                """
                insert into admin_alert_events (
                    code,
                    title,
                    source,
                    severity,
                    status,
                    metric_value,
                    threshold_value,
                    context
                )
                values (
                    :code,
                    :title,
                    :source,
                    :severity,
                    'open',
                    :metric_value,
                    :threshold_value,
                    cast(:context as jsonb)
                )
                """
            ),
            {"code": code, **payload},
        )
        opened += 1

    return {"opened": opened, "updated": updated, "resolved": resolved}


async def _evaluate_admin_alert_events() -> dict[str, Any]:
    if not settings.admin_alerts_enabled:
        return {"status": "disabled", "at": datetime.now(UTC).isoformat()}

    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    async with AsyncSessionLocal() as session:
        candidates = await _build_admin_alert_candidates(session, redis)
        changes = await _upsert_admin_alert_events(session, candidates)
        await session.commit()
    if hasattr(redis, "aclose"):
        await redis.aclose()
    else:
        await redis.close()
    logger.info("admin_alert_events_evaluated", **changes)
    return {
        "status": "ok",
        "candidates": len(candidates),
        **changes,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def evaluate_admin_alert_events(self) -> dict[str, Any]:
    return asyncio.run(_evaluate_admin_alert_events())


@celery_app.task(bind=True)
def enqueue_admin_alert_evaluation(self) -> str:
    return evaluate_admin_alert_events.delay().id


async def _select_no_offer_deactivation_candidates(
    session,
    *,
    limit: int,
    min_age_hours: int,
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            text(
                """
                with stats as (
                    select
                        cp.id,
                        coalesce(max(o.scraped_at), cp.updated_at, cp.created_at) as last_activity_at,
                        count(distinct case when o.is_valid = true and o.in_stock = true then o.store_id end) as valid_store_count
                    from catalog_canonical_products cp
                    left join catalog_offers o on o.canonical_product_id = cp.id
                    where cp.is_active = true
                    group by cp.id, cp.updated_at, cp.created_at
                )
                select id, last_activity_at
                from stats
                where valid_store_count = 0
                  and last_activity_at <= now() - make_interval(hours => cast(:min_age_hours as integer))
                order by last_activity_at asc nulls first, id asc
                limit :limit
                """
            ),
            {
                "limit": max(1, int(limit)),
                "min_age_hours": max(1, int(min_age_hours)),
            },
        )
    ).mappings().all()
    candidates: list[dict[str, Any]] = []
    for row in rows:
        product_id = row.get("id")
        if product_id is None:
            continue
        candidates.append(
            {
                "id": int(product_id),
                "last_activity_at": str(row.get("last_activity_at")) if row.get("last_activity_at") is not None else None,
            }
        )
    return candidates


async def _deactivate_no_offer_products(*, limit: int, min_age_hours: int) -> dict[str, Any]:
    if not settings.quality_report_auto_deactivate_no_offer_enabled:
        return {"status": "disabled", "at": datetime.now(UTC).isoformat()}

    run_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as session:
        candidates = await _select_no_offer_deactivation_candidates(
            session,
            limit=limit,
            min_age_hours=min_age_hours,
        )
        candidate_ids = [int(item["id"]) for item in candidates]
        if not candidate_ids:
            return {
                "status": "noop",
                "run_id": run_id,
                "limit": int(limit),
                "min_age_hours": int(min_age_hours),
                "candidates": 0,
                "deactivated": 0,
                "at": datetime.now(UTC).isoformat(),
            }

        deactivated_ids = (
            await session.execute(
                text(
                    """
                    update catalog_canonical_products cp
                    set is_active = false,
                        updated_at = now()
                    where cp.id = any(cast(:ids as bigint[]))
                      and cp.is_active = true
                    returning cp.id
                    """
                ),
                {"ids": candidate_ids},
            )
        ).scalars().all()
        deactivated_ids = [int(item) for item in deactivated_ids]

        if deactivated_ids:
            await session.execute(
                text(
                    """
                    insert into catalog_canonical_merge_events (from_product_id, to_product_id, reason, score, payload)
                    select
                      d.id,
                      null::bigint,
                      'auto_deactivate_no_valid_offers',
                      null::numeric(5,4),
                      jsonb_build_object(
                        'run_id', cast(:run_id as text),
                        'cleanup_type', 'auto_deactivate_no_valid_offers',
                        'min_age_hours', cast(:min_age_hours as integer)
                      )
                    from unnest(cast(:ids as bigint[])) as d(id)
                    """
                ),
                {
                    "run_id": run_id,
                    "min_age_hours": int(min_age_hours),
                    "ids": deactivated_ids,
                },
            )

        await session.commit()
        logger.info(
            "auto_deactivate_no_offer_products_completed",
            run_id=run_id,
            candidates=len(candidate_ids),
            deactivated=len(deactivated_ids),
            limit=int(limit),
            min_age_hours=int(min_age_hours),
        )
        return {
            "status": "ok",
            "run_id": run_id,
            "limit": int(limit),
            "min_age_hours": int(min_age_hours),
            "candidates": len(candidate_ids),
            "deactivated": len(deactivated_ids),
            "candidates_preview": candidates[:20],
            "at": datetime.now(UTC).isoformat(),
        }


@celery_app.task(bind=True)
def deactivate_no_offer_products(self, limit: int | None = None, min_age_hours: int | None = None) -> dict[str, Any]:
    effective_limit = (
        int(limit) if isinstance(limit, int) and limit > 0 else int(settings.quality_report_auto_deactivate_no_offer_limit)
    )
    effective_min_age_hours = (
        int(min_age_hours)
        if isinstance(min_age_hours, int) and min_age_hours > 0
        else int(settings.quality_report_auto_deactivate_no_offer_hours)
    )
    return asyncio.run(
        _deactivate_no_offer_products(
            limit=effective_limit,
            min_age_hours=effective_min_age_hours,
        )
    )


@celery_app.task(bind=True)
def enqueue_auto_deactivate_no_offer_products(self) -> str:
    return deactivate_no_offer_products.delay().id


async def _cleanup_auth_sessions_redis(*, max_age_days: int, scan_limit: int) -> dict[str, Any]:
    if not settings.auth_session_cleanup_enabled:
        return {"status": "disabled", "at": datetime.now(UTC).isoformat()}

    cutoff = datetime.now(UTC) - timedelta(days=max(1, int(max_age_days)))
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    user_sets_scanned = 0
    sessions_scanned = 0
    sessions_revoked = 0
    stale_refs_removed = 0
    token_keys_removed = 0
    scan_cap = max(1, int(scan_limit))

    async for user_sessions_key in redis.scan_iter(match="auth:user:*:sessions"):
        user_sets_scanned += 1
        if user_sets_scanned > scan_cap:
            break
        session_ids = await redis.smembers(user_sessions_key)
        if not session_ids:
            continue

        for session_id in session_ids:
            sessions_scanned += 1
            session_key = f"auth:session:{session_id}"
            payload = await redis.hgetall(session_key)
            if not payload:
                await redis.srem(user_sessions_key, session_id)
                stale_refs_removed += 1
                continue

            last_seen = _parse_iso_datetime(payload.get("last_seen_at") or payload.get("created_at"))
            if last_seen is not None and last_seen >= cutoff:
                continue

            access_set_key = f"auth:session:{session_id}:access_tokens"
            refresh_set_key = f"auth:session:{session_id}:refresh_tokens"
            access_tokens = await redis.smembers(access_set_key)
            refresh_tokens = await redis.smembers(refresh_set_key)

            pipe = redis.pipeline()
            for token in access_tokens:
                pipe.delete(f"auth:access:{token}")
            for token in refresh_tokens:
                pipe.delete(f"auth:refresh:{token}")
            pipe.delete(session_key)
            pipe.delete(access_set_key)
            pipe.delete(refresh_set_key)
            pipe.srem(user_sessions_key, session_id)
            await pipe.execute()

            token_keys_removed += len(access_tokens) + len(refresh_tokens)
            sessions_revoked += 1

    if hasattr(redis, "aclose"):
        await redis.aclose()
    else:
        await redis.close()

    logger.info(
        "cleanup_auth_sessions_completed",
        max_age_days=max(1, int(max_age_days)),
        scan_limit=scan_cap,
        user_sets_scanned=user_sets_scanned,
        sessions_scanned=sessions_scanned,
        sessions_revoked=sessions_revoked,
        stale_refs_removed=stale_refs_removed,
        token_keys_removed=token_keys_removed,
    )

    return {
        "status": "ok",
        "max_age_days": max(1, int(max_age_days)),
        "scan_limit": scan_cap,
        "cutoff_at": cutoff.isoformat(),
        "user_sets_scanned": user_sets_scanned,
        "sessions_scanned": sessions_scanned,
        "sessions_revoked": sessions_revoked,
        "stale_refs_removed": stale_refs_removed,
        "token_keys_removed": token_keys_removed,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def cleanup_auth_sessions(self, max_age_days: int | None = None, scan_limit: int | None = None) -> dict[str, Any]:
    effective_max_age_days = (
        int(max_age_days)
        if isinstance(max_age_days, int) and max_age_days > 0
        else int(settings.auth_session_cleanup_max_age_days)
    )
    effective_scan_limit = (
        int(scan_limit)
        if isinstance(scan_limit, int) and scan_limit > 0
        else int(settings.auth_session_cleanup_scan_limit)
    )
    return asyncio.run(
        _cleanup_auth_sessions_redis(
            max_age_days=effective_max_age_days,
            scan_limit=effective_scan_limit,
        )
    )


@celery_app.task(bind=True)
def enqueue_cleanup_auth_sessions(self) -> str:
    return cleanup_auth_sessions.delay().id


@celery_app.task(bind=True)
def cleanup_stale_offers(self, days: int = 14) -> dict:
    return asyncio.run(_cleanup(days))


async def _cleanup(days: int) -> dict:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                update catalog_offers
                set is_valid = false
                where scraped_at < now() - (:days || ' days')::interval
                  and is_valid = true
                """
            ),
            {"days": days},
        )
        await session.commit()
        logger.info("cleanup_stale_offers_completed", rows=result.rowcount or 0)
        return {"invalidated": result.rowcount or 0, "at": datetime.now(UTC).isoformat()}


@celery_app.task(bind=True)
def rotate_price_history_partitions(self) -> dict:
    return {"status": "noop", "at": datetime.now(UTC).isoformat()}


@celery_app.task(bind=True)
def cleanup_empty_canonicals(self, limit: int = 1000) -> dict:
    return asyncio.run(_cleanup_empty_canonicals(limit))


async def _cleanup_empty_canonicals(limit: int) -> dict:
    run_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as session:
        updated_ids = (
            await session.execute(
                text(
                    """
                    with empty as (
                      select cp.id
                      from catalog_canonical_products cp
                      left join catalog_offers o on o.canonical_product_id = cp.id
                      where cp.is_active = true
                      group by cp.id
                      having count(o.id) = 0
                      order by cp.id
                      limit :limit
                    ),
                    deactivated as (
                      update catalog_canonical_products cp
                      set is_active = false,
                          updated_at = now()
                      from empty e
                      where cp.id = e.id
                      returning cp.id
                    )
                    select id from deactivated
                    """
                ),
                {"limit": limit},
            )
        ).scalars().all()

        if updated_ids:
            await session.execute(
                text(
                    """
                    insert into catalog_canonical_merge_events (from_product_id, to_product_id, reason, score, payload)
                    select
                      d.id,
                      null::bigint,
                      'cleanup_empty_canonical',
                      null::numeric(5,4),
                      jsonb_build_object(
                        'run_id', cast(:run_id as text),
                        'cleanup_type', 'deactivate_empty_without_offers'
                      )
                    from unnest(cast(:ids as bigint[])) as d(id)
                    """
                ),
                {"run_id": run_id, "ids": updated_ids},
            )

        await session.commit()
        logger.info(
            "cleanup_empty_canonicals_completed",
            run_id=run_id,
            deactivated=len(updated_ids),
            limit=limit,
        )
        return {
            "run_id": run_id,
            "deactivated": len(updated_ids),
            "limit": limit,
            "at": datetime.now(UTC).isoformat(),
        }


async def _prepare_full_catalog_rebuild() -> dict:
    async with AsyncSessionLocal() as session:
        await ensure_offsets_table(session)
        await session.execute(
            text(
                """
                delete from catalog_pipeline_offsets
                where job_name in ('normalize_store_products', 'reindex_product_search')
                """
            )
        )
        touched = await session.execute(text("update catalog_store_products set updated_at = now()"))
        await session.commit()
        touched_rows = int(touched.rowcount or 0)
        logger.info("prepare_full_catalog_rebuild_completed", touched_rows=touched_rows)
        return {"touched_rows": touched_rows}


@celery_app.task(bind=True)
def enqueue_full_catalog_rebuild(self) -> dict:
    prepared = asyncio.run(_prepare_full_catalog_rebuild())
    workflow = chain(
        celery_app.signature("app.tasks.normalize_tasks.normalize_product_batch"),
        celery_app.signature("app.tasks.dedupe_tasks.find_duplicate_candidates_task"),
        celery_app.signature("app.tasks.maintenance_tasks.cleanup_empty_canonicals"),
        celery_app.signature("app.tasks.reindex_tasks.reindex_product_search_batch"),
    )
    result = workflow.apply_async()
    logger.info("full_catalog_rebuild_enqueued", workflow_id=result.id, touched_rows=prepared["touched_rows"])
    return {"workflow_id": result.id, "touched_rows": prepared["touched_rows"], "at": datetime.now(UTC).isoformat()}
