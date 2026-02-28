from __future__ import annotations

import asyncio
import json
import smtplib
import uuid
from datetime import datetime, timedelta
from shared.utils.time import UTC
from decimal import Decimal
from email.message import EmailMessage
from statistics import median
from typing import Any

from celery import chain
import httpx
from redis.asyncio import Redis
from sqlalchemy import text

from app.platform.services.pipeline_offsets import ensure_offsets_table
from app.platform.services.canonical_index import sync_canonical_key_index_batch
from app.core.config import settings
from app.core.logging import logger
from app.db.session import AsyncSessionLocal, engine
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


async def _adaptive_thresholds(
    session,
    *,
    metric_key: str,
    warn_threshold: float,
    critical_threshold: float,
) -> tuple[float, float]:
    if not settings.quality_report_adaptive_thresholds_enabled:
        return warn_threshold, critical_threshold

    window = max(3, int(settings.quality_report_adaptive_window_reports))
    rows = (
        await session.execute(
            text(
                """
                select cast(summary ->> :metric_key as double precision) as metric
                from catalog_data_quality_reports
                where summary ? :metric_key
                order by created_at desc
                limit :limit
                """
            ),
            {"metric_key": metric_key, "limit": window},
        )
    ).all()
    values = [float(row.metric) for row in rows if row.metric is not None]
    if len(values) < 3:
        return warn_threshold, critical_threshold

    baseline = float(median(values))
    if baseline <= warn_threshold:
        return warn_threshold, critical_threshold

    warn_scale = min(2.0, max(1.0, baseline / max(warn_threshold, 1e-6)))
    critical_scale = min(2.0, max(1.0, baseline / max(critical_threshold, 1e-6)))
    adjusted_warn = min(0.99, warn_threshold * warn_scale)
    adjusted_critical = min(0.99, max(adjusted_warn + 1e-6, critical_threshold * critical_scale))
    return adjusted_warn, adjusted_critical


async def _should_send_quality_alert(
    session,
    *,
    report_id: int,
    status: str,
    min_alert_status: str,
    summary: dict[str, Any],
) -> bool:
    if _status_rank(status) < _status_rank(min_alert_status):
        return False

    cooldown_minutes = max(0, int(settings.quality_report_alert_cooldown_minutes))
    delta_threshold = max(0.0, float(settings.quality_report_alert_min_delta))
    if cooldown_minutes <= 0:
        return True

    row = (
        await session.execute(
            text(
                """
                select id, status, summary, created_at
                from catalog_data_quality_reports
                where id <> :report_id
                order by created_at desc
                limit 1
                """
            ),
            {"report_id": report_id},
        )
    ).mappings().one_or_none()
    if not row:
        return True

    created_at = _parse_iso_datetime(row.get("created_at")) or datetime.now(UTC)
    if datetime.now(UTC) > (created_at + timedelta(minutes=cooldown_minutes)):
        return True
    if _status_rank(str(row.get("status") or "")) < _status_rank(min_alert_status):
        return True

    prev_summary = row.get("summary") if isinstance(row.get("summary"), dict) else {}
    keys = (
        "active_without_valid_offers_ratio",
        "search_mismatch_ratio",
        "stale_offer_ratio",
        "low_quality_image_ratio",
    )
    for key in keys:
        current_value = float(summary.get(key) or 0.0)
        previous_value = float(prev_summary.get(key) or 0.0)
        if abs(current_value - previous_value) >= delta_threshold:
            return True
    return False


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

        active_warn, active_critical = await _adaptive_thresholds(
            session,
            metric_key="active_without_valid_offers_ratio",
            warn_threshold=float(settings.quality_report_active_without_offers_warn_ratio),
            critical_threshold=float(settings.quality_report_active_without_offers_critical_ratio),
        )
        mismatch_warn, mismatch_critical = await _adaptive_thresholds(
            session,
            metric_key="search_mismatch_ratio",
            warn_threshold=float(settings.quality_report_search_mismatch_warn_ratio),
            critical_threshold=float(settings.quality_report_search_mismatch_critical_ratio),
        )
        stale_warn, stale_critical = await _adaptive_thresholds(
            session,
            metric_key="stale_offer_ratio",
            warn_threshold=float(settings.quality_report_stale_offer_warn_ratio),
            critical_threshold=float(settings.quality_report_stale_offer_critical_ratio),
        )
        image_warn, image_critical = await _adaptive_thresholds(
            session,
            metric_key="low_quality_image_ratio",
            warn_threshold=float(settings.quality_report_low_quality_image_warn_ratio),
            critical_threshold=float(settings.quality_report_low_quality_image_critical_ratio),
        )

        active_without_offers_level = _quality_level(
            ratio=active_without_offers_ratio,
            warn_threshold=active_warn,
            critical_threshold=active_critical,
        )
        search_mismatch_level = _quality_level(
            ratio=search_mismatch_ratio,
            warn_threshold=mismatch_warn,
            critical_threshold=mismatch_critical,
        )
        stale_offer_level = _quality_level(
            ratio=stale_offer_ratio,
            warn_threshold=stale_warn,
            critical_threshold=stale_critical,
        )
        low_quality_image_level = _quality_level(
            ratio=low_quality_image_ratio,
            warn_threshold=image_warn,
            critical_threshold=image_critical,
        )

        checks = {
            "active_without_valid_offers": {
                "level": active_without_offers_level,
                "count": active_without_valid_offers,
                "total": active_products,
                "ratio": active_without_offers_ratio,
                "warn_threshold": active_warn,
                "critical_threshold": active_critical,
                "base_warn_threshold": settings.quality_report_active_without_offers_warn_ratio,
                "base_critical_threshold": settings.quality_report_active_without_offers_critical_ratio,
            },
            "search_store_count_mismatch": {
                "level": search_mismatch_level,
                "count": search_mismatch_products,
                "total": active_products,
                "ratio": search_mismatch_ratio,
                "warn_threshold": mismatch_warn,
                "critical_threshold": mismatch_critical,
                "base_warn_threshold": settings.quality_report_search_mismatch_warn_ratio,
                "base_critical_threshold": settings.quality_report_search_mismatch_critical_ratio,
            },
            "stale_valid_offers": {
                "level": stale_offer_level,
                "count": stale_valid_offers,
                "total": total_valid_offers,
                "ratio": stale_offer_ratio,
                "warn_threshold": stale_warn,
                "critical_threshold": stale_critical,
                "base_warn_threshold": settings.quality_report_stale_offer_warn_ratio,
                "base_critical_threshold": settings.quality_report_stale_offer_critical_ratio,
                "stale_offer_hours": settings.quality_report_stale_offer_hours,
            },
            "low_quality_main_image": {
                "level": low_quality_image_level,
                "count": low_quality_main_image_products,
                "total": active_products,
                "ratio": low_quality_image_ratio,
                "warn_threshold": image_warn,
                "critical_threshold": image_critical,
                "base_warn_threshold": settings.quality_report_low_quality_image_warn_ratio,
                "base_critical_threshold": settings.quality_report_low_quality_image_critical_ratio,
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
    async with AsyncSessionLocal() as session:
        should_send = await _should_send_quality_alert(
            session,
            report_id=report_id,
            status=status,
            min_alert_status=min_alert_status,
            summary=summary,
        )
    if should_send:
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


def _format_price(value: Decimal | float | int | None) -> str:
    if value is None:
        return "n/a"
    try:
        numeric = Decimal(str(value))
    except Exception:  # noqa: BLE001
        return str(value)
    return f"{numeric:.2f}"


def _telegram_chat_id(raw_value: str | None) -> str | None:
    normalized = str(raw_value or "").strip()
    if not normalized:
        return None
    if normalized.lower().startswith("chatid:"):
        chat_id = normalized.split(":", 1)[1].strip()
        return chat_id or None
    return normalized


def _should_send_price_alert(
    *,
    current_price: Decimal | None,
    target_price: Decimal | None,
    baseline_price: Decimal | None,
    last_notified_at: datetime | None,
    cooldown_minutes: int,
    now_dt: datetime,
) -> bool:
    if current_price is None:
        return False
    if target_price is not None:
        trigger_hit = current_price <= target_price
    elif baseline_price is not None:
        trigger_hit = current_price < baseline_price
    else:
        trigger_hit = False
    if not trigger_hit:
        return False
    if last_notified_at is None:
        return True
    cooldown = max(0, int(cooldown_minutes))
    if cooldown <= 0:
        return True
    return now_dt >= (last_notified_at + timedelta(minutes=cooldown))


def _build_price_alert_message(
    *,
    product_title: str,
    product_uuid: str,
    current_price: Decimal,
    target_price: Decimal | None,
    baseline_price: Decimal | None,
) -> str:
    public_base = str(settings.next_public_app_url or "").strip().rstrip("/")
    product_url = f"{public_base}/products/{product_uuid}" if public_base else ""
    lines = [
        "Price alert triggered",
        f"Product: {product_title}",
        f"Current price: {_format_price(current_price)}",
    ]
    if target_price is not None:
        lines.append(f"Target price: {_format_price(target_price)}")
    elif baseline_price is not None:
        lines.append(f"Baseline price: {_format_price(baseline_price)}")
    if product_url:
        lines.append(f"Open product: {product_url}")
    return "\n".join(lines)


async def _send_telegram_text(*, chat_id: str, text_value: str) -> tuple[bool, str | None]:
    token = str(settings.price_alerts_telegram_bot_token or "").strip()
    if not token:
        return False, "missing telegram bot token"
    api_base = str(settings.price_alerts_telegram_api_base or "https://api.telegram.org").strip().rstrip("/")
    endpoint = f"{api_base}/bot{token}/sendMessage"
    try:
        timeout = httpx.Timeout(timeout=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                endpoint,
                json={
                    "chat_id": chat_id,
                    "text": text_value,
                    "disable_web_page_preview": True,
                },
            )
        if response.status_code >= 400:
            return False, f"http {response.status_code}: {response.text[:300]}"
        payload = response.json()
        if payload.get("ok") is not True:
            return False, f"telegram error: {payload}"
        return True, None
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def _email_contact(raw_value: str | None) -> str | None:
    normalized = str(raw_value or "").strip()
    if not normalized or "@" not in normalized:
        return None
    return normalized


def _build_price_alert_email_subject(*, product_title: str) -> str:
    title = str(product_title or "Product").strip() or "Product"
    return f"Price alert: {title}"


async def _send_email_text(*, recipient: str, subject: str, text_value: str) -> tuple[bool, str | None]:
    if not settings.price_alerts_email_enabled:
        return False, "email delivery disabled"
    smtp_host = str(settings.price_alerts_smtp_host or "").strip()
    smtp_from = str(settings.price_alerts_email_from or "").strip()
    if not smtp_host:
        return False, "missing smtp host"
    if not smtp_from:
        return False, "missing smtp from"

    msg = EmailMessage()
    msg["From"] = smtp_from
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.set_content(text_value)

    smtp_port = int(settings.price_alerts_smtp_port)
    smtp_username = str(settings.price_alerts_smtp_username or "").strip()
    smtp_password = str(settings.price_alerts_smtp_password or "").strip()
    use_ssl = bool(settings.price_alerts_smtp_use_ssl)
    use_tls = bool(settings.price_alerts_smtp_use_tls)
    timeout_seconds = max(2.0, float(settings.price_alerts_email_timeout_seconds))

    def _send() -> None:
        smtp_class = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
        with smtp_class(smtp_host, smtp_port, timeout=timeout_seconds) as server:
            if (not use_ssl) and use_tls:
                server.starttls()
            if smtp_username:
                server.login(smtp_username, smtp_password)
            server.send_message(msg)

    try:
        await asyncio.to_thread(_send)
        return True, None
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


async def _send_price_alert_webhook(payload: dict[str, Any]) -> tuple[bool, str | None]:
    url = str(settings.price_alerts_webhook_url or "").strip()
    if not url:
        return False, "missing webhook url"
    timeout = max(2.0, float(settings.price_alerts_webhook_timeout_seconds))
    headers = {"content-type": "application/json"}
    secret = str(settings.price_alerts_webhook_secret or "").strip()
    if secret:
        headers["x-webhook-secret"] = secret
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout=timeout)) as client:
            response = await client.post(url, json=payload, headers=headers)
        if response.status_code >= 400:
            return False, f"http {response.status_code}: {response.text[:300]}"
        return True, None
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


async def _load_price_alert_candidates(session, *, limit: int) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            text(
                """
                with current_prices as (
                    select
                        o.canonical_product_id as product_id,
                        min(o.price_amount) as current_min_price
                    from catalog_offers o
                    where o.is_valid = true
                      and o.in_stock = true
                    group by o.canonical_product_id
                )
                select
                    a.id,
                    a.uuid,
                    a.user_uuid,
                    a.product_id,
                    a.channel,
                    a.baseline_price,
                    a.target_price,
                    a.last_seen_price,
                    a.last_notified_at,
                    cp.title as product_title,
                    cp.uuid as product_uuid,
                    cur.current_min_price,
                    au.telegram as telegram_contact,
                    au.email as email_contact,
                    au.email_confirmed as email_confirmed
                from catalog_price_alerts a
                join catalog_canonical_products cp on cp.id = a.product_id
                left join current_prices cur on cur.product_id = a.product_id
                left join auth_users au on cast(au.uuid as text) = cast(a.user_uuid as text)
                where a.alerts_enabled = true
                  and a.channel in ('telegram', 'email')
                order by coalesce(a.last_notified_at, to_timestamp(0)) asc, a.updated_at asc, a.id asc
                limit :limit
                """
            ),
            {"limit": max(1, int(limit))},
        )
    ).mappings().all()
    return [dict(row) for row in rows]


async def _deliver_price_alert_notifications(*, limit: int) -> dict[str, Any]:
    if not settings.price_alerts_delivery_enabled:
        return {"status": "disabled", "reason": "price_alerts_delivery_disabled", "at": datetime.now(UTC).isoformat()}

    now_dt = datetime.now(UTC)
    effective_limit = max(1, int(limit))
    sent = 0
    skipped_no_contact = 0
    skipped_not_triggered = 0
    skipped_cooldown = 0
    skipped_unsupported_channel = 0
    failed = 0
    seen_updates = 0
    webhook_sent = 0
    webhook_failed = 0

    async with AsyncSessionLocal() as session:
        candidates = await _load_price_alert_candidates(session, limit=effective_limit)
        for row in candidates:
            alert_id = int(row["id"])
            current_price = row.get("current_min_price")
            target_price = row.get("target_price")
            baseline_price = row.get("baseline_price")
            last_seen_price = row.get("last_seen_price")
            last_notified_at = row.get("last_notified_at")

            if current_price is not None and current_price != last_seen_price:
                await session.execute(
                    text(
                        """
                        update catalog_price_alerts
                        set last_seen_price = :last_seen_price,
                            updated_at = now()
                        where id = :id
                        """
                    ),
                    {
                        "id": alert_id,
                        "last_seen_price": current_price,
                    },
                )
                seen_updates += 1

            if current_price is None:
                skipped_not_triggered += 1
                continue

            trigger_hit = False
            if target_price is not None:
                trigger_hit = current_price <= target_price
            elif baseline_price is not None:
                trigger_hit = current_price < baseline_price
            if not trigger_hit:
                skipped_not_triggered += 1
                continue

            if not _should_send_price_alert(
                current_price=current_price,
                target_price=target_price,
                baseline_price=baseline_price,
                last_notified_at=last_notified_at,
                cooldown_minutes=settings.price_alerts_notify_cooldown_minutes,
                now_dt=now_dt,
            ):
                skipped_cooldown += 1
                continue

            channel = str(row.get("channel") or "").strip().lower()
            message = _build_price_alert_message(
                product_title=str(row.get("product_title") or "Product"),
                product_uuid=str(row.get("product_uuid") or ""),
                current_price=current_price,
                target_price=target_price,
                baseline_price=baseline_price,
            )
            delivered = False
            error: str | None = None
            contact_value: str | None = None
            if channel == "telegram":
                chat_id = _telegram_chat_id(row.get("telegram_contact"))
                contact_value = chat_id
                if chat_id is None:
                    skipped_no_contact += 1
                    continue
                delivered, error = await _send_telegram_text(chat_id=chat_id, text_value=message)
            elif channel == "email":
                email_confirmed = bool(row.get("email_confirmed"))
                recipient = _email_contact(row.get("email_contact"))
                contact_value = recipient
                if (not email_confirmed) or recipient is None:
                    skipped_no_contact += 1
                    continue
                delivered, error = await _send_email_text(
                    recipient=recipient,
                    subject=_build_price_alert_email_subject(product_title=str(row.get("product_title") or "Product")),
                    text_value=message,
                )
            else:
                skipped_unsupported_channel += 1
                continue

            if not delivered:
                failed += 1
                logger.warning(
                    "price_alert_delivery_failed",
                    alert_id=alert_id,
                    channel=channel,
                    contact=contact_value,
                    error=str(error or "unknown"),
                )
                continue

            webhook_url = str(settings.price_alerts_webhook_url or "").strip()
            if webhook_url:
                webhook_payload = {
                    "event": "price_alert.delivered",
                    "channel": channel,
                    "alert_id": str(row.get("uuid") or alert_id),
                    "user_uuid": str(row.get("user_uuid") or ""),
                    "product_uuid": str(row.get("product_uuid") or ""),
                    "product_title": str(row.get("product_title") or "Product"),
                    "current_price": _format_price(current_price),
                    "target_price": _format_price(target_price),
                    "baseline_price": _format_price(baseline_price),
                    "sent_at": datetime.now(UTC).isoformat(),
                }
                webhook_ok, webhook_error = await _send_price_alert_webhook(webhook_payload)
                if webhook_ok:
                    webhook_sent += 1
                else:
                    webhook_failed += 1
                    logger.warning(
                        "price_alert_webhook_delivery_failed",
                        alert_id=alert_id,
                        channel=channel,
                        error=str(webhook_error or "unknown"),
                    )

            await session.execute(
                text(
                    """
                    update catalog_price_alerts
                    set last_seen_price = :last_seen_price,
                        last_notified_at = now(),
                        updated_at = now()
                    where id = :id
                    """
                ),
                {
                    "id": alert_id,
                    "last_seen_price": current_price,
                },
            )
            sent += 1

        await session.commit()

    logger.info(
        "price_alert_delivery_completed",
        scanned=effective_limit,
        sent=sent,
        failed=failed,
        skipped_no_contact=skipped_no_contact,
        skipped_not_triggered=skipped_not_triggered,
        skipped_cooldown=skipped_cooldown,
        skipped_unsupported_channel=skipped_unsupported_channel,
        seen_updates=seen_updates,
        webhook_sent=webhook_sent,
        webhook_failed=webhook_failed,
    )
    return {
        "status": "ok",
        "limit": effective_limit,
        "sent": sent,
        "failed": failed,
        "skipped_no_contact": skipped_no_contact,
        "skipped_not_triggered": skipped_not_triggered,
        "skipped_cooldown": skipped_cooldown,
        "skipped_unsupported_channel": skipped_unsupported_channel,
        "seen_updates": seen_updates,
        "webhook_sent": webhook_sent,
        "webhook_failed": webhook_failed,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def deliver_price_alert_notifications(self, limit: int | None = None) -> dict[str, Any]:
    effective_limit = int(limit) if isinstance(limit, int) and limit > 0 else int(settings.price_alerts_scan_limit)
    return asyncio.run(_deliver_price_alert_notifications(limit=effective_limit))


@celery_app.task(bind=True)
def enqueue_price_alert_notifications(self) -> str:
    return deliver_price_alert_notifications.delay().id


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


async def _cleanup_auth_token_tables(
    *,
    reset_used_retention_days: int,
    email_confirmation_used_retention_days: int,
    revoked_token_retention_days: int,
    revoked_session_retention_days: int,
) -> dict[str, Any]:
    if not settings.auth_token_cleanup_enabled:
        return {"status": "disabled", "at": datetime.now(UTC).isoformat()}

    effective_reset_used_retention_days = max(1, int(reset_used_retention_days))
    effective_email_confirmation_used_retention_days = max(1, int(email_confirmation_used_retention_days))
    effective_revoked_token_retention_days = max(1, int(revoked_token_retention_days))
    effective_revoked_session_retention_days = max(1, int(revoked_session_retention_days))

    now_dt = datetime.now(UTC)
    reset_used_cutoff = now_dt - timedelta(days=effective_reset_used_retention_days)
    email_confirmation_used_cutoff = now_dt - timedelta(days=effective_email_confirmation_used_retention_days)
    revoked_token_cutoff = now_dt - timedelta(days=effective_revoked_token_retention_days)
    revoked_session_cutoff = now_dt - timedelta(days=effective_revoked_session_retention_days)

    async with AsyncSessionLocal() as session:
        reset_expired = await session.execute(
            text(
                """
                delete from auth_password_reset_tokens
                where expires_at < now()
                """
            )
        )
        reset_used = await session.execute(
            text(
                """
                delete from auth_password_reset_tokens
                where used_at is not null
                  and used_at < :cutoff
                """
            ),
            {"cutoff": reset_used_cutoff},
        )
        email_confirm_expired = await session.execute(
            text(
                """
                delete from auth_email_confirmation_tokens
                where expires_at < now()
                """
            )
        )
        email_confirm_used = await session.execute(
            text(
                """
                delete from auth_email_confirmation_tokens
                where used_at is not null
                  and used_at < :cutoff
                """
            ),
            {"cutoff": email_confirmation_used_cutoff},
        )
        session_tokens_expired = await session.execute(
            text(
                """
                delete from auth_session_tokens
                where expires_at < now()
                """
            )
        )
        session_tokens_revoked = await session.execute(
            text(
                """
                delete from auth_session_tokens
                where revoked_at is not null
                  and revoked_at < :cutoff
                """
            ),
            {"cutoff": revoked_token_cutoff},
        )
        sessions_revoked = await session.execute(
            text(
                """
                delete from auth_sessions
                where revoked_at is not null
                  and revoked_at < :cutoff
                """
            ),
            {"cutoff": revoked_session_cutoff},
        )
        await session.commit()

    deleted_reset_expired = int(reset_expired.rowcount or 0)
    deleted_reset_used = int(reset_used.rowcount or 0)
    deleted_email_confirm_expired = int(email_confirm_expired.rowcount or 0)
    deleted_email_confirm_used = int(email_confirm_used.rowcount or 0)
    deleted_session_tokens_expired = int(session_tokens_expired.rowcount or 0)
    deleted_session_tokens_revoked = int(session_tokens_revoked.rowcount or 0)
    deleted_sessions_revoked = int(sessions_revoked.rowcount or 0)

    logger.info(
        "cleanup_auth_token_tables_completed",
        reset_used_retention_days=effective_reset_used_retention_days,
        email_confirmation_used_retention_days=effective_email_confirmation_used_retention_days,
        revoked_token_retention_days=effective_revoked_token_retention_days,
        revoked_session_retention_days=effective_revoked_session_retention_days,
        deleted_reset_expired=deleted_reset_expired,
        deleted_reset_used=deleted_reset_used,
        deleted_email_confirm_expired=deleted_email_confirm_expired,
        deleted_email_confirm_used=deleted_email_confirm_used,
        deleted_session_tokens_expired=deleted_session_tokens_expired,
        deleted_session_tokens_revoked=deleted_session_tokens_revoked,
        deleted_sessions_revoked=deleted_sessions_revoked,
    )

    return {
        "status": "ok",
        "reset_used_retention_days": effective_reset_used_retention_days,
        "email_confirmation_used_retention_days": effective_email_confirmation_used_retention_days,
        "revoked_token_retention_days": effective_revoked_token_retention_days,
        "revoked_session_retention_days": effective_revoked_session_retention_days,
        "deleted_reset_expired": deleted_reset_expired,
        "deleted_reset_used": deleted_reset_used,
        "deleted_email_confirm_expired": deleted_email_confirm_expired,
        "deleted_email_confirm_used": deleted_email_confirm_used,
        "deleted_session_tokens_expired": deleted_session_tokens_expired,
        "deleted_session_tokens_revoked": deleted_session_tokens_revoked,
        "deleted_sessions_revoked": deleted_sessions_revoked,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def cleanup_auth_token_tables(
    self,
    reset_used_retention_days: int | None = None,
    email_confirmation_used_retention_days: int | None = None,
    revoked_token_retention_days: int | None = None,
    revoked_session_retention_days: int | None = None,
) -> dict[str, Any]:
    effective_reset_used_retention_days = (
        int(reset_used_retention_days)
        if isinstance(reset_used_retention_days, int) and reset_used_retention_days > 0
        else int(settings.auth_password_reset_used_retention_days)
    )
    effective_email_confirmation_used_retention_days = (
        int(email_confirmation_used_retention_days)
        if isinstance(email_confirmation_used_retention_days, int) and email_confirmation_used_retention_days > 0
        else int(settings.auth_email_confirmation_used_retention_days)
    )
    effective_revoked_token_retention_days = (
        int(revoked_token_retention_days)
        if isinstance(revoked_token_retention_days, int) and revoked_token_retention_days > 0
        else int(settings.auth_session_token_revoked_retention_days)
    )
    effective_revoked_session_retention_days = (
        int(revoked_session_retention_days)
        if isinstance(revoked_session_retention_days, int) and revoked_session_retention_days > 0
        else int(settings.auth_session_revoked_retention_days)
    )
    return asyncio.run(
        _cleanup_auth_token_tables(
            reset_used_retention_days=effective_reset_used_retention_days,
            email_confirmation_used_retention_days=effective_email_confirmation_used_retention_days,
            revoked_token_retention_days=effective_revoked_token_retention_days,
            revoked_session_retention_days=effective_revoked_session_retention_days,
        )
    )


@celery_app.task(bind=True)
def enqueue_cleanup_auth_token_tables(self) -> str:
    return cleanup_auth_token_tables.delay().id


async def _cleanup_auth_ephemeral_keys_redis(*, scan_limit: int) -> dict[str, Any]:
    if not settings.auth_ephemeral_cleanup_enabled:
        return {"status": "disabled", "at": datetime.now(UTC).isoformat()}

    effective_scan_limit = max(100, int(scan_limit))
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    scanned_total = 0
    fixed_total = 0
    skipped_with_ttl = 0
    missing_total = 0

    groups = [
        ("auth:2fa:challenge:*", max(60, int(settings.auth_2fa_challenge_ttl_seconds))),
        ("auth:email-confirmation:*", max(300, int(settings.auth_email_confirmation_ttl_seconds))),
        ("auth:oauth:state:*", max(300, int(settings.auth_oauth_state_ttl_seconds))),
    ]
    group_stats: dict[str, dict[str, int]] = {
        pattern: {"scanned": 0, "fixed": 0, "skipped_with_ttl": 0, "missing": 0} for pattern, _ in groups
    }

    for pattern, ttl_seconds in groups:
        async for key in redis.scan_iter(match=pattern):
            if scanned_total >= effective_scan_limit:
                break
            scanned_total += 1
            group_stats[pattern]["scanned"] += 1

            ttl = await redis.ttl(key)
            if ttl == -2:
                missing_total += 1
                group_stats[pattern]["missing"] += 1
                continue
            if ttl == -1:
                await redis.expire(key, ttl_seconds)
                fixed_total += 1
                group_stats[pattern]["fixed"] += 1
                continue
            skipped_with_ttl += 1
            group_stats[pattern]["skipped_with_ttl"] += 1

    if hasattr(redis, "aclose"):
        await redis.aclose()
    else:
        await redis.close()

    logger.info(
        "cleanup_auth_ephemeral_keys_completed",
        scan_limit=effective_scan_limit,
        scanned_total=scanned_total,
        fixed_total=fixed_total,
        skipped_with_ttl=skipped_with_ttl,
        missing_total=missing_total,
    )
    return {
        "status": "ok",
        "scan_limit": effective_scan_limit,
        "scanned_total": scanned_total,
        "fixed_total": fixed_total,
        "skipped_with_ttl": skipped_with_ttl,
        "missing_total": missing_total,
        "groups": group_stats,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def cleanup_auth_ephemeral_keys(self, scan_limit: int | None = None) -> dict[str, Any]:
    effective_scan_limit = (
        int(scan_limit)
        if isinstance(scan_limit, int) and scan_limit > 0
        else int(settings.auth_ephemeral_cleanup_scan_limit)
    )
    return asyncio.run(
        _cleanup_auth_ephemeral_keys_redis(
            scan_limit=effective_scan_limit,
        )
    )


@celery_app.task(bind=True)
def enqueue_cleanup_auth_ephemeral_keys(self) -> str:
    return cleanup_auth_ephemeral_keys.delay().id


async def _cleanup_auth_legacy_redis_keys(*, grace_days: int, scan_limit: int) -> dict[str, Any]:
    if not settings.auth_legacy_redis_cleanup_enabled:
        return {"status": "disabled", "reason": "auth_legacy_redis_cleanup_disabled", "at": datetime.now(UTC).isoformat()}
    if str(settings.auth_storage_mode) != "postgres":
        return {"status": "disabled", "reason": "auth_storage_mode_not_postgres", "at": datetime.now(UTC).isoformat()}

    effective_grace_days = max(1, int(grace_days))
    effective_scan_limit = max(100, int(scan_limit))
    cutoff = datetime.now(UTC) - timedelta(days=effective_grace_days)

    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    scanned = 0
    deleted_users = 0
    deleted_email_indexes = 0
    deleted_session_sets = 0
    skipped_recent = 0
    skipped_invalid = 0

    async for user_key in redis.scan_iter(match="auth:user:*"):
        if scanned >= effective_scan_limit:
            break
        if user_key.count(":") != 2:
            continue
        scanned += 1

        payload = await redis.hgetall(user_key)
        if not payload:
            await redis.delete(user_key)
            continue

        user_id = str(payload.get("id") or "").strip()
        email = str(payload.get("email") or "").strip().lower()
        last_seen = _parse_iso_datetime(payload.get("last_seen_at"))
        updated_at = _parse_iso_datetime(payload.get("updated_at") or payload.get("created_at"))
        reference_dt = last_seen or updated_at
        if reference_dt is None:
            skipped_invalid += 1
            continue
        if reference_dt >= cutoff:
            skipped_recent += 1
            continue

        session_set_key = f"auth:user:{user_id}:sessions" if user_id else ""
        active_session_refs = 0
        if session_set_key:
            for session_id in await redis.smembers(session_set_key):
                if await redis.exists(f"auth:session:{session_id}"):
                    active_session_refs += 1
            if active_session_refs == 0:
                if await redis.delete(session_set_key):
                    deleted_session_sets += 1

        if active_session_refs > 0:
            skipped_recent += 1
            continue

        pipe = redis.pipeline()
        pipe.delete(user_key)
        if email:
            pipe.delete(f"auth:user:email:{email}")
        await pipe.execute()
        deleted_users += 1
        if email:
            deleted_email_indexes += 1

    if hasattr(redis, "aclose"):
        await redis.aclose()
    else:
        await redis.close()

    logger.info(
        "cleanup_auth_legacy_redis_keys_completed",
        grace_days=effective_grace_days,
        scan_limit=effective_scan_limit,
        scanned=scanned,
        deleted_users=deleted_users,
        deleted_email_indexes=deleted_email_indexes,
        deleted_session_sets=deleted_session_sets,
        skipped_recent=skipped_recent,
        skipped_invalid=skipped_invalid,
    )
    return {
        "status": "ok",
        "grace_days": effective_grace_days,
        "scan_limit": effective_scan_limit,
        "cutoff_at": cutoff.isoformat(),
        "scanned": scanned,
        "deleted_users": deleted_users,
        "deleted_email_indexes": deleted_email_indexes,
        "deleted_session_sets": deleted_session_sets,
        "skipped_recent": skipped_recent,
        "skipped_invalid": skipped_invalid,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def cleanup_auth_legacy_redis_keys(
    self,
    grace_days: int | None = None,
    scan_limit: int | None = None,
) -> dict[str, Any]:
    effective_grace_days = (
        int(grace_days)
        if isinstance(grace_days, int) and grace_days > 0
        else int(settings.auth_legacy_redis_cleanup_grace_days)
    )
    effective_scan_limit = (
        int(scan_limit)
        if isinstance(scan_limit, int) and scan_limit > 0
        else int(settings.auth_legacy_redis_cleanup_scan_limit)
    )
    return asyncio.run(
        _cleanup_auth_legacy_redis_keys(
            grace_days=effective_grace_days,
            scan_limit=effective_scan_limit,
        )
    )


@celery_app.task(bind=True)
def enqueue_cleanup_auth_legacy_redis_keys(self) -> str:
    return cleanup_auth_legacy_redis_keys.delay().id


@celery_app.task(bind=True)
def refresh_canonical_key_index(
    self,
    limit: int | None = None,
    reset_offset: bool = False,
    followup: bool = True,
) -> dict[str, Any]:
    result = asyncio.run(_refresh_canonical_key_index(limit=limit, reset_offset=reset_offset))
    if followup and bool(result.get("has_more")):
        self.apply_async(kwargs={"limit": int(result.get("limit") or 100000), "reset_offset": False, "followup": True})
    return result


async def _refresh_canonical_key_index(*, limit: int | None = None, reset_offset: bool = False) -> dict[str, Any]:
    effective_limit = int(limit) if isinstance(limit, int) and limit > 0 else 100000
    async with AsyncSessionLocal() as session:
        result = await sync_canonical_key_index_batch(
            session,
            limit=effective_limit,
            reset_offset=bool(reset_offset),
        )
        await session.commit()
    return {
        "status": "ok",
        "indexed": int(result.get("indexed", 0)),
        "skipped": int(result.get("skipped", 0)),
        "processed": int(result.get("processed", 0)),
        "limit": effective_limit,
        "has_more": bool(result.get("has_more", False)),
        "mode": "incremental",
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def enqueue_refresh_canonical_key_index(self) -> str:
    return refresh_canonical_key_index.delay().id


@celery_app.task(bind=True)
def refresh_embedding_ann_indexes(self, force_reindex: bool = False) -> dict[str, Any]:
    return asyncio.run(_refresh_embedding_ann_indexes(force_reindex=force_reindex))


async def _refresh_embedding_ann_indexes(*, force_reindex: bool = False) -> dict[str, Any]:
    ann_indexes = [
        ("catalog_canonical_products", "ix_catalog_canonical_products_embedding_vector"),
        ("catalog_product_embeddings", "ix_catalog_product_embeddings_vector"),
    ]
    indexed = 0
    analyzed_tables: set[str] = set()
    index_profiles: list[dict[str, Any]] = []

    async with AsyncSessionLocal() as session:
        for table_name, index_name in ann_indexes:
            index_row = (
                await session.execute(
                    text(
                        """
                        select indexdef
                        from pg_indexes
                        where schemaname = current_schema()
                          and tablename = :table_name
                          and indexname = :index_name
                        """
                    ),
                    {"table_name": table_name, "index_name": index_name},
                )
            ).mappings().first()
            if index_row is None:
                continue
            indexed += 1
            await session.execute(text(f"analyze {table_name}"))
            analyzed_tables.add(table_name)
            index_profiles.append(
                {
                    "table": table_name,
                    "index": index_name,
                    "definition": str(index_row.get("indexdef") or ""),
                }
            )
        await session.commit()

    reindex_enabled = bool(settings.embedding_ann_maintenance_reindex_enabled) or bool(force_reindex)
    reindexed = 0
    if reindex_enabled and indexed > 0:
        async with engine.connect() as connection:
            autocommit_conn = await connection.execution_options(isolation_level="AUTOCOMMIT")
            for _, index_name in ann_indexes:
                exists = any(profile["index"] == index_name for profile in index_profiles)
                if not exists:
                    continue
                await autocommit_conn.execute(text(f"reindex index concurrently {index_name}"))
                reindexed += 1

    logger.info(
        "embedding_ann_indexes_refreshed",
        indexed=indexed,
        analyzed_tables=sorted(analyzed_tables),
        reindex_enabled=reindex_enabled,
        reindexed=reindexed,
    )
    return {
        "status": "ok",
        "indexed": indexed,
        "analyzed_tables": sorted(analyzed_tables),
        "reindex_enabled": reindex_enabled,
        "reindexed": reindexed,
        "index_profiles": index_profiles,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def enqueue_refresh_embedding_ann_indexes(self) -> str:
    return refresh_embedding_ann_indexes.delay().id


@celery_app.task(bind=True)
def compact_canonical_match_snapshots(
    self,
    snapshot_date: str | None = None,
    limit: int = 100000,
) -> dict[str, Any]:
    return asyncio.run(_compact_canonical_match_snapshots(snapshot_date=snapshot_date, limit=limit))


async def _compact_canonical_match_snapshots(*, snapshot_date: str | None = None, limit: int = 100000) -> dict[str, Any]:
    effective_limit = max(1000, int(limit))
    snapshot_date_sql = str(snapshot_date).strip() if snapshot_date else None
    async with AsyncSessionLocal() as session:
        if snapshot_date_sql:
            date_row = (
                await session.execute(
                    text("select cast(:snapshot_date as date) as d"),
                    {"snapshot_date": snapshot_date_sql},
                )
            ).first()
            target_date = date_row.d
        else:
            target_date = datetime.now(UTC).date()

        compacted = await session.execute(
            text(
                """
                with grouped as (
                    select
                        canonical_product_id,
                        canonical_key,
                        count(*)::int as offers_total,
                        max(created_at) as last_match_at,
                        jsonb_object_agg(match_type, type_count) as by_match_type
                    from (
                        select
                            canonical_product_id,
                            canonical_key,
                            match_type,
                            count(*)::int as type_count,
                            max(created_at) as created_at
                        from catalog_canonical_match_ledger
                        where created_at::date = :target_date
                        group by canonical_product_id, canonical_key, match_type
                    ) typed
                    group by canonical_product_id, canonical_key
                    order by canonical_product_id asc
                    limit :limit
                )
                insert into catalog_canonical_match_snapshots
                  (snapshot_date, canonical_product_id, canonical_key, offers_total, last_match_at, payload, created_at, updated_at)
                select
                  :target_date,
                  g.canonical_product_id,
                  g.canonical_key,
                  g.offers_total,
                  g.last_match_at,
                  jsonb_build_object(
                    'source', 'ledger_compaction',
                    'match_type_breakdown', coalesce(g.by_match_type, '{}'::jsonb)
                  ) as payload,
                  now(),
                  now()
                from grouped g
                on conflict (snapshot_date, canonical_product_id, canonical_key) do update
                  set offers_total = excluded.offers_total,
                      last_match_at = excluded.last_match_at,
                      payload = excluded.payload,
                      updated_at = now()
                """
            ),
            {"target_date": target_date, "limit": effective_limit},
        )
        await session.commit()

    rows_affected = int(compacted.rowcount or 0)
    logger.info(
        "canonical_match_snapshot_compaction_completed",
        snapshot_date=str(target_date),
        rows_affected=rows_affected,
        limit=effective_limit,
    )
    return {
        "status": "ok",
        "snapshot_date": str(target_date),
        "rows_affected": rows_affected,
        "limit": effective_limit,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def enqueue_compact_canonical_match_snapshots(self) -> str:
    return compact_canonical_match_snapshots.delay().id


async def _refresh_offer_trust_scores(*, limit: int, freshness_hours: int, stock_window_days: int) -> dict[str, Any]:
    if not settings.offer_trust_score_enabled:
        return {"status": "disabled", "at": datetime.now(UTC).isoformat()}

    effective_limit = max(1000, int(limit))
    effective_freshness_hours = max(1, int(freshness_hours))
    effective_stock_window_days = max(1, int(stock_window_days))

    async with AsyncSessionLocal() as session:
        updated = await session.execute(
            text(
                """
                with base as (
                    select
                        o.id,
                        o.price_amount::double precision as price_amount,
                        o.in_stock,
                        o.scraped_at,
                        cp_median.median_price,
                        s.trust_score::double precision as store_trust,
                        se.rating::double precision as seller_rating,
                        ph.stock_consistency
                    from catalog_offers o
                    left join catalog_stores s on s.id = o.store_id
                    left join catalog_sellers se on se.id = o.seller_id
                    left join (
                        select
                            canonical_product_id,
                            percentile_cont(0.5) within group (order by price_amount::double precision) as median_price
                        from catalog_offers
                        where is_valid = true and in_stock = true
                        group by canonical_product_id
                    ) cp_median on cp_median.canonical_product_id = o.canonical_product_id
                    left join (
                        select
                            ph.offer_id,
                            avg(case when ph.in_stock then 1.0 else 0.0 end)::double precision as stock_consistency
                        from catalog_price_history ph
                        where ph.captured_at >= now() - make_interval(days => cast(:stock_window_days as integer))
                        group by ph.offer_id
                    ) ph on ph.offer_id = o.id
                    where o.is_valid = true
                    order by o.scraped_at desc, o.id desc
                    limit :limit
                ),
                scored as (
                    select
                        id,
                        greatest(0.0, least(1.0, 1.0 - (extract(epoch from (now() - scraped_at)) / 3600.0) / :freshness_hours)) as trust_freshness,
                        greatest(0.0, least(1.0, coalesce(seller_rating / 5.0, store_trust, 0.55))) as trust_seller_rating,
                        greatest(
                            0.0,
                            least(
                                1.0,
                                case
                                    when median_price is null or median_price <= 0 then 0.65
                                    else 1.0 - least(abs(price_amount - median_price) / median_price, 1.0)
                                end
                            )
                        ) as trust_price_anomaly,
                        greatest(0.0, least(1.0, coalesce(stock_consistency, case when in_stock then 0.9 else 0.35 end))) as trust_stock_consistency
                    from base
                ),
                merged as (
                    select
                        id,
                        trust_freshness,
                        trust_seller_rating,
                        trust_price_anomaly,
                        trust_stock_consistency,
                        greatest(
                            0.0,
                            least(
                                1.0,
                                0.35 * trust_freshness
                                + 0.25 * trust_seller_rating
                                + 0.25 * trust_price_anomaly
                                + 0.15 * trust_stock_consistency
                            )
                        ) as trust_score
                    from scored
                )
                update catalog_offers o
                set
                    trust_freshness = round(m.trust_freshness::numeric, 4),
                    trust_seller_rating = round(m.trust_seller_rating::numeric, 4),
                    trust_price_anomaly = round(m.trust_price_anomaly::numeric, 4),
                    trust_stock_consistency = round(m.trust_stock_consistency::numeric, 4),
                    trust_score = round(m.trust_score::numeric, 4)
                from merged m
                where o.id = m.id
                """
            ),
            {
                "limit": effective_limit,
                "freshness_hours": float(effective_freshness_hours),
                "stock_window_days": effective_stock_window_days,
            },
        )
        await session.commit()

    updated_rows = int(updated.rowcount or 0)
    logger.info(
        "offer_trust_scores_refreshed",
        updated_rows=updated_rows,
        limit=effective_limit,
        freshness_hours=effective_freshness_hours,
        stock_window_days=effective_stock_window_days,
    )
    return {
        "status": "ok",
        "updated_rows": updated_rows,
        "limit": effective_limit,
        "freshness_hours": effective_freshness_hours,
        "stock_window_days": effective_stock_window_days,
        "at": datetime.now(UTC).isoformat(),
    }


@celery_app.task(bind=True)
def refresh_offer_trust_scores(
    self,
    limit: int | None = None,
    freshness_hours: int | None = None,
    stock_window_days: int | None = None,
) -> dict[str, Any]:
    effective_limit = (
        int(limit)
        if isinstance(limit, int) and limit > 0
        else int(settings.offer_trust_score_refresh_limit)
    )
    effective_freshness_hours = (
        int(freshness_hours)
        if isinstance(freshness_hours, int) and freshness_hours > 0
        else int(settings.offer_trust_score_freshness_hours)
    )
    effective_stock_window_days = (
        int(stock_window_days)
        if isinstance(stock_window_days, int) and stock_window_days > 0
        else int(settings.offer_trust_score_stock_window_days)
    )
    return asyncio.run(
        _refresh_offer_trust_scores(
            limit=effective_limit,
            freshness_hours=effective_freshness_hours,
            stock_window_days=effective_stock_window_days,
        )
    )


@celery_app.task(bind=True)
def enqueue_refresh_offer_trust_scores(self) -> str:
    return refresh_offer_trust_scores.delay().id


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
                where job_name in ('normalize_store_products', 'reindex_product_search', 'canonical_key_index')
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
        celery_app.signature("app.tasks.normalize_tasks.normalize_full_catalog", kwargs={"chunk_size": 1000}),
        celery_app.signature("app.tasks.dedupe_tasks.find_duplicate_candidates_task"),
        celery_app.signature("app.tasks.maintenance_tasks.cleanup_empty_canonicals"),
        celery_app.signature("app.tasks.reindex_tasks.reindex_product_search_batch"),
    )
    result = workflow.apply_async()
    logger.info("full_catalog_rebuild_enqueued", workflow_id=result.id, touched_rows=prepared["touched_rows"])
    return {"workflow_id": result.id, "touched_rows": prepared["touched_rows"], "at": datetime.now(UTC).isoformat()}

