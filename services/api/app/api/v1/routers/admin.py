from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import secrets
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from urllib.parse import urljoin
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.rbac import ADMIN_ROLE
from app.api.rbac import require_roles
from app.api.v1.routers.auth import _ensure_user_uuid
from app.core.config import settings
from app.repositories.catalog import CatalogRepository
from app.services.worker_client import enqueue_dedupe_batches
from app.services.worker_client import enqueue_embedding_batches
from app.services.worker_client import enqueue_catalog_quality_report
from app.services.worker_client import enqueue_admin_alert_evaluation
from app.services.worker_client import enqueue_full_crawl
from app.services.worker_client import enqueue_full_catalog_rebuild
from app.services.worker_client import enqueue_ingested_products_pipeline
from app.services.worker_client import enqueue_reindex_batches
from app.services.worker_client import enqueue_test_quality_alert
from app.services.worker_client import get_task_status
from shared.db.models import AuthUser

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_roles(ADMIN_ROLE, detail="admin access required"))],
)


VALID_USER_ROLES = {"user", "moderator", "seller_support", "admin"}
UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
ANALYTICS_PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}
ANALYTICS_GRANULARITIES = {"day", "week"}
ALERT_EVENT_STATUSES = {"open", "ack", "resolved"}
ALERT_EVENT_SOURCES = {"revenue", "catalog_quality", "operations", "moderation", "users"}
ALERT_EVENT_SEVERITIES = {"info", "warning", "critical"}


def _auth_reads_from_postgres() -> bool:
    return settings.auth_storage_mode == "postgres"


def _to_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return default


def _parse_iso_datetime(value: Any) -> datetime | None:
    if value is None:
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


def _period_to_days(period: str) -> int:
    key = str(period or "30d").strip().lower()
    days = ANALYTICS_PERIOD_DAYS.get(key)
    if days is None:
        raise HTTPException(status_code=422, detail="period must be one of: 7d, 30d, 90d, 365d")
    return days


def _normalize_granularity(granularity: str | None) -> str:
    key = str(granularity or "day").strip().lower()
    if key not in ANALYTICS_GRANULARITIES:
        raise HTTPException(status_code=422, detail="granularity must be one of: day, week")
    return key


def _bucket_start(value: datetime, granularity: str) -> datetime:
    normalized = value.astimezone(UTC)
    if granularity == "week":
        weekday = normalized.weekday()
        start = normalized - timedelta(days=weekday)
        return datetime(start.year, start.month, start.day, tzinfo=UTC)
    return datetime(normalized.year, normalized.month, normalized.day, tzinfo=UTC)


def _init_series(range_start: datetime, range_end: datetime, granularity: str) -> list[datetime]:
    points: list[datetime] = []
    cursor = _bucket_start(range_start, granularity)
    step = timedelta(days=7 if granularity == "week" else 1)
    while cursor <= range_end:
        points.append(cursor)
        cursor += step
    return points


def _series_ts(value: datetime) -> str:
    return value.astimezone(UTC).date().isoformat()


def _severity_by_threshold(value: float, *, warn: float, critical: float) -> str | None:
    if value >= critical:
        return "critical"
    if value >= warn:
        return "warning"
    return None


def _serialize_alert_event_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "code": row.get("code"),
        "title": row.get("title"),
        "source": row.get("source"),
        "severity": row.get("severity"),
        "status": row.get("status"),
        "metric_value": _to_float(row.get("metric_value")),
        "threshold_value": _to_float(row.get("threshold_value")),
        "context": row.get("context") if isinstance(row.get("context"), dict) else {},
        "created_at": _serialize_datetime_value(row.get("created_at")),
        "acknowledged_at": _serialize_datetime_value(row.get("acknowledged_at")),
        "resolved_at": _serialize_datetime_value(row.get("resolved_at")),
    }


def _admin_analytics_cache_key(endpoint: str, payload: dict[str, Any]) -> str:
    fingerprint = _hash(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str))
    return f"admin:analytics:v1:{endpoint}:{fingerprint}"


async def _get_cached_admin_analytics(redis: Redis, key: str) -> dict[str, Any] | None:
    raw = await redis.get(key)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


async def _set_cached_admin_analytics(redis: Redis, key: str, payload: dict[str, Any], ttl_seconds: int = 60) -> None:
    await redis.set(key, json.dumps(payload, ensure_ascii=False, default=str), ex=max(10, int(ttl_seconds)))


async def _invalidate_admin_analytics_cache(redis: Redis) -> None:
    keys = [key async for key in redis.scan_iter(match="admin:analytics:v1:*")]
    if keys:
        await redis.delete(*keys)


class PaginatedOut(BaseModel):
    items: list[dict[str, Any]]
    next_cursor: str | None = None
    request_id: str = "admin"


class OrderStatusPatch(BaseModel):
    status: str


class SettingsPatch(BaseModel):
    site_name: str | None = None
    support_email: str | None = None
    branding_logo_url: str | None = None
    feature_ai_enabled: bool | None = None


class CategoryCreate(BaseModel):
    name: str
    slug: str
    parent_id: str | None = Field(default=None, pattern=UUID_REF_PATTERN)


class CategoryPatch(BaseModel):
    name: str | None = None
    slug: str | None = None
    parent_id: str | None = Field(default=None, pattern=UUID_REF_PATTERN)


class StoreCreate(BaseModel):
    name: str
    slug: str | None = None
    provider: str = "generic"
    base_url: str | None = None
    country_code: str = "UZ"
    trust_score: float = 0.8
    crawl_priority: int = 100
    is_active: bool = True


class StorePatch(BaseModel):
    name: str | None = None
    slug: str | None = None
    provider: str | None = None
    base_url: str | None = None
    country_code: str | None = None
    trust_score: float | None = None
    crawl_priority: int | None = None
    is_active: bool | None = None


class ScrapeSourceCreate(BaseModel):
    url: str
    source_type: str = "category"
    priority: int = 100
    is_active: bool = True


class ScrapeSourcePatch(BaseModel):
    url: str | None = None
    source_type: str | None = None
    priority: int | None = None
    is_active: bool | None = None


class ProductsBulkDeleteIn(BaseModel):
    product_ids: list[str]


class ProductsImportIn(BaseModel):
    source: Literal["csv", "json"]
    content: str
    store_id: str | None = Field(default=None, pattern=UUID_REF_PATTERN)


class QualityProductsBulkDeactivateIn(BaseModel):
    product_ids: list[str]


class CanonicalReviewCasePatch(BaseModel):
    status: str = Field(pattern="^(open|applied|rejected)$")
    note: str | None = Field(default=None, max_length=400)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "store"


def _normalize_uuid_ref(value: str, *, field_name: str) -> str:
    normalized = str(value or "").strip().lower()
    if not re.match(UUID_REF_PATTERN, normalized):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a UUID")
    return normalized


def _serialize_quality_report_row(row: dict[str, Any]) -> dict[str, Any]:
    summary = row.get("summary") if isinstance(row.get("summary"), dict) else {}
    checks = row.get("checks") if isinstance(row.get("checks"), dict) else {}
    created_at_value = _serialize_datetime_value(row.get("created_at"))
    return {
        "id": row.get("id"),
        "status": row.get("status"),
        "summary": summary,
        "checks": checks,
        "created_at": created_at_value,
    }


def _serialize_datetime_value(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    if value is None:
        return None
    return str(value)


def _serialize_quality_no_offer_row(row: dict[str, Any]) -> dict[str, Any]:
    brand_id = row.get("brand_id")
    category_id = row.get("category_id")
    return {
        "id": row.get("id"),
        "normalized_title": row.get("normalized_title"),
        "main_image": row.get("main_image"),
        "is_active": bool(row.get("is_active")),
        "valid_store_count": int(row.get("valid_store_count") or 0),
        "store_count": int(row.get("store_count") or 0),
        "total_offers": int(row.get("total_offers") or 0),
        "last_offer_seen_at": _serialize_datetime_value(row.get("last_offer_seen_at")),
        "last_valid_offer_seen_at": _serialize_datetime_value(row.get("last_valid_offer_seen_at")),
        "updated_at": _serialize_datetime_value(row.get("updated_at")),
        "brand": {"id": str(brand_id), "name": row.get("brand_name")} if brand_id and row.get("brand_name") else None,
        "category": {"id": str(category_id), "name": row.get("category_name")}
        if category_id and row.get("category_name")
        else None,
    }


def _serialize_canonical_review_case_row(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    return {
        "id": row.get("id"),
        "store_product_id": _to_int(row.get("store_product_id")),
        "canonical_product_id": _to_int(row.get("canonical_product_id")),
        "candidate_canonical_id": _to_int(row.get("candidate_canonical_id")) if row.get("candidate_canonical_id") is not None else None,
        "canonical_key": str(row.get("canonical_key") or ""),
        "signal_type": str(row.get("signal_type") or ""),
        "confidence_score": _to_float(row.get("confidence_score"), default=0.0) if row.get("confidence_score") is not None else None,
        "status": str(row.get("status") or "open"),
        "reviewed_by": row.get("reviewed_by"),
        "reviewed_at": _serialize_datetime_value(row.get("reviewed_at")),
        "created_at": _serialize_datetime_value(row.get("created_at")),
        "updated_at": _serialize_datetime_value(row.get("updated_at")),
        "canonical_title": row.get("canonical_title"),
        "candidate_title": row.get("candidate_title"),
        "payload": payload,
    }


def _request_ip(request: Request) -> str:
    x_forwarded_for = str(request.headers.get("x-forwarded-for") or "").strip()
    if x_forwarded_for:
        ip = x_forwarded_for.split(",", maxsplit=1)[0].strip()
        if ip:
            return ip
    x_real_ip = str(request.headers.get("x-real-ip") or "").strip()
    if x_real_ip:
        return x_real_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def _audit_admin_action(
    db: AsyncSession,
    *,
    current_user: dict,
    request: Request,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    actor_uuid = str(current_user.get("id") or "").strip().lower() or None
    actor_role = str(current_user.get("role") or "admin").strip().lower() or "admin"
    req_id = getattr(getattr(request, "state", None), "request_id", None)
    await db.execute(
        text(
            """
            insert into admin_audit_events (
                actor_user_uuid,
                actor_role,
                action,
                entity_type,
                entity_id,
                request_id,
                method,
                path,
                ip_address,
                user_agent,
                payload
            )
            values (
                cast(:actor_user_uuid as uuid),
                :actor_role,
                :action,
                :entity_type,
                :entity_id,
                :request_id,
                :method,
                :path,
                :ip_address,
                :user_agent,
                cast(:payload as jsonb)
            )
            """
        ),
        {
            "actor_user_uuid": actor_uuid,
            "actor_role": actor_role,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "request_id": str(req_id) if req_id else None,
            "method": request.method,
            "path": request.url.path,
            "ip_address": _request_ip(request),
            "user_agent": str(request.headers.get("user-agent") or "")[:512],
            "payload": json.dumps(payload or {}, ensure_ascii=False, default=str),
        },
    )


def _serialize_admin_audit_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "actor_user_uuid": row.get("actor_user_uuid"),
        "actor_role": row.get("actor_role"),
        "action": row.get("action"),
        "entity_type": row.get("entity_type"),
        "entity_id": row.get("entity_id"),
        "request_id": row.get("request_id"),
        "method": row.get("method"),
        "path": row.get("path"),
        "ip_address": row.get("ip_address"),
        "user_agent": row.get("user_agent"),
        "payload": row.get("payload") if isinstance(row.get("payload"), dict) else {},
        "created_at": _serialize_datetime_value(row.get("created_at")),
    }


async def _invalidate_product_caches(redis: Redis) -> None:
    keys = [key async for key in redis.scan_iter(match="plp:*")]
    keys.extend([key async for key in redis.scan_iter(match="pdp:*")])
    if keys:
        await redis.delete(*keys)


async def _resolve_product_id_or_404(db: AsyncSession, product_ref: str | int) -> int:
    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    resolved = await repo.resolve_entity_ref("product", product_ref)
    if resolved is None:
        raise HTTPException(status_code=404, detail="product not found")
    return resolved


async def _resolve_store_id_or_404(db: AsyncSession, store_ref: str) -> int:
    store_uuid = _normalize_uuid_ref(store_ref, field_name="store_id")
    resolved = (
        await db.execute(
            text("select id from catalog_stores where uuid = cast(:uuid as uuid)"),
            {"uuid": store_uuid},
        )
    ).scalar_one_or_none()
    if resolved is None:
        raise HTTPException(status_code=404, detail="store not found")
    return int(resolved)


async def _resolve_category_id_or_404(db: AsyncSession, category_ref: str) -> int:
    category_uuid = _normalize_uuid_ref(category_ref, field_name="category_id")
    resolved = (
        await db.execute(
            text("select id from catalog_categories where uuid = cast(:uuid as uuid)"),
            {"uuid": category_uuid},
        )
    ).scalar_one_or_none()
    if resolved is None:
        raise HTTPException(status_code=404, detail="category not found")
    return int(resolved)


async def _resolve_source_id_or_404(db: AsyncSession, *, store_id: int, source_ref: str) -> int:
    source_uuid = _normalize_uuid_ref(source_ref, field_name="source_id")
    resolved = (
        await db.execute(
            text("select id from catalog_scrape_sources where store_id = :store_id and uuid = cast(:uuid as uuid)"),
            {"store_id": store_id, "uuid": source_uuid},
        )
    ).scalar_one_or_none()
    if resolved is None:
        raise HTTPException(status_code=404, detail="source not found")
    return int(resolved)


async def _normalize_source_payload(
    db: AsyncSession,
    *,
    store_id: int,
    url_value: str,
    source_type: str | None,
) -> tuple[str, str]:
    normalized_type = (source_type or "category").strip().lower()
    if normalized_type not in {"category", "search", "sitemap", "manual"}:
        normalized_type = "category"

    normalized_url = (url_value or "").strip()
    if not normalized_url:
        raise HTTPException(status_code=422, detail="source url is required")

    if normalized_url.startswith(("http://", "https://")):
        return normalized_url, normalized_type

    base_url = (
        await db.execute(
            text("select base_url from catalog_stores where id = :id"),
            {"id": store_id},
        )
    ).scalar_one_or_none()
    if not base_url:
        raise HTTPException(status_code=422, detail="set store base_url before using relative source path")
    return urljoin(str(base_url).rstrip("/") + "/", normalized_url.lstrip("/")), normalized_type


def _normalize_import_row(raw_row: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in raw_row.items():
        if key is None:
            continue
        normalized_key = str(key).strip().lower()
        if not normalized_key:
            continue
        normalized[normalized_key] = value.strip() if isinstance(value, str) else value
    return normalized


def _pick_first(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def _parse_json_rows(content: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"invalid JSON payload: {exc.msg}") from exc

    if isinstance(parsed, dict):
        items = parsed.get("items")
        if isinstance(items, list):
            parsed = items
        else:
            raise HTTPException(status_code=422, detail="JSON import requires a list or an object with an `items` list")

    if not isinstance(parsed, list):
        raise HTTPException(status_code=422, detail="JSON import requires a list of rows")

    rows: list[dict[str, Any]] = []
    for index, item in enumerate(parsed, start=1):
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail=f"row {index} must be a JSON object")
        rows.append(item)
    return rows


def _parse_csv_rows(content: str) -> list[dict[str, Any]]:
    cleaned = content.lstrip("\ufeff")
    sample = cleaned[:2048]
    delimiter = ","
    try:
        sniffed = csv.Sniffer().sniff(sample, delimiters=",;\t")
        delimiter = sniffed.delimiter
    except csv.Error:
        if sample.count(";") > sample.count(","):
            delimiter = ";"

    reader = csv.DictReader(io.StringIO(cleaned), delimiter=delimiter)
    if not reader.fieldnames:
        raise HTTPException(status_code=422, detail="CSV import requires a header row")

    return [{str(key): value for key, value in row.items() if key is not None} for row in reader]


def _parse_import_rows(payload: ProductsImportIn) -> list[dict[str, Any]]:
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="import content is empty")
    if payload.source == "json":
        return _parse_json_rows(content)
    if payload.source == "csv":
        return _parse_csv_rows(content)
    raise HTTPException(status_code=422, detail=f"unsupported import source: {payload.source}")


def _parse_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        return Decimal(int(value))
    if isinstance(value, int | float):
        return Decimal(str(value))
    text_value = str(value).strip().replace("\u00a0", "").replace(" ", "")
    if not text_value:
        return None
    text_value = text_value.replace(",", ".")
    text_value = re.sub(r"[^0-9.\-]", "", text_value)
    if not text_value or text_value in {"-", ".", "-."}:
        return None
    try:
        return Decimal(text_value)
    except InvalidOperation:
        return None


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    text_value = re.sub(r"[^\d\-]", "", str(value).strip())
    if not text_value:
        return None
    try:
        return int(text_value)
    except ValueError:
        return None


def _parse_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        return value != 0
    text_value = str(value).strip().lower()
    if text_value in {"1", "true", "yes", "y", "in_stock", "instock", "available"}:
        return True
    if text_value in {"0", "false", "no", "n", "out_of_stock", "outofstock", "unavailable"}:
        return False
    return None


def _parse_datetime(value: Any) -> datetime:
    if value is None:
        return datetime.now(UTC)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, int | float):
        return datetime.fromtimestamp(float(value), tz=UTC)
    text_value = str(value).strip()
    if not text_value:
        return datetime.now(UTC)
    try:
        parsed = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    except ValueError:
        return datetime.now(UTC)


def _parse_json_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return {str(k): v for k, v in value.items()}
    if isinstance(value, str):
        text_value = value.strip()
        if not text_value:
            return {}
        try:
            parsed = json.loads(text_value)
            if isinstance(parsed, dict):
                return {str(k): v for k, v in parsed.items()}
            return {}
        except json.JSONDecodeError:
            return {}
    return {}


def _stable_bigint_id(value: str) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return (int.from_bytes(digest[:8], "big") & ((1 << 63) - 1)) or 1


async def _resolve_default_category_id(db: AsyncSession) -> int:
    category_id = (
        await db.execute(
            text(
                """
                select id
                from catalog_categories
                where is_active = true
                order by id asc
                limit 1
                """
            )
        )
    ).scalar_one_or_none()
    if category_id is not None:
        return int(category_id)

    inserted = (
        await db.execute(
            text(
                """
                insert into catalog_categories (slug, name_uz, parent_id, lft, rgt, is_active)
                values (:slug, :name_uz, null, 0, 0, true)
                returning id
                """
            ),
            {
                "slug": f"imported-{secrets.token_hex(3)}",
                "name_uz": "Imported",
            },
        )
    ).scalar_one()
    return int(inserted)


async def _ensure_unique_store_slug(db: AsyncSession, base_slug: str) -> str:
    slug_base = _slugify(base_slug)
    slug = slug_base
    suffix = 1
    while True:
        exists = (
            await db.execute(text("select 1 from catalog_stores where slug = :slug"), {"slug": slug})
        ).scalar_one_or_none()
        if not exists:
            return slug
        slug = f"{slug_base}-{suffix}"
        suffix += 1


async def _create_store_for_import(db: AsyncSession, *, name: str, slug_hint: str) -> int:
    slug = await _ensure_unique_store_slug(db, slug_hint)
    inserted = (
        await db.execute(
            text(
                """
                insert into catalog_stores (slug, name, provider, country_code, is_active, trust_score, crawl_priority)
                values (:slug, :name, 'manual', 'UZ', true, 0.50, 500)
                returning id
                """
            ),
            {"slug": slug, "name": name},
        )
    ).scalar_one()
    return int(inserted)


async def _resolve_default_store_id(db: AsyncSession, explicit_store_id: str | None) -> int:
    if explicit_store_id is not None:
        return await _resolve_store_id_or_404(db, explicit_store_id)

    existing = (
        await db.execute(
            text(
                """
                select id
                from catalog_stores
                where is_active = true
                order by crawl_priority asc, id asc
                limit 1
                """
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return int(existing)

    return await _create_store_for_import(db, name="Manual Import Store", slug_hint="manual-import")


async def _resolve_store_for_import(
    db: AsyncSession,
    row: dict[str, Any],
    *,
    default_store_id: int,
    id_cache: dict[int, int],
    slug_cache: dict[str, int],
    name_cache: dict[str, int],
) -> int:
    explicit_id = _parse_int(_pick_first(row, "store_id"))
    if explicit_id is not None and explicit_id > 0:
        cached = id_cache.get(explicit_id)
        if cached is not None:
            return cached
        found = (await db.execute(text("select id from catalog_stores where id = :id"), {"id": explicit_id})).scalar_one_or_none()
        if found is not None:
            resolved = int(found)
            id_cache[explicit_id] = resolved
            return resolved

    store_slug = str(_pick_first(row, "store_slug") or "").strip().lower()
    if store_slug:
        cached = slug_cache.get(store_slug)
        if cached is not None:
            return cached
        found = (
            await db.execute(text("select id from catalog_stores where lower(slug) = :slug"), {"slug": store_slug})
        ).scalar_one_or_none()
        if found is not None:
            resolved = int(found)
            slug_cache[store_slug] = resolved
            return resolved

    store_name = str(_pick_first(row, "store_name", "shop_name") or "").strip()
    if store_name:
        name_key = store_name.lower()
        cached = name_cache.get(name_key)
        if cached is not None:
            return cached
        found = (
            await db.execute(text("select id from catalog_stores where lower(name) = :name"), {"name": name_key})
        ).scalar_one_or_none()
        if found is not None:
            resolved = int(found)
            name_cache[name_key] = resolved
            return resolved

    if store_slug or store_name:
        created_id = await _create_store_for_import(
            db,
            name=store_name or store_slug,
            slug_hint=store_slug or store_name,
        )
        if store_slug:
            slug_cache[store_slug] = created_id
        if store_name:
            name_cache[store_name.lower()] = created_id
        return created_id

    return default_store_id


async def _resolve_or_create_canonical_for_import(
    db: AsyncSession,
    *,
    title: str,
    category_id: int,
    specs: dict[str, Any],
    main_image: str | None,
) -> int:
    normalized_title = re.sub(r"\s+", " ", title).strip()
    existing = (
        await db.execute(
            text(
                """
                select id
                from catalog_canonical_products
                where category_id = :category_id
                  and brand_id is null
                  and is_active = true
                  and lower(normalized_title) = lower(:title)
                order by id asc
                limit 1
                """
            ),
            {"category_id": category_id, "title": normalized_title},
        )
    ).scalar_one_or_none()
    if existing is not None:
        canonical_id = int(existing)
        await db.execute(
            text(
                """
                update catalog_canonical_products
                set
                    main_image = coalesce(main_image, :main_image),
                    specs = case
                        when coalesce(specs, '{}'::jsonb) = '{}'::jsonb then cast(:specs as jsonb)
                        else specs
                    end,
                    updated_at = now()
                where id = :id
                """
            ),
            {
                "id": canonical_id,
                "main_image": main_image,
                "specs": json.dumps(specs or {}, ensure_ascii=False),
            },
        )
        return canonical_id

    inserted = (
        await db.execute(
            text(
                """
                insert into catalog_canonical_products
                    (normalized_title, main_image, category_id, brand_id, specs, is_active)
                values
                    (:title, :main_image, :category_id, null, cast(:specs as jsonb), true)
                returning id
                """
            ),
            {
                "title": normalized_title,
                "main_image": main_image,
                "category_id": category_id,
                "specs": json.dumps(specs or {}, ensure_ascii=False),
            },
        )
    ).scalar_one()
    return int(inserted)


async def _upsert_store_product_for_import(
    db: AsyncSession,
    *,
    store_id: int,
    canonical_product_id: int,
    external_id: str,
    external_url: str,
    title_raw: str,
    description_raw: str | None,
    image_url: str | None,
    availability: str,
    metadata: dict[str, Any],
    seen_at: datetime,
) -> int:
    existing = (
        await db.execute(
            text(
                """
                select id
                from catalog_store_products
                where store_id = :store_id
                  and external_id = :external_id
                limit 1
                """
            ),
            {"store_id": store_id, "external_id": external_id},
        )
    ).scalar_one_or_none()
    params = {
        "store_id": store_id,
        "canonical_product_id": canonical_product_id,
        "external_id": external_id,
        "external_url": external_url,
        "title_raw": title_raw,
        "title_clean": title_raw.lower(),
        "description_raw": description_raw,
        "image_url": image_url,
        "availability": availability,
        "metadata": json.dumps(metadata, ensure_ascii=False),
        "seen_at": seen_at,
    }
    if existing is None:
        inserted = (
            await db.execute(
                text(
                    """
                    insert into catalog_store_products
                        (store_id, canonical_product_id, product_id, external_id, external_url, title_raw, title_clean,
                         description_raw, image_url, availability, metadata, last_seen_at)
                    values
                        (:store_id, :canonical_product_id, null, :external_id, :external_url, :title_raw, :title_clean,
                         :description_raw, :image_url, :availability, cast(:metadata as jsonb), :seen_at)
                    returning id
                    """
                ),
                params,
            )
        ).scalar_one()
        return int(inserted)

    updated = (
        await db.execute(
            text(
                """
                update catalog_store_products
                set
                    canonical_product_id = :canonical_product_id,
                    external_url = :external_url,
                    title_raw = :title_raw,
                    title_clean = :title_clean,
                    description_raw = :description_raw,
                    image_url = :image_url,
                    availability = :availability,
                    metadata = cast(:metadata as jsonb),
                    last_seen_at = :seen_at,
                    updated_at = now()
                where id = :id
                returning id
                """
            ),
            {
                **params,
                "id": int(existing),
            },
        )
    ).scalar_one()
    return int(updated)


async def _upsert_offer_for_import(
    db: AsyncSession,
    *,
    offer_id: int,
    canonical_product_id: int,
    store_id: int,
    store_product_id: int,
    offer_url: str,
    currency: str,
    price_amount: Decimal,
    old_price_amount: Decimal | None,
    in_stock: bool,
    delivery_days: int | None,
    shipping_cost: Decimal | None,
    scraped_at: datetime,
) -> None:
    await db.execute(
        text(
            """
            insert into catalog_offers
                (id, canonical_product_id, store_id, seller_id, store_product_id, product_variant_id, offer_url,
                 currency, price_amount, old_price_amount, in_stock, delivery_days, shipping_cost, scraped_at, is_valid)
            values
                (:id, :canonical_product_id, :store_id, null, :store_product_id, null, :offer_url,
                 :currency, :price_amount, :old_price_amount, :in_stock, :delivery_days, :shipping_cost, :scraped_at, true)
            on conflict (id) do update
            set
                canonical_product_id = excluded.canonical_product_id,
                store_id = excluded.store_id,
                store_product_id = excluded.store_product_id,
                offer_url = excluded.offer_url,
                currency = excluded.currency,
                price_amount = excluded.price_amount,
                old_price_amount = excluded.old_price_amount,
                in_stock = excluded.in_stock,
                delivery_days = excluded.delivery_days,
                shipping_cost = excluded.shipping_cost,
                scraped_at = excluded.scraped_at,
                is_valid = true
            """
        ),
        {
            "id": offer_id,
            "canonical_product_id": canonical_product_id,
            "store_id": store_id,
            "store_product_id": store_product_id,
            "offer_url": offer_url,
            "currency": currency,
            "price_amount": price_amount,
            "old_price_amount": old_price_amount,
            "in_stock": in_stock,
            "delivery_days": delivery_days,
            "shipping_cost": shipping_cost,
            "scraped_at": scraped_at,
        },
    )

    await db.execute(
        text(
            """
            insert into catalog_price_history (offer_id, price_amount, in_stock, captured_at)
            values (:offer_id, :price_amount, :in_stock, :captured_at)
            """
        ),
        {
            "offer_id": offer_id,
            "price_amount": price_amount,
            "in_stock": in_stock,
            "captured_at": scraped_at,
        },
    )


async def _ingest_import_row(
    db: AsyncSession,
    raw_row: dict[str, Any],
    *,
    default_category_id: int,
    default_store_id: int,
    id_cache: dict[int, int],
    slug_cache: dict[str, int],
    name_cache: dict[str, int],
) -> bool:
    row = _normalize_import_row(raw_row)
    title_value = _pick_first(row, "title", "title_raw", "normalized_title", "name", "product_title")
    if not title_value:
        return False
    title = re.sub(r"\s+", " ", str(title_value)).strip()
    if not title:
        return False

    price = _parse_decimal(_pick_first(row, "price_amount", "price", "current_price"))
    if price is None or price < 0:
        return False

    category_id = _parse_int(_pick_first(row, "category_id")) or default_category_id
    if category_id <= 0:
        category_id = default_category_id

    store_id = await _resolve_store_for_import(
        db,
        row,
        default_store_id=default_store_id,
        id_cache=id_cache,
        slug_cache=slug_cache,
        name_cache=name_cache,
    )

    image_url = str(_pick_first(row, "image_url", "main_image", "image") or "").strip() or None
    specs = _parse_json_dict(_pick_first(row, "specs", "specifications"))
    canonical_id = await _resolve_or_create_canonical_for_import(
        db,
        title=title,
        category_id=category_id,
        specs=specs,
        main_image=image_url,
    )

    external_url = str(_pick_first(row, "external_url", "offer_url", "url", "link") or "").strip()
    external_id_value = _pick_first(row, "external_id", "source_id", "sku", "offer_id", "id")
    external_id = str(external_id_value).strip() if external_id_value is not None else ""
    if not external_id:
        seed = external_url or title
        external_id = _hash(f"{store_id}:{seed}")
    if not external_url:
        external_url = f"https://manual-import.local/products/{external_id}"

    in_stock_value = _parse_bool(_pick_first(row, "in_stock", "available"))
    availability_value = str(_pick_first(row, "availability") or "").strip().lower()
    if in_stock_value is None:
        if availability_value:
            in_stock_value = availability_value not in {"out_of_stock", "no", "unavailable"}
        else:
            in_stock_value = True

    old_price = _parse_decimal(_pick_first(row, "old_price_amount", "old_price", "previous_price"))
    delivery_days = _parse_int(_pick_first(row, "delivery_days"))
    if delivery_days is not None and delivery_days < 0:
        delivery_days = None
    shipping_cost = _parse_decimal(_pick_first(row, "shipping_cost"))
    if shipping_cost is not None and shipping_cost < 0:
        shipping_cost = None
    scraped_at = _parse_datetime(_pick_first(row, "scraped_at", "updated_at", "timestamp"))
    currency = str(_pick_first(row, "currency") or "UZS").upper().strip()[:3] or "UZS"

    metadata = _parse_json_dict(_pick_first(row, "metadata", "metadata_json"))
    if specs and "specifications" not in metadata:
        metadata["specifications"] = specs
    metadata.setdefault("import_source", "admin")
    metadata.setdefault("raw_title", title)

    store_product_id = await _upsert_store_product_for_import(
        db,
        store_id=store_id,
        canonical_product_id=canonical_id,
        external_id=external_id,
        external_url=external_url,
        title_raw=title,
        description_raw=str(_pick_first(row, "description", "description_raw") or "").strip() or None,
        image_url=image_url,
        availability=availability_value or ("in_stock" if in_stock_value else "out_of_stock"),
        metadata=metadata,
        seen_at=scraped_at,
    )

    offer_id_raw = _pick_first(row, "offer_id")
    offer_id = _parse_int(offer_id_raw) if offer_id_raw is not None else None
    if offer_id is None or offer_id <= 0:
        offer_id = _stable_bigint_id(f"{store_id}:{external_id}")

    await _upsert_offer_for_import(
        db,
        offer_id=offer_id,
        canonical_product_id=canonical_id,
        store_id=store_id,
        store_product_id=store_product_id,
        offer_url=external_url,
        currency=currency,
        price_amount=price,
        old_price_amount=old_price,
        in_stock=bool(in_stock_value),
        delivery_days=delivery_days,
        shipping_cost=shipping_cost,
        scraped_at=scraped_at,
    )
    return True


async def _fetch_export_rows(db: AsyncSession, *, limit: int) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            text(
                """
                select
                    o.id as offer_id,
                    o.scraped_at,
                    o.price_amount,
                    o.old_price_amount,
                    o.in_stock,
                    coalesce(o.offer_url, sp.external_url) as external_url,
                    o.canonical_product_id as product_id,
                    cp.normalized_title,
                    o.store_id,
                    s.name as store_name
                from catalog_offers o
                join catalog_store_products sp on sp.id = o.store_product_id
                join catalog_canonical_products cp on cp.id = o.canonical_product_id
                join catalog_stores s on s.id = o.store_id
                order by o.scraped_at desc, o.id desc
                limit :limit
                """
            ),
            {"limit": limit},
        )
    ).mappings().all()
    return [dict(row) for row in rows]


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    center = len(sorted_values) // 2
    if len(sorted_values) % 2:
        return float(sorted_values[center])
    return float((sorted_values[center - 1] + sorted_values[center]) / 2)


async def _load_orders_snapshot(redis: Redis) -> list[dict[str, Any]]:
    orders = await list_orders(page=1, limit=500, redis=redis)
    return orders.get("items", []) if isinstance(orders, dict) else []


def _serialize_admin_user_payload(*, user_uuid: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user_uuid,
        "email": payload.get("email"),
        "full_name": payload.get("full_name", ""),
        "role": payload.get("role", "user"),
        "is_active": payload.get("is_active", "true") == "true" if isinstance(payload.get("is_active"), str) else bool(payload.get("is_active", True)),
        "created_at": payload.get("created_at"),
        "last_seen_at": payload.get("last_seen_at"),
    }


def _serialize_admin_user_from_pg(user: AuthUser) -> dict[str, Any]:
    return {
        "id": str(user.uuid),
        "email": str(user.email or ""),
        "full_name": str(user.full_name or ""),
        "role": str(user.role or "user"),
        "is_active": bool(user.is_active),
        "created_at": user.created_at.astimezone(UTC).isoformat() if user.created_at else None,
        "last_seen_at": user.last_seen_at.astimezone(UTC).isoformat() if user.last_seen_at else None,
    }


async def _load_users_snapshot(redis: Redis, db: AsyncSession) -> list[dict[str, Any]]:
    if _auth_reads_from_postgres():
        rows = (
            await db.execute(
                select(AuthUser).order_by(AuthUser.id.asc())
            )
        ).scalars().all()
        return [_serialize_admin_user_from_pg(user) for user in rows]

    users: list[dict[str, Any]] = []
    async for key in redis.scan_iter(match="auth:user:*"):
        if key.count(":") != 2:
            continue
        if await redis.type(key) != "hash":
            continue
        payload = await redis.hgetall(key)
        if not payload:
            continue
        user_uuid = await _ensure_user_uuid(redis, user_key=key, payload=payload)
        users.append(_serialize_admin_user_payload(user_uuid=user_uuid, payload=payload))
    return users


async def _load_feedback_snapshot(redis: Redis) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    async def collect(kind: str, pattern: str) -> None:
        async for key in redis.scan_iter(match=pattern):
            if key.count(":") != 2:
                continue
            if await redis.type(key) != "hash":
                continue
            payload = await redis.hgetall(key)
            if not payload:
                continue
            items.append(
                {
                    "kind": kind,
                    "id": payload.get("id"),
                    "status": str(payload.get("status", "pending")).strip().lower(),
                    "created_at": payload.get("created_at"),
                    "updated_at": payload.get("updated_at"),
                    "moderated_at": payload.get("moderated_at"),
                }
            )

    await collect("review", "feedback:review:rev_*")
    await collect("question", "feedback:question:q_*")
    return items


def _build_orders_status_counts(orders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counters: dict[str, int] = {}
    for row in orders:
        status = str(row.get("status", "unknown")).strip().lower() or "unknown"
        counters[status] = counters.get(status, 0) + 1
    return [{"status": status, "count": count} for status, count in sorted(counters.items(), key=lambda item: item[0])]


def _build_revenue_series(
    orders: list[dict[str, Any]],
    *,
    range_start: datetime,
    range_end: datetime,
    granularity: str,
) -> list[dict[str, Any]]:
    points = _init_series(range_start, range_end, granularity)
    buckets: dict[str, dict[str, float]] = {
        _series_ts(point): {"revenue": 0.0, "orders": 0.0}
        for point in points
    }
    for row in orders:
        created_at = _parse_iso_datetime(row.get("created_at"))
        if not created_at or created_at < range_start:
            continue
        bucket = _bucket_start(created_at, granularity)
        ts = _series_ts(bucket)
        if ts not in buckets:
            buckets[ts] = {"revenue": 0.0, "orders": 0.0}
        buckets[ts]["orders"] += 1
        buckets[ts]["revenue"] += _to_float(row.get("total_amount"))

    series: list[dict[str, Any]] = []
    for ts in sorted(buckets.keys()):
        orders_value = int(buckets[ts]["orders"])
        revenue_value = float(buckets[ts]["revenue"])
        aov = (revenue_value / orders_value) if orders_value > 0 else 0.0
        series.append(
            {
                "ts": ts,
                "revenue": revenue_value,
                "orders": orders_value,
                "aov": aov,
                "value": revenue_value,
            }
        )
    return series


def _build_moderation_series(
    items: list[dict[str, Any]],
    *,
    range_start: datetime,
    range_end: datetime,
    granularity: str,
) -> list[dict[str, Any]]:
    points = _init_series(range_start, range_end, granularity)
    buckets: dict[str, dict[str, int]] = {
        _series_ts(point): {"pending": 0, "published": 0, "rejected": 0}
        for point in points
    }

    for item in items:
        status = str(item.get("status", "pending")).strip().lower()
        if status not in {"pending", "published", "rejected"}:
            continue
        reference = _parse_iso_datetime(item.get("updated_at")) or _parse_iso_datetime(item.get("created_at"))
        if not reference or reference < range_start:
            continue
        ts = _series_ts(_bucket_start(reference, granularity))
        if ts not in buckets:
            buckets[ts] = {"pending": 0, "published": 0, "rejected": 0}
        buckets[ts][status] += 1

    return [
        {"ts": ts, "pending": values["pending"], "published": values["published"], "rejected": values["rejected"]}
        for ts, values in sorted(buckets.items(), key=lambda item: item[0])
    ]


def _build_user_series(
    users: list[dict[str, Any]],
    *,
    range_start: datetime,
    range_end: datetime,
    granularity: str,
) -> list[dict[str, Any]]:
    points = _init_series(range_start, range_end, granularity)
    buckets: dict[str, int] = {_series_ts(point): 0 for point in points}
    for user in users:
        created_at = _parse_iso_datetime(user.get("created_at"))
        if not created_at or created_at < range_start:
            continue
        ts = _series_ts(_bucket_start(created_at, granularity))
        buckets[ts] = buckets.get(ts, 0) + 1
    return [{"ts": ts, "value": count} for ts, count in sorted(buckets.items(), key=lambda item: item[0])]


async def _query_quality_series(db: AsyncSession, *, since: datetime) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            text(
                """
                select created_at, summary
                from catalog_data_quality_reports
                where created_at >= :since
                order by created_at asc, id asc
                """
            ),
            {"since": since},
        )
    ).mappings().all()
    points: list[dict[str, Any]] = []
    for row in rows:
        summary = row.get("summary") if isinstance(row.get("summary"), dict) else {}
        created_at = _parse_iso_datetime(row.get("created_at"))
        if not created_at:
            continue
        points.append(
            {
                "ts": _series_ts(created_at),
                "active_without_valid_offers_ratio": _to_float(summary.get("active_without_valid_offers_ratio")),
                "search_mismatch_ratio": _to_float(summary.get("search_mismatch_ratio")),
                "low_quality_image_ratio": _to_float(summary.get("low_quality_image_ratio")),
            }
        )
    return points


async def _query_latest_quality_report(db: AsyncSession) -> dict[str, Any] | None:
    row = (
        await db.execute(
            text(
                """
                select uuid as id, status, summary, checks, created_at
                from catalog_data_quality_reports
                order by created_at desc, id desc
                limit 1
                """
            )
        )
    ).mappings().first()
    return _serialize_quality_report_row(dict(row)) if row else None


async def _query_top_revenue_entities(db: AsyncSession, *, since: datetime, dimension: str, limit: int = 8) -> list[dict[str, Any]]:
    if dimension == "store":
        query = """
            select s.uuid as id, s.name as name, sum(o.price_amount)::double precision as revenue_proxy, count(*)::int as offers
            from catalog_offers o
            join catalog_stores s on s.id = o.store_id
            where o.scraped_at >= :since and o.is_valid = true and o.in_stock = true
            group by s.id, s.uuid, s.name
            order by revenue_proxy desc nulls last
            limit :limit
        """
    elif dimension == "category":
        query = """
            select
                c.uuid as id,
                coalesce(c.name_uz, c.name_ru, c.name_en, c.slug) as name,
                sum(o.price_amount)::double precision as revenue_proxy,
                count(*)::int as offers
            from catalog_offers o
            join catalog_canonical_products cp on cp.id = o.canonical_product_id
            join catalog_categories c on c.id = cp.category_id
            where o.scraped_at >= :since and o.is_valid = true and o.in_stock = true
            group by c.id, c.uuid, c.name_ru, c.name_uz, c.name_en, c.slug
            order by revenue_proxy desc nulls last
            limit :limit
        """
    else:
        query = """
            select b.uuid as id, b.name as name, sum(o.price_amount)::double precision as revenue_proxy, count(*)::int as offers
            from catalog_offers o
            join catalog_canonical_products cp on cp.id = o.canonical_product_id
            join catalog_brands b on b.id = cp.brand_id
            where o.scraped_at >= :since and o.is_valid = true and o.in_stock = true
            group by b.id, b.uuid, b.name
            order by revenue_proxy desc nulls last
            limit :limit
        """
    rows = (await db.execute(text(query), {"since": since, "limit": max(1, limit)})).mappings().all()
    return [
        {
            "id": row.get("id"),
            "name": row.get("name"),
            "revenue_proxy": _to_float(row.get("revenue_proxy")),
            "offers": _to_int(row.get("offers")),
        }
        for row in rows
    ]


async def _query_quality_no_offer_breakdown(db: AsyncSession, *, limit: int = 8) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            text(
                """
                with offer_stats as (
                    select
                        cp.id,
                        cp.category_id,
                        count(distinct case when o.is_valid = true and o.in_stock = true then o.store_id end) as valid_store_count
                    from catalog_canonical_products cp
                    left join catalog_offers o on o.canonical_product_id = cp.id
                    where cp.is_active = true
                    group by cp.id, cp.category_id
                )
                select
                    c.uuid as category_id,
                    coalesce(c.name_uz, c.name_ru, c.name_en, c.slug) as category_name,
                    count(*)::int as products
                from offer_stats s
                join catalog_categories c on c.id = s.category_id
                where s.valid_store_count = 0
                group by c.id, c.uuid, c.name_ru, c.name_uz, c.name_en, c.slug
                order by products desc, category_name asc
                limit :limit
                """
            ),
            {"limit": max(1, limit)},
        )
    ).mappings().all()
    return [
        {"category_id": row.get("category_id"), "category_name": row.get("category_name"), "products": _to_int(row.get("products"))}
        for row in rows
    ]


async def _query_operations_metrics(db: AsyncSession, *, since: datetime) -> dict[str, Any]:
    status_rows = (
        await db.execute(
            text(
                """
                select lower(status) as status, count(*)::int as total
                from catalog_crawl_jobs
                where started_at >= :since
                group by lower(status)
                order by total desc, status asc
                """
            ),
            {"since": since},
        )
    ).mappings().all()
    status_breakdown = [{"status": row.get("status") or "unknown", "count": _to_int(row.get("total"))} for row in status_rows]
    total_runs = sum(item["count"] for item in status_breakdown)
    failed_runs = sum(item["count"] for item in status_breakdown if item["status"] in {"failed", "failure", "error", "cancelled"})
    success_rate = (float(max(total_runs - failed_runs, 0)) / float(total_runs)) if total_runs > 0 else 1.0
    failed_rate = (float(failed_runs) / float(total_runs)) if total_runs > 0 else 0.0

    duration_rows = (
        await db.execute(
            text(
                """
                select
                    date_trunc('day', started_at) as bucket,
                    avg(extract(epoch from (coalesce(finished_at, now()) - started_at)))::double precision as avg_duration_sec
                from catalog_crawl_jobs
                where started_at >= :since
                group by bucket
                order by bucket asc
                """
            ),
            {"since": since},
        )
    ).mappings().all()
    duration_series = [
        {"ts": _series_ts(_parse_iso_datetime(row.get("bucket")) or since), "avg_duration_sec": _to_float(row.get("avg_duration_sec"))}
        for row in duration_rows
    ]

    queue_row = (
        await db.execute(
            text(
                """
                select
                    count(*) filter (where is_active = true)::int as active_sources,
                    count(*)::int as total_sources
                from catalog_scrape_sources
                """
            )
        )
    ).mappings().one()

    return {
        "summary": {
            "runs_total": total_runs,
            "failed_runs": failed_runs,
            "success_rate": success_rate,
            "failed_task_rate_24h": failed_rate,
            "active_sources": _to_int(queue_row.get("active_sources")),
            "total_sources": _to_int(queue_row.get("total_sources")),
        },
        "status_breakdown": status_breakdown,
        "duration_series": duration_series,
    }


async def _evaluate_and_store_alert_events(
    *,
    db: AsyncSession,
    redis: Redis,
    quality_risk_ratio: float,
    search_mismatch_ratio: float,
    pending_total: int,
    cancel_rate: float,
    failed_task_rate_24h: float,
) -> dict[str, int]:
    rules = [
        {
            "code": "catalog_quality.active_without_valid_offers_ratio",
            "title": "Высокая доля товаров без валидных офферов",
            "source": "catalog_quality",
            "metric_value": float(quality_risk_ratio),
            "warn_threshold": float(settings.admin_alert_quality_warn_ratio),
            "critical_threshold": float(settings.admin_alert_quality_critical_ratio),
        },
        {
            "code": "catalog_quality.search_mismatch_ratio",
            "title": "Высокий search mismatch в каталоге",
            "source": "catalog_quality",
            "metric_value": float(search_mismatch_ratio),
            "warn_threshold": float(settings.admin_alert_search_mismatch_warn_ratio),
            "critical_threshold": float(settings.admin_alert_search_mismatch_critical_ratio),
        },
        {
            "code": "moderation.pending_total",
            "title": "Очередь модерации растет",
            "source": "moderation",
            "metric_value": float(pending_total),
            "warn_threshold": float(settings.admin_alert_moderation_pending_warn),
            "critical_threshold": float(settings.admin_alert_moderation_pending_critical),
        },
        {
            "code": "orders.cancel_rate",
            "title": "Высокая доля отмен заказов",
            "source": "revenue",
            "metric_value": float(cancel_rate),
            "warn_threshold": float(settings.admin_alert_order_cancel_rate_warn),
            "critical_threshold": float(settings.admin_alert_order_cancel_rate_critical),
        },
        {
            "code": "operations.failed_task_rate_24h",
            "title": "Повышенная доля неуспешных операций",
            "source": "operations",
            "metric_value": float(failed_task_rate_24h),
            "warn_threshold": float(settings.admin_alert_operation_failed_rate_warn),
            "critical_threshold": float(settings.admin_alert_operation_failed_rate_critical),
        },
    ]

    opened = 0
    resolved = 0
    updated = 0

    for rule in rules:
        severity = _severity_by_threshold(
            float(rule["metric_value"]),
            warn=float(rule["warn_threshold"]),
            critical=float(rule["critical_threshold"]),
        )
        current = (
            await db.execute(
                text(
                    """
                    select id
                    from admin_alert_events
                    where code = :code
                      and status in ('open', 'ack')
                    order by created_at desc, id desc
                    limit 1
                    """
                ),
                {"code": str(rule["code"])},
            )
        ).mappings().first()

        if severity is None:
            if current:
                await db.execute(
                    text(
                        """
                        update admin_alert_events
                        set status = 'resolved',
                            resolved_at = now(),
                            updated_at = now()
                        where id = :id
                        """
                    ),
                    {"id": _to_int(current.get("id"))},
                )
                resolved += 1
            continue

        payload = {
            "title": str(rule["title"]),
            "source": str(rule["source"]),
            "severity": str(severity),
            "metric_value": float(rule["metric_value"]),
            "threshold_value": float(rule["critical_threshold"] if severity == "critical" else rule["warn_threshold"]),
            "context": json.dumps(
                {
                    "warn_threshold": float(rule["warn_threshold"]),
                    "critical_threshold": float(rule["critical_threshold"]),
                    "metric_value": float(rule["metric_value"]),
                },
                ensure_ascii=False,
            ),
        }

        if current:
            await db.execute(
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
                {"id": _to_int(current.get("id")), **payload},
            )
            updated += 1
            continue

        await db.execute(
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
            {"code": str(rule["code"]), **payload},
        )
        opened += 1

    await db.commit()
    if opened or updated or resolved:
        await _invalidate_admin_analytics_cache(redis)
    return {"opened": opened, "updated": updated, "resolved": resolved}


async def _query_alert_events(
    *,
    db: AsyncSession,
    status: str = "open",
    severity: str | None = None,
    source: str | None = None,
    code: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    where_parts = ["1=1"]
    params: dict[str, Any] = {"limit": max(1, min(limit, 200)), "offset": max(0, offset)}
    if status in ALERT_EVENT_STATUSES:
        where_parts.append("status = :status")
        params["status"] = status
    if severity and severity in ALERT_EVENT_SEVERITIES:
        where_parts.append("severity = :severity")
        params["severity"] = severity
    if source and source in ALERT_EVENT_SOURCES:
        where_parts.append("source = :source")
        params["source"] = source
    if code:
        where_parts.append("code = :code")
        params["code"] = code

    where_sql = " and ".join(where_parts)
    total = _to_int(
        (
            await db.execute(
                text(f"select count(*)::int as c from admin_alert_events where {where_sql}"),
                params,
            )
        ).scalar_one()
    )
    rows = (
        await db.execute(
            text(
                f"""
                select
                    uuid as id,
                    code,
                    title,
                    source,
                    severity,
                    status,
                    metric_value,
                    threshold_value,
                    context,
                    created_at,
                    acknowledged_at,
                    resolved_at
                from admin_alert_events
                where {where_sql}
                order by created_at desc, id desc
                limit :limit
                offset :offset
                """
            ),
            params,
        )
    ).mappings().all()
    return {
        "items": [_serialize_alert_event_row(dict(row)) for row in rows],
        "total": total,
        "limit": params["limit"],
        "offset": params["offset"],
    }


async def _collect_alert_input_metrics(*, db: AsyncSession, redis: Redis) -> dict[str, Any]:
    latest_quality = await _query_latest_quality_report(db)
    quality_summary = latest_quality.get("summary", {}) if isinstance(latest_quality, dict) else {}
    quality_risk_ratio = _to_float(quality_summary.get("active_without_valid_offers_ratio"))
    search_mismatch_ratio = _to_float(quality_summary.get("search_mismatch_ratio"))

    orders = await _load_orders_snapshot(redis)
    cancelled_orders = sum(1 for row in orders if str(row.get("status", "")).strip().lower() == "cancelled")
    total_orders = len(orders)
    cancel_rate = (float(cancelled_orders) / float(total_orders)) if total_orders > 0 else 0.0

    feedback_items = await _load_feedback_snapshot(redis)
    pending_total = sum(1 for item in feedback_items if str(item.get("status", "")).strip().lower() == "pending")

    operations = await _query_operations_metrics(db, since=datetime.now(UTC) - timedelta(hours=24))
    failed_task_rate_24h = _to_float(operations["summary"].get("failed_task_rate_24h"))

    return {
        "quality_risk_ratio": quality_risk_ratio,
        "search_mismatch_ratio": search_mismatch_ratio,
        "pending_total": pending_total,
        "cancel_rate": cancel_rate,
        "failed_task_rate_24h": failed_task_rate_24h,
    }


@router.get("/users", response_model=PaginatedOut)
async def list_users(
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    if _auth_reads_from_postgres():
        rows = (
            await db.execute(
                select(AuthUser).order_by(AuthUser.id.asc())
            )
        ).scalars().all()
        items = [_serialize_admin_user_from_pg(user) for user in rows]
        if q:
            q_norm = q.lower()
            items = [row for row in items if q_norm in f"{row['email']} {row['full_name']}".lower()]
        start = (page - 1) * limit
        return {"items": items[start : start + limit], "next_cursor": None, "request_id": "admin-users"}

    ids = sorted([key async for key in redis.scan_iter(match="auth:user:*")], key=lambda key: key)
    rows: list[dict[str, Any]] = []
    for key in ids:
        if key.count(":") != 2:
            continue
        key_type = await redis.type(key)
        if key_type != "hash":
            continue
        payload = await redis.hgetall(key)
        if not payload:
            continue
        user_uuid = await _ensure_user_uuid(redis, user_key=key, payload=payload)
        row = _serialize_admin_user_payload(user_uuid=user_uuid, payload=payload)
        if not row.get("created_at"):
            row["created_at"] = datetime.now(UTC).isoformat()
        if q and q.lower() not in f"{row['email']} {row['full_name']}".lower():
            continue
        rows.append(row)

    start = (page - 1) * limit
    items = rows[start : start + limit]
    return {"items": items, "next_cursor": None, "request_id": "admin-users"}


async def _get_user_by_uuid_or_404(redis: Redis, user_uuid: str) -> tuple[int, dict[str, str]]:
    normalized_uuid = _normalize_uuid_ref(user_uuid, field_name="user_id")
    async for key in redis.scan_iter(match="auth:user:*"):
        if key.count(":") != 2:
            continue
        if await redis.type(key) != "hash":
            continue
        payload = await redis.hgetall(key)
        if not payload:
            continue
        ensured_uuid = await _ensure_user_uuid(redis, user_key=key, payload=payload)
        if ensured_uuid.lower() == normalized_uuid:
            return int(payload["id"]), payload
    raise HTTPException(status_code=404, detail="user not found")


@router.get("/users/{user_id}")
async def get_user(
    user_id: str = Path(..., pattern=UUID_REF_PATTERN),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    if _auth_reads_from_postgres():
        normalized_uuid = _normalize_uuid_ref(user_id, field_name="user_id")
        user = (
            await db.execute(
                select(AuthUser).where(AuthUser.uuid == normalized_uuid).limit(1)
            )
        ).scalars().first()
        if user is None:
            raise HTTPException(status_code=404, detail="user not found")
        return _serialize_admin_user_from_pg(user)

    _, payload = await _get_user_by_uuid_or_404(redis, user_id)
    user_uuid = await _ensure_user_uuid(redis, user_key=f"auth:user:{payload['id']}", payload=payload)
    row = _serialize_admin_user_payload(user_uuid=user_uuid, payload=payload)
    if not row.get("created_at"):
        row["created_at"] = datetime.now(UTC).isoformat()
    return row


@router.patch("/users/{user_id}")
async def patch_user(
    request: Request,
    user_id: str = Path(..., pattern=UUID_REF_PATTERN),
    payload: dict[str, Any] | None = None,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        if _auth_reads_from_postgres():
            normalized_uuid = _normalize_uuid_ref(user_id, field_name="user_id")
            user = (
                await db.execute(
                    select(AuthUser).where(AuthUser.uuid == normalized_uuid).limit(1)
                )
            ).scalars().first()
            if user is None:
                raise HTTPException(status_code=404, detail="user not found")

            normalized_payload = payload or {}
            updates: dict[str, Any] = {}
            if "full_name" in normalized_payload:
                updates["full_name"] = str(normalized_payload["full_name"])
            if "role" in normalized_payload:
                next_role = str(normalized_payload["role"]).strip().lower().replace("-", "_")
                if next_role not in VALID_USER_ROLES:
                    raise HTTPException(status_code=422, detail="invalid role")
                updates["role"] = next_role
            if "is_active" in normalized_payload:
                updates["is_active"] = bool(normalized_payload["is_active"])
            if updates:
                await db.execute(
                    update(AuthUser)
                    .where(AuthUser.id == user.id)
                    .values(**updates, updated_at=datetime.now(UTC))
                )
                await _audit_admin_action(
                    db,
                    current_user=current_user,
                    request=request,
                    action="users.patch",
                    entity_type="user",
                    entity_id=str(user.uuid),
                    payload={"updates": sorted(updates.keys())},
                )
                await db.commit()
            return await get_user(user_id, redis, db)

        internal_user_id, _ = await _get_user_by_uuid_or_404(redis, user_id)
        key = f"auth:user:{internal_user_id}"
        updates: dict[str, str] = {}
        normalized_payload = payload or {}
        if "full_name" in normalized_payload:
            updates["full_name"] = str(normalized_payload["full_name"])
        if "role" in normalized_payload:
            next_role = str(normalized_payload["role"]).strip().lower().replace("-", "_")
            if next_role not in VALID_USER_ROLES:
                raise HTTPException(status_code=422, detail="invalid role")
            updates["role"] = next_role
        if "is_active" in normalized_payload:
            updates["is_active"] = "true" if bool(normalized_payload["is_active"]) else "false"
        if updates:
            await redis.hset(key, mapping=updates)
            await _audit_admin_action(
                db,
                current_user=current_user,
                request=request,
                action="users.patch",
                entity_type="user",
                entity_id=user_id,
                payload={"updates": sorted(updates.keys())},
            )
            await db.commit()
        return await get_user(user_id, redis, db)

    return await execute_idempotent_json(request, redis, scope=f"admin.users.patch:{user_id}", handler=_op)


@router.delete("/users/{user_id}")
async def delete_user(
    request: Request,
    user_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    async def _op():
        if _auth_reads_from_postgres():
            normalized_uuid = _normalize_uuid_ref(user_id, field_name="user_id")
            user = (
                await db.execute(
                    select(AuthUser).where(AuthUser.uuid == normalized_uuid).limit(1)
                )
            ).scalars().first()
            if user is None:
                raise HTTPException(status_code=404, detail="user not found")
            actor_uuid = str(user.uuid)
            await db.delete(user)
            await _audit_admin_action(
                db,
                current_user=current_user,
                request=request,
                action="users.delete",
                entity_type="user",
                entity_id=actor_uuid,
                payload={},
            )
            await db.commit()
            return {"ok": True}

        internal_user_id, payload = await _get_user_by_uuid_or_404(redis, user_id)
        key = f"auth:user:{internal_user_id}"
        email = payload.get("email")
        if email:
            await redis.delete(f"auth:user:email:{email}")
        await redis.delete(key)
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="users.delete",
            entity_type="user",
            entity_id=user_id,
            payload={},
        )
        await db.commit()
        return {"ok": True}

    return await execute_idempotent_json(request, redis, scope=f"admin.users.delete:{user_id}", handler=_op)


@router.get("/stores", response_model=PaginatedOut)
async def list_stores(
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    active_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    stmt = """
        select
            s.uuid as id,
            s.slug,
            s.name,
            s.provider,
            s.base_url,
            s.country_code,
            s.is_active,
            s.trust_score,
            s.crawl_priority,
            coalesce(ss.sources_count, 0) as sources_count
        from catalog_stores s
        left join (
            select store_id, count(*)::int as sources_count
            from catalog_scrape_sources
            group by store_id
        ) ss on ss.store_id = s.id
        where 1=1
    """
    params: dict[str, Any] = {"offset": (page - 1) * limit, "limit": limit}
    if q:
        stmt += " and (s.name ilike :like_q or s.slug ilike :like_q)"
        params["like_q"] = f"%{q}%"
    if active_only:
        stmt += " and s.is_active = true"
    stmt += """
        order by s.crawl_priority asc, s.name asc
        offset :offset
        limit :limit
    """
    rows = (
        await db.execute(
            text(stmt),
            params,
        )
    ).mappings().all()
    return {"items": [dict(row) for row in rows], "next_cursor": None, "request_id": "admin-stores"}


@router.post("/stores")
async def create_store(
    request: Request,
    payload: StoreCreate,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        slug = payload.slug or _slugify(payload.name)
        try:
            row = (
                await db.execute(
                    text(
                        """
                        insert into catalog_stores
                            (slug, name, provider, base_url, country_code, is_active, trust_score, crawl_priority)
                        values
                            (:slug, :name, :provider, :base_url, :country_code, :is_active, :trust_score, :crawl_priority)
                        returning
                            uuid as id, slug, name, provider, base_url, country_code, is_active, trust_score, crawl_priority
                        """
                    ),
                    {
                        "slug": slug,
                        "name": payload.name,
                        "provider": payload.provider.lower(),
                        "base_url": payload.base_url,
                        "country_code": payload.country_code.upper(),
                        "is_active": payload.is_active,
                        "trust_score": payload.trust_score,
                        "crawl_priority": payload.crawl_priority,
                    },
                )
            ).mappings().first()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=409, detail="store with same id/slug already exists")
        if not row:
            raise HTTPException(status_code=500, detail="failed to create store")
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="stores.create",
            entity_type="store",
            entity_id=str(row["id"]),
            payload={"slug": row["slug"], "provider": row["provider"]},
        )
        await db.commit()
        return {**dict(row), "sources_count": 0}

    return await execute_idempotent_json(request, redis, scope=f"admin.stores.create:{(payload.slug or _slugify(payload.name)).lower()}", handler=_op)


@router.patch("/stores/{store_id}")
async def patch_store(
    request: Request,
    store_id: str = Path(..., pattern=UUID_REF_PATTERN),
    payload: StorePatch = None,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        internal_store_id = await _resolve_store_id_or_404(db, store_id)
        await db.execute(
            text(
                """
                update catalog_stores
                set
                    name = coalesce(:name, name),
                    slug = coalesce(:slug, slug),
                    provider = coalesce(:provider, provider),
                    base_url = coalesce(:base_url, base_url),
                    country_code = coalesce(:country_code, country_code),
                    trust_score = coalesce(:trust_score, trust_score),
                    crawl_priority = coalesce(:crawl_priority, crawl_priority),
                    is_active = coalesce(:is_active, is_active),
                    updated_at = now()
                where id = :id
                """
            ),
            {
                "id": internal_store_id,
                "name": payload.name if payload else None,
                "slug": payload.slug if payload else None,
                "provider": payload.provider.lower() if payload and payload.provider else None,
                "base_url": payload.base_url if payload else None,
                "country_code": payload.country_code.upper() if payload and payload.country_code else None,
                "trust_score": payload.trust_score if payload else None,
                "crawl_priority": payload.crawl_priority if payload else None,
                "is_active": payload.is_active if payload else None,
            },
        )
        row = (
            await db.execute(
                text(
                    """
                    select
                        s.uuid as id, s.slug, s.name, s.provider, s.base_url, s.country_code, s.is_active, s.trust_score, s.crawl_priority,
                        coalesce(ss.sources_count, 0) as sources_count
                    from catalog_stores s
                    left join (
                        select store_id, count(*)::int as sources_count
                        from catalog_scrape_sources
                        group by store_id
                    ) ss on ss.store_id = s.id
                    where s.id = :id
                    """
                ),
                {"id": internal_store_id},
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="store not found")
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="stores.patch",
            entity_type="store",
            entity_id=str(row["id"]),
            payload={"updates": sorted((payload.model_dump(exclude_unset=True) if payload else {}).keys())},
        )
        await db.commit()
        return dict(row)

    return await execute_idempotent_json(request, redis, scope=f"admin.stores.patch:{store_id}", handler=_op)


@router.delete("/stores/{store_id}")
async def delete_store(
    request: Request,
    store_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    async def _op():
        internal_store_id = await _resolve_store_id_or_404(db, store_id)
        await db.execute(text("delete from catalog_stores where id = :id"), {"id": internal_store_id})
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="stores.delete",
            entity_type="store",
            entity_id=store_id,
            payload={},
        )
        await db.commit()
        return {"ok": True}

    return await execute_idempotent_json(request, redis, scope=f"admin.stores.delete:{store_id}", handler=_op)


@router.get("/stores/{store_id}/sources", response_model=PaginatedOut)
async def list_store_sources(
    store_id: str = Path(..., pattern=UUID_REF_PATTERN),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    internal_store_id = await _resolve_store_id_or_404(db, store_id)
    rows = (
        await db.execute(
            text(
                """
                select ss.uuid as id, s.uuid as store_id, ss.url, ss.source_type, ss.is_active, ss.priority, ss.created_at, ss.updated_at
                from catalog_scrape_sources ss
                join catalog_stores s on s.id = ss.store_id
                where ss.store_id = :store_id
                order by ss.priority asc, ss.id asc
                offset :offset
                limit :limit
                """
            ),
            {"store_id": internal_store_id, "offset": (page - 1) * limit, "limit": limit},
        )
    ).mappings().all()
    return {"items": [dict(row) for row in rows], "next_cursor": None, "request_id": "admin-store-sources"}


@router.post("/stores/{store_id}/sources")
async def create_store_source(
    request: Request,
    store_id: str = Path(..., pattern=UUID_REF_PATTERN),
    payload: ScrapeSourceCreate = None,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        internal_store_id = await _resolve_store_id_or_404(db, store_id)
        normalized_url, normalized_type = await _normalize_source_payload(
            db,
            store_id=internal_store_id,
            url_value=payload.url if payload else "",
            source_type=payload.source_type if payload else None,
        )
        row = (
            await db.execute(
                text(
                    """
                    insert into catalog_scrape_sources (store_id, url, source_type, is_active, priority)
                    values (:store_id, :url, :source_type, :is_active, :priority)
                    returning
                        uuid as id,
                        (select uuid from catalog_stores where id = store_id) as store_id,
                        url, source_type, is_active, priority, created_at, updated_at
                    """
                ),
                {
                    "store_id": internal_store_id,
                    "url": normalized_url,
                    "source_type": normalized_type,
                    "is_active": payload.is_active if payload else True,
                    "priority": payload.priority if payload else 100,
                },
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=500, detail="failed to create source")
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="store_sources.create",
            entity_type="store_source",
            entity_id=str(row["id"]),
            payload={"store_id": str(row["store_id"]), "source_type": str(row["source_type"])},
        )
        await db.commit()
        return dict(row)

    return await execute_idempotent_json(request, redis, scope=f"admin.store_sources.create:{store_id}", handler=_op)


@router.patch("/stores/{store_id}/sources/{source_id}")
async def patch_store_source(
    request: Request,
    store_id: str = Path(..., pattern=UUID_REF_PATTERN),
    source_id: str = Path(..., pattern=UUID_REF_PATTERN),
    payload: ScrapeSourcePatch = None,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        internal_store_id = await _resolve_store_id_or_404(db, store_id)
        internal_source_id = await _resolve_source_id_or_404(db, store_id=internal_store_id, source_ref=source_id)
        current = (
            await db.execute(
                text("select url, source_type from catalog_scrape_sources where id = :source_id and store_id = :store_id"),
                {"source_id": internal_source_id, "store_id": internal_store_id},
            )
        ).mappings().first()
        if not current:
            raise HTTPException(status_code=404, detail="source not found")
        normalized_url, normalized_type = await _normalize_source_payload(
            db,
            store_id=internal_store_id,
            url_value=payload.url if payload and payload.url is not None else current["url"],
            source_type=payload.source_type if payload and payload.source_type is not None else current["source_type"],
        )

        await db.execute(
            text(
                """
                update catalog_scrape_sources
                set
                    url = :url,
                    source_type = :source_type,
                    is_active = coalesce(:is_active, is_active),
                    priority = coalesce(:priority, priority),
                    updated_at = now()
                where id = :source_id and store_id = :store_id
                """
            ),
            {
                "source_id": internal_source_id,
                "store_id": internal_store_id,
                "url": normalized_url,
                "source_type": normalized_type,
                "is_active": payload.is_active if payload else None,
                "priority": payload.priority if payload else None,
            },
        )
        row = (
            await db.execute(
                text(
                    """
                    select ss.uuid as id, s.uuid as store_id, ss.url, ss.source_type, ss.is_active, ss.priority, ss.created_at, ss.updated_at
                    from catalog_scrape_sources ss
                    join catalog_stores s on s.id = ss.store_id
                    where ss.id = :source_id and ss.store_id = :store_id
                    """
                ),
                {"source_id": internal_source_id, "store_id": internal_store_id},
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="source not found")
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="store_sources.patch",
            entity_type="store_source",
            entity_id=str(row["id"]),
            payload={"updates": sorted((payload.model_dump(exclude_unset=True) if payload else {}).keys())},
        )
        await db.commit()
        return dict(row)

    return await execute_idempotent_json(request, redis, scope=f"admin.store_sources.patch:{store_id}:{source_id}", handler=_op)


@router.delete("/stores/{store_id}/sources/{source_id}")
async def delete_store_source(
    request: Request,
    store_id: str = Path(..., pattern=UUID_REF_PATTERN),
    source_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    async def _op():
        internal_store_id = await _resolve_store_id_or_404(db, store_id)
        internal_source_id = await _resolve_source_id_or_404(db, store_id=internal_store_id, source_ref=source_id)
        await db.execute(
            text("delete from catalog_scrape_sources where id = :source_id and store_id = :store_id"),
            {"source_id": internal_source_id, "store_id": internal_store_id},
        )
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="store_sources.delete",
            entity_type="store_source",
            entity_id=source_id,
            payload={"store_id": store_id},
        )
        await db.commit()
        return {"ok": True}

    return await execute_idempotent_json(request, redis, scope=f"admin.store_sources.delete:{store_id}:{source_id}", handler=_op)


@router.post("/categories")
async def create_category(
    request: Request,
    payload: CategoryCreate,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        resolved_parent_id: int | None = None
        if payload.parent_id is not None:
            resolved_parent_id = await _resolve_category_id_or_404(db, payload.parent_id)

        inserted = (
            await db.execute(
                text(
                    """
                    insert into catalog_categories (slug, name_uz, parent_id, lft, rgt, is_active)
                    values (:slug, :name, :parent_id, 0, 0, true)
                    returning
                        uuid as id,
                        slug,
                        name_uz,
                        (select uuid from catalog_categories where id = parent_id) as parent_id,
                        is_active
                    """
                ),
                {"slug": payload.slug, "name": payload.name, "parent_id": resolved_parent_id},
            )
        ).mappings().first()
        if not inserted:
            raise HTTPException(status_code=500, detail="failed to create category")
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="categories.create",
            entity_type="category",
            entity_id=str(inserted["id"]),
            payload={"slug": inserted["slug"], "parent_id": inserted["parent_id"]},
        )
        await db.commit()
        return {
            "id": inserted["id"],
            "slug": inserted["slug"],
            "name": inserted["name_uz"],
            "parent_id": inserted["parent_id"],
            "is_active": inserted["is_active"],
        }

    return await execute_idempotent_json(request, redis, scope=f"admin.categories.create:{payload.slug.lower()}", handler=_op)


@router.patch("/categories/{category_id}")
async def patch_category(
    request: Request,
    category_id: str = Path(..., pattern=UUID_REF_PATTERN),
    payload: CategoryPatch = Body(...),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        internal_category_id = await _resolve_category_id_or_404(db, category_id)
        patch_payload = payload.model_dump(exclude_unset=True)

        parent_ref_marker = object()
        parent_ref = patch_payload.pop("parent_id", parent_ref_marker)
        set_parent = parent_ref is not parent_ref_marker
        resolved_parent_id: int | None
        if set_parent:
            if parent_ref is None:
                resolved_parent_id = None
            else:
                resolved_parent_id = await _resolve_category_id_or_404(db, str(parent_ref))
        else:
            resolved_parent_id = None

        await db.execute(
            text(
                """
                update catalog_categories
                set slug = coalesce(:slug, slug),
                    name_uz = coalesce(:name_uz, name_uz),
                    parent_id = case when :set_parent then :parent_id else parent_id end,
                    updated_at = now()
                where id = :id
                """
            ),
            {
                "id": internal_category_id,
                "slug": patch_payload.get("slug"),
                "name_uz": patch_payload.get("name"),
                "set_parent": set_parent,
                "parent_id": resolved_parent_id,
            },
        )
        row = (
            await db.execute(
                text(
                    """
                    select
                        c.uuid as id,
                        c.slug,
                        c.name_uz,
                        p.uuid as parent_id,
                        c.is_active
                    from catalog_categories c
                    left join catalog_categories p on p.id = c.parent_id
                    where c.id = :id
                    """
                ),
                {"id": internal_category_id},
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="category not found")
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="categories.patch",
            entity_type="category",
            entity_id=str(row["id"]),
            payload={"updates": sorted(payload.model_dump(exclude_unset=True).keys())},
        )
        await db.commit()
        return {"id": row["id"], "slug": row["slug"], "name": row["name_uz"], "parent_id": row["parent_id"], "is_active": row["is_active"]}

    return await execute_idempotent_json(request, redis, scope=f"admin.categories.patch:{category_id}", handler=_op)


@router.delete("/categories/{category_id}")
async def delete_category(
    request: Request,
    category_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    async def _op():
        internal_category_id = await _resolve_category_id_or_404(db, category_id)
        await db.execute(text("delete from catalog_categories where id = :id"), {"id": internal_category_id})
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="categories.delete",
            entity_type="category",
            entity_id=category_id,
            payload={},
        )
        await db.commit()
        return {"ok": True}

    return await execute_idempotent_json(request, redis, scope=f"admin.categories.delete:{category_id}", handler=_op)


@router.patch("/products/{product_id}")
async def patch_product(
    request: Request,
    product_id: str,
    payload: dict[str, Any],
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        resolved_product_id = await _resolve_product_id_or_404(db, product_id)
        await db.execute(
            text(
                """
                update catalog_canonical_products
                set normalized_title = coalesce(:title, normalized_title),
                    main_image = coalesce(:main_image, main_image),
                    specs = coalesce(cast(:specs as jsonb), specs),
                    updated_at = now()
                where id = :id
                """
            ),
            {
                "id": resolved_product_id,
                "title": payload.get("normalized_title"),
                "main_image": payload.get("main_image"),
                "specs": payload.get("specs"),
            },
        )
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="products.patch",
            entity_type="product",
            entity_id=product_id,
            payload={"updates": sorted(payload.keys())},
        )
        await db.commit()
        return {"ok": True}

    return await execute_idempotent_json(request, redis, scope=f"admin.products.patch:{product_id}", handler=_op)


@router.delete("/products/{product_id}")
async def delete_product(
    request: Request,
    product_id: str,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, bool]:
    resolved_product_id = await _resolve_product_id_or_404(db, product_id)
    await db.execute(text("delete from catalog_canonical_products where id = :id"), {"id": resolved_product_id})
    await _audit_admin_action(
        db,
        current_user=current_user,
        request=request,
        action="products.delete",
        entity_type="product",
        entity_id=product_id,
        payload={},
    )
    await db.commit()
    await _invalidate_product_caches(redis)
    return {"ok": True}


@router.post("/products/bulk-delete")
async def bulk_delete_products(
    request: Request,
    payload: ProductsBulkDeleteIn,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    async def _op():
        resolved_set: set[int] = set()
        for item in payload.product_ids:
            resolved = await _resolve_product_id_or_404(db, item)
            if resolved > 0:
                resolved_set.add(resolved)
        product_ids = sorted(resolved_set)
        if not product_ids:
            raise HTTPException(status_code=422, detail="product_ids must contain at least one valid product reference")

        deleted_count = (
            await db.execute(
                text("delete from catalog_canonical_products where id = any(cast(:product_ids as bigint[]))"),
                {"product_ids": product_ids},
            )
        ).rowcount or 0
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="products.bulk_delete",
            entity_type="product",
            entity_id=None,
            payload={"requested": len(product_ids), "deleted": int(deleted_count)},
        )
        await db.commit()
        await _invalidate_product_caches(redis)
        return {"ok": True, "requested": len(product_ids), "deleted": int(deleted_count)}

    return await execute_idempotent_json(request, redis, scope="admin.products.bulk_delete", handler=_op)


@router.post("/products/import")
async def import_products(
    request: Request,
    payload: ProductsImportIn,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    async def _op():
        rows = _parse_import_rows(payload)
        if not rows:
            raise HTTPException(status_code=422, detail="import payload has no rows")

        default_store_id = await _resolve_default_store_id(db, payload.store_id)
        default_category_id = await _resolve_default_category_id(db)
        id_cache: dict[int, int] = {default_store_id: default_store_id}
        slug_cache: dict[str, int] = {}
        name_cache: dict[str, int] = {}

        imported_rows = 0
        skipped_rows = 0
        errors: list[str] = []

        for index, row in enumerate(rows, start=1):
            try:
                async with db.begin_nested():
                    imported = await _ingest_import_row(
                        db,
                        row,
                        default_category_id=default_category_id,
                        default_store_id=default_store_id,
                        id_cache=id_cache,
                        slug_cache=slug_cache,
                        name_cache=name_cache,
                    )
                if imported:
                    imported_rows += 1
                else:
                    skipped_rows += 1
                    errors.append(f"row {index}: skipped because required fields are missing")
            except Exception as exc:  # noqa: BLE001
                skipped_rows += 1
                errors.append(f"row {index}: {exc}")

        if imported_rows == 0:
            await db.rollback()
            raise HTTPException(status_code=422, detail="no valid rows were imported")

        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="products.import",
            entity_type="product_import",
            entity_id=None,
            payload={"source": payload.source, "received_rows": len(rows), "imported_rows": imported_rows, "skipped_rows": skipped_rows},
        )
        await db.commit()
        await _invalidate_product_caches(redis)
        task_id = enqueue_ingested_products_pipeline()
        response: dict[str, Any] = {
            "ok": True,
            "source": payload.source,
            "received_rows": len(rows),
            "imported_rows": imported_rows,
            "skipped_rows": skipped_rows,
            "task_id": task_id,
        }
        if errors:
            response["errors"] = errors[:20]
        return response

    return await execute_idempotent_json(request, redis, scope="admin.products.import", handler=_op)


@router.get("/products/export")
async def export_products(
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    limit: int = Query(default=10000, ge=1, le=100000),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    rows = await _fetch_export_rows(db, limit=limit)
    exported_at = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")

    if format == "json":
        payload = json.dumps(rows, ensure_ascii=False, default=str, indent=2)
        return Response(
            content=payload,
            media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="products_{exported_at}.json"'},
        )

    fieldnames = [
        "offer_id",
        "scraped_at",
        "price_amount",
        "old_price_amount",
        "in_stock",
        "external_url",
        "product_id",
        "normalized_title",
        "store_id",
        "store_name",
    ]
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, delimiter=";")
    writer.writeheader()
    writer.writerows(rows)
    csv_payload = "\ufeff" + buffer.getvalue()
    return Response(
        content=csv_payload,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="products_{exported_at}.csv"'},
    )


@router.get("/orders", response_model=PaginatedOut)
async def list_orders(
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=30, ge=1, le=100),
    status: str | None = Query(default=None),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    key = "admin:orders"
    if await redis.llen(key) == 0:
        user_ids: list[str] = []
        async for user_key in redis.scan_iter(match="auth:user:*"):
            if user_key.count(":") != 2:
                continue
            if await redis.type(user_key) != "hash":
                continue
            payload = await redis.hgetall(user_key)
            if not payload:
                continue
            user_ids.append(await _ensure_user_uuid(redis, user_key=user_key, payload=payload))
            if len(user_ids) >= 2:
                break
        while len(user_ids) < 2:
            user_ids.append(str(uuid4()))

        seed = [
            {
                "id": str(uuid4()),
                "user_id": user_ids[0],
                "total_amount": 12500000,
                "currency": "UZS",
                "status": "new",
                "created_at": datetime.now(UTC).isoformat(),
            },
            {
                "id": str(uuid4()),
                "user_id": user_ids[1],
                "total_amount": 8990000,
                "currency": "UZS",
                "status": "processing",
                "created_at": datetime.now(UTC).isoformat(),
            },
        ]
        for row in seed:
            await redis.rpush(key, json.dumps(row, ensure_ascii=False))
    raw_rows = await redis.lrange(key, 0, -1)
    rows: list[dict[str, Any]] = []
    for raw in raw_rows:
        row = json.loads(raw)
        if status and row.get("status") != status:
            continue
        if q and q.lower() not in str(row.get("id")):
            continue
        rows.append(row)
    start = (page - 1) * limit
    return {"items": rows[start : start + limit], "next_cursor": None, "request_id": "admin-orders"}


@router.get("/orders/{order_id}")
async def get_order(order_id: str = Path(..., pattern=UUID_REF_PATTERN), redis: Redis = Depends(get_redis)) -> dict[str, Any]:
    normalized_order_id = _normalize_uuid_ref(order_id, field_name="order_id")
    rows = await list_orders(page=1, limit=500, redis=redis)
    for row in rows["items"]:
        if str(row.get("id", "")).lower() == normalized_order_id:
            return row
    raise HTTPException(status_code=404, detail="order not found")


@router.patch("/orders/{order_id}")
async def patch_order(
    request: Request,
    order_id: str = Path(..., pattern=UUID_REF_PATTERN),
    payload: OrderStatusPatch = Body(...),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        normalized_order_id = _normalize_uuid_ref(order_id, field_name="order_id")
        key = "admin:orders"
        raw_rows = await redis.lrange(key, 0, -1)
        next_rows: list[str] = []
        target: dict[str, Any] | None = None
        for raw in raw_rows:
            row = json.loads(raw)
            if str(row.get("id", "")).lower() == normalized_order_id:
                row["status"] = payload.status
                target = row
            next_rows.append(json.dumps(row, ensure_ascii=False))
        if target is None:
            raise HTTPException(status_code=404, detail="order not found")
        await redis.delete(key)
        if next_rows:
            await redis.rpush(key, *next_rows)
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="orders.patch",
            entity_type="order",
            entity_id=normalized_order_id,
            payload={"status": payload.status},
        )
        await db.commit()
        return target

    return await execute_idempotent_json(request, redis, scope=f"admin.orders.patch:{order_id}", handler=_op)


@router.get("/analytics")
async def analytics(period: str = Query(default="30d"), db: AsyncSession = Depends(get_db_session), redis: Redis = Depends(get_redis)) -> dict[str, Any]:
    users_count = 0
    async for key in redis.scan_iter(match="auth:user:*"):
        if key.count(":") == 2 and await redis.type(key) == "hash":
            users_count += 1
    products_count = (await db.execute(text("select count(*) as c from catalog_canonical_products"))).scalar_one()
    orders = await list_orders(page=1, limit=500, redis=redis)
    orders_count = len(orders["items"])
    revenue = sum(float(row.get("total_amount", 0)) for row in orders["items"])
    quality_row = (
        await db.execute(
            text(
                """
                select
                    uuid as id,
                    status,
                    summary,
                    checks,
                    created_at
                from catalog_data_quality_reports
                order by created_at desc, id desc
                limit 1
                """
            )
        )
    ).mappings().first()
    quality_report = _serialize_quality_report_row(dict(quality_row)) if quality_row else None
    return {
        "total_users": users_count,
        "total_orders": orders_count,
        "total_products": int(products_count),
        "revenue": revenue,
        "trend": [{"label": f"D{i}", "value": int(revenue / max(i, 1) / 100000)} for i in range(1, 8)],
        "quality_report": quality_report,
        "recent_activity": [
            {"id": secrets.token_hex(4), "title": "Daily sync completed", "timestamp": datetime.now(UTC).isoformat()},
            {"id": secrets.token_hex(4), "title": f"Period: {period}", "timestamp": datetime.now(UTC).isoformat()},
        ],
    }


@router.get("/analytics/overview")
async def analytics_overview(
    period: str = Query(default="30d"),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    days = _period_to_days(period)
    cache_key = _admin_analytics_cache_key("overview", {"period": period})
    cached = await _get_cached_admin_analytics(redis, cache_key)
    if cached is not None:
        return cached

    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    orders = await _load_orders_snapshot(redis)
    period_orders = [row for row in orders if (_parse_iso_datetime(row.get("created_at")) or now) >= since]
    orders_count = len(period_orders)
    revenue = sum(_to_float(row.get("total_amount")) for row in period_orders)
    aov = (revenue / orders_count) if orders_count > 0 else 0.0

    revenue_series_raw = _build_revenue_series(period_orders, range_start=since, range_end=now, granularity="day")
    quality_series = await _query_quality_series(db, since=since)
    if not quality_series:
        quality_series = [
            {
                "ts": _series_ts(point),
                "active_without_valid_offers_ratio": 0.0,
                "search_mismatch_ratio": 0.0,
                "low_quality_image_ratio": 0.0,
            }
            for point in _init_series(since, now, "day")
        ]

    feedback_items = await _load_feedback_snapshot(redis)
    moderation_pending = sum(1 for item in feedback_items if str(item.get("status", "")).strip().lower() == "pending")
    moderation_series = _build_moderation_series(feedback_items, range_start=since, range_end=now, granularity="day")

    active_products = _to_int(
        (
            await db.execute(
                text("select count(*)::int as c from catalog_canonical_products where is_active = true")
            )
        ).scalar_one()
    )

    alert_inputs = await _collect_alert_input_metrics(db=db, redis=redis)
    if settings.admin_alerts_enabled:
        await _evaluate_and_store_alert_events(db=db, redis=redis, **alert_inputs)
    alerts_preview = (await _query_alert_events(db=db, status="open", limit=5, offset=0)).get("items", [])

    payload = {
        "period": period,
        "range": {"from": since.isoformat(), "to": now.isoformat(), "days": days},
        "kpis": {
            "revenue": revenue,
            "orders": orders_count,
            "aov": aov,
            "active_products": active_products,
            "quality_risk_ratio": _to_float(alert_inputs["quality_risk_ratio"]),
            "moderation_pending": moderation_pending,
        },
        "revenue_series": [{"ts": row["ts"], "value": _to_float(row["revenue"])} for row in revenue_series_raw],
        "orders_by_status": _build_orders_status_counts(period_orders),
        "quality_series": quality_series,
        "moderation_series": moderation_series,
        "alerts_preview": alerts_preview,
        "generated_at": now.isoformat(),
    }
    await _set_cached_admin_analytics(redis, cache_key, payload, ttl_seconds=60)
    return payload


@router.get("/analytics/revenue")
async def analytics_revenue(
    period: str = Query(default="30d"),
    granularity: str = Query(default="day"),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    days = _period_to_days(period)
    normalized_granularity = _normalize_granularity(granularity)
    cache_key = _admin_analytics_cache_key(
        "revenue",
        {"period": period, "granularity": normalized_granularity},
    )
    cached = await _get_cached_admin_analytics(redis, cache_key)
    if cached is not None:
        return cached

    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    orders = await _load_orders_snapshot(redis)
    period_orders = [row for row in orders if (_parse_iso_datetime(row.get("created_at")) or now) >= since]
    total_orders = len(period_orders)
    revenue = sum(_to_float(row.get("total_amount")) for row in period_orders)
    cancelled_orders = sum(1 for row in period_orders if str(row.get("status", "")).strip().lower() == "cancelled")
    cancel_rate = (float(cancelled_orders) / float(total_orders)) if total_orders > 0 else 0.0

    payload = {
        "period": period,
        "granularity": normalized_granularity,
        "range": {"from": since.isoformat(), "to": now.isoformat(), "days": days},
        "summary": {
            "revenue": revenue,
            "orders": total_orders,
            "aov": (revenue / total_orders) if total_orders > 0 else 0.0,
            "cancel_rate": cancel_rate,
            "cancelled_orders": cancelled_orders,
        },
        "series": _build_revenue_series(
            period_orders,
            range_start=since,
            range_end=now,
            granularity=normalized_granularity,
        ),
        "orders_by_status": _build_orders_status_counts(period_orders),
        "top_stores": await _query_top_revenue_entities(db, since=since, dimension="store"),
        "top_categories": await _query_top_revenue_entities(db, since=since, dimension="category"),
        "top_brands": await _query_top_revenue_entities(db, since=since, dimension="brand"),
        "generated_at": now.isoformat(),
    }
    await _set_cached_admin_analytics(redis, cache_key, payload, ttl_seconds=60)
    return payload


@router.get("/analytics/catalog-quality")
async def analytics_catalog_quality(
    period: str = Query(default="30d"),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    days = _period_to_days(period)
    cache_key = _admin_analytics_cache_key("catalog-quality", {"period": period})
    cached = await _get_cached_admin_analytics(redis, cache_key)
    if cached is not None:
        return cached

    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    latest_report = await _query_latest_quality_report(db)
    summary = latest_report.get("summary", {}) if isinstance(latest_report, dict) else {}
    timeline = await _query_quality_series(db, since=since)
    no_offer_breakdown = await _query_quality_no_offer_breakdown(db, limit=8)
    no_offer_items = (
        await list_quality_products_without_valid_offers(limit=6, offset=0, active_only=True, db=db)
    ).get("items", [])

    payload = {
        "period": period,
        "range": {"from": since.isoformat(), "to": now.isoformat(), "days": days},
        "latest_report": latest_report,
        "summary": {
            "active_without_valid_offers_ratio": _to_float(summary.get("active_without_valid_offers_ratio")),
            "search_mismatch_ratio": _to_float(summary.get("search_mismatch_ratio")),
            "stale_offer_ratio": _to_float(summary.get("stale_offer_ratio")),
            "low_quality_image_ratio": _to_float(summary.get("low_quality_image_ratio")),
            "active_without_valid_offers": _to_int(summary.get("active_without_valid_offers")),
            "search_mismatch_products": _to_int(summary.get("search_mismatch_products")),
            "stale_valid_offers": _to_int(summary.get("stale_valid_offers")),
            "low_quality_main_image_products": _to_int(summary.get("low_quality_main_image_products")),
        },
        "timeline": timeline,
        "no_valid_offer_breakdown": no_offer_breakdown,
        "problem_products": no_offer_items,
        "generated_at": now.isoformat(),
    }
    await _set_cached_admin_analytics(redis, cache_key, payload, ttl_seconds=60)
    return payload


@router.get("/analytics/operations")
async def analytics_operations(
    period: str = Query(default="30d"),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    days = _period_to_days(period)
    cache_key = _admin_analytics_cache_key("operations", {"period": period})
    cached = await _get_cached_admin_analytics(redis, cache_key)
    if cached is not None:
        return cached

    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    metrics = await _query_operations_metrics(db, since=since)
    latest_quality = await _query_latest_quality_report(db)

    payload = {
        "period": period,
        "range": {"from": since.isoformat(), "to": now.isoformat(), "days": days},
        "summary": metrics.get("summary", {}),
        "status_breakdown": metrics.get("status_breakdown", []),
        "duration_series": metrics.get("duration_series", []),
        "latest_quality_status": latest_quality.get("status") if isinstance(latest_quality, dict) else None,
        "pipeline_actions": [
            {"task": "scrape", "label": "Run scrape"},
            {"task": "embedding", "label": "Rebuild embeddings"},
            {"task": "dedupe", "label": "Run dedupe"},
            {"task": "reindex", "label": "Reindex search"},
            {"task": "quality", "label": "Run quality check"},
            {"task": "catalog", "label": "Run catalog rebuild"},
        ],
        "generated_at": now.isoformat(),
    }
    await _set_cached_admin_analytics(redis, cache_key, payload, ttl_seconds=60)
    return payload


@router.get("/analytics/moderation")
async def analytics_moderation(
    period: str = Query(default="30d"),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    _ = db
    days = _period_to_days(period)
    cache_key = _admin_analytics_cache_key("moderation", {"period": period})
    cached = await _get_cached_admin_analytics(redis, cache_key)
    if cached is not None:
        return cached

    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    items = await _load_feedback_snapshot(redis)
    status_counts = {"published": 0, "pending": 0, "rejected": 0}
    kind_counts = {"review": 0, "question": 0}
    durations: list[float] = []
    throughput_24h = 0
    limit_24h = now - timedelta(hours=24)

    for item in items:
        kind = str(item.get("kind", "review")).strip().lower()
        if kind in kind_counts:
            kind_counts[kind] += 1
        status = str(item.get("status", "pending")).strip().lower()
        if status in status_counts:
            status_counts[status] += 1
        updated_at = _parse_iso_datetime(item.get("updated_at"))
        if updated_at and updated_at >= limit_24h and status in {"published", "rejected"}:
            throughput_24h += 1
        created_at = _parse_iso_datetime(item.get("created_at"))
        moderated_at = _parse_iso_datetime(item.get("moderated_at"))
        if created_at and moderated_at and moderated_at >= created_at:
            durations.append((moderated_at - created_at).total_seconds() / 60.0)

    publish_reject_ratio = (
        float(status_counts["published"]) / float(status_counts["rejected"])
        if status_counts["rejected"] > 0
        else float(status_counts["published"])
    )

    payload = {
        "period": period,
        "range": {"from": since.isoformat(), "to": now.isoformat(), "days": days},
        "summary": {
            "total": len(items),
            "pending": status_counts["pending"],
            "published": status_counts["published"],
            "rejected": status_counts["rejected"],
            "throughput_24h": throughput_24h,
            "median_moderation_minutes": _median(durations),
            "publish_reject_ratio": publish_reject_ratio,
        },
        "kind_counts": kind_counts,
        "status_counts": status_counts,
        "series": _build_moderation_series(items, range_start=since, range_end=now, granularity="day"),
        "generated_at": now.isoformat(),
    }
    await _set_cached_admin_analytics(redis, cache_key, payload, ttl_seconds=60)
    return payload


@router.get("/analytics/users")
async def analytics_users(
    period: str = Query(default="30d"),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    days = _period_to_days(period)
    cache_key = _admin_analytics_cache_key("users", {"period": period})
    cached = await _get_cached_admin_analytics(redis, cache_key)
    if cached is not None:
        return cached

    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    users = await _load_users_snapshot(redis, db)

    new_users = 0
    active_users_30d = 0
    role_counts: dict[str, int] = defaultdict(int)
    activity_points = _init_series(since, now, "day")
    activity_buckets: dict[str, int] = {_series_ts(point): 0 for point in activity_points}
    activity_cutoff = now - timedelta(days=30)

    for user in users:
        role = str(user.get("role", "user")).strip().lower() or "user"
        role_counts[role] += 1
        created_at = _parse_iso_datetime(user.get("created_at"))
        if created_at and created_at >= since:
            new_users += 1
        last_seen_at = _parse_iso_datetime(user.get("last_seen_at"))
        if last_seen_at and last_seen_at >= activity_cutoff:
            active_users_30d += 1
        if last_seen_at and last_seen_at >= since:
            ts = _series_ts(_bucket_start(last_seen_at, "day"))
            activity_buckets[ts] = activity_buckets.get(ts, 0) + 1

    payload = {
        "period": period,
        "range": {"from": since.isoformat(), "to": now.isoformat(), "days": days},
        "summary": {
            "total_users": len(users),
            "new_users": new_users,
            "active_users_30d": active_users_30d,
            "inactive_users_30d": max(len(users) - active_users_30d, 0),
        },
        "role_distribution": [{"role": role, "count": count} for role, count in sorted(role_counts.items(), key=lambda item: item[0])],
        "created_series": _build_user_series(users, range_start=since, range_end=now, granularity="day"),
        "activity_series": [{"ts": ts, "value": count} for ts, count in sorted(activity_buckets.items(), key=lambda item: item[0])],
        "generated_at": now.isoformat(),
    }
    await _set_cached_admin_analytics(redis, cache_key, payload, ttl_seconds=60)
    return payload


@router.get("/analytics/alerts")
async def analytics_alerts(
    status: str = Query(default="open", pattern="^(open|ack|resolved)$"),
    severity: str | None = Query(default=None, pattern="^(info|warning|critical)$"),
    source: str | None = Query(default=None, pattern="^(revenue|catalog_quality|operations|moderation|users)$"),
    code: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    refresh: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    cache_key = _admin_analytics_cache_key(
        "alerts",
        {
            "status": status,
            "severity": severity,
            "source": source,
            "code": code,
            "limit": limit,
            "offset": offset,
            "refresh": refresh,
        },
    )
    cached = await _get_cached_admin_analytics(redis, cache_key)
    if cached is not None:
        return cached

    changes = {"opened": 0, "updated": 0, "resolved": 0}
    if refresh and settings.admin_alerts_enabled:
        inputs = await _collect_alert_input_metrics(db=db, redis=redis)
        changes = await _evaluate_and_store_alert_events(db=db, redis=redis, **inputs)

    result = await _query_alert_events(
        db=db,
        status=status,
        severity=severity,
        source=source,
        code=code,
        limit=limit,
        offset=offset,
    )
    payload = {
        **result,
        "changes": changes,
        "generated_at": datetime.now(UTC).isoformat(),
    }
    await _set_cached_admin_analytics(redis, cache_key, payload, ttl_seconds=60)
    return payload


@router.get("/audit/events")
async def list_admin_audit_events(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    actor_user_id: str | None = Query(default=None, pattern=UUID_REF_PATTERN),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    where_parts = ["1=1"]
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if action:
        where_parts.append("action = :action")
        params["action"] = action
    if entity_type:
        where_parts.append("entity_type = :entity_type")
        params["entity_type"] = entity_type
    if actor_user_id:
        where_parts.append("actor_user_uuid = cast(:actor_user_uuid as uuid)")
        params["actor_user_uuid"] = _normalize_uuid_ref(actor_user_id, field_name="actor_user_id")

    where_sql = " and ".join(where_parts)
    total = int(
        (
            await db.execute(
                text(f"select count(*)::int from admin_audit_events where {where_sql}"),
                params,
            )
        ).scalar_one()
        or 0
    )
    rows = (
        await db.execute(
            text(
                f"""
                select
                    uuid as id,
                    cast(actor_user_uuid as text) as actor_user_uuid,
                    actor_role,
                    action,
                    entity_type,
                    entity_id,
                    request_id,
                    method,
                    path,
                    ip_address,
                    user_agent,
                    payload,
                    created_at
                from admin_audit_events
                where {where_sql}
                order by created_at desc, id desc
                limit :limit
                offset :offset
                """
            ),
            params,
        )
    ).mappings().all()
    return {
        "items": [_serialize_admin_audit_row(dict(row)) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.patch("/analytics/alerts/{alert_id}/ack")
async def acknowledge_alert_event(
    request: Request,
    alert_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    async def _op():
        normalized = _normalize_uuid_ref(alert_id, field_name="alert_id")
        row = (
            await db.execute(
                text(
                    """
                    update admin_alert_events
                    set status = 'ack',
                        acknowledged_at = now(),
                        updated_at = now()
                    where uuid = cast(:uuid as uuid)
                    returning
                        uuid as id,
                        code,
                        title,
                        source,
                        severity,
                        status,
                        metric_value,
                        threshold_value,
                        context,
                        created_at,
                        acknowledged_at,
                        resolved_at
                    """
                ),
                {"uuid": normalized},
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="alert event not found")
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="alerts.ack",
            entity_type="alert_event",
            entity_id=normalized,
            payload={"status": "ack"},
        )
        await db.commit()
        await _invalidate_admin_analytics_cache(redis)
        return _serialize_alert_event_row(dict(row))

    return await execute_idempotent_json(request, redis, scope=f"admin.analytics.alerts.ack:{alert_id.lower()}", handler=_op)


@router.patch("/analytics/alerts/{alert_id}/resolve")
async def resolve_alert_event(
    request: Request,
    alert_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    async def _op():
        normalized = _normalize_uuid_ref(alert_id, field_name="alert_id")
        row = (
            await db.execute(
                text(
                    """
                    update admin_alert_events
                    set status = 'resolved',
                        resolved_at = now(),
                        updated_at = now()
                    where uuid = cast(:uuid as uuid)
                    returning
                        uuid as id,
                        code,
                        title,
                        source,
                        severity,
                        status,
                        metric_value,
                        threshold_value,
                        context,
                        created_at,
                        acknowledged_at,
                        resolved_at
                    """
                ),
                {"uuid": normalized},
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="alert event not found")
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="alerts.resolve",
            entity_type="alert_event",
            entity_id=normalized,
            payload={"status": "resolved"},
        )
        await db.commit()
        await _invalidate_admin_analytics_cache(redis)
        return _serialize_alert_event_row(dict(row))

    return await execute_idempotent_json(request, redis, scope=f"admin.analytics.alerts.resolve:{alert_id.lower()}", handler=_op)


@router.post("/analytics/alerts/evaluate")
async def enqueue_alert_evaluation(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        task_id = enqueue_admin_alert_evaluation()
        await _invalidate_admin_analytics_cache(redis)
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="alerts.evaluate.enqueue",
            entity_type="task",
            entity_id=task_id,
            payload={"queued": "maintenance"},
        )
        await db.commit()
        return {"task_id": task_id, "queued": "maintenance"}

    return await execute_idempotent_json(request, redis, scope="admin.analytics.alerts.evaluate", handler=_op)


@router.get("/settings")
async def get_settings(redis: Redis = Depends(get_redis)) -> dict[str, Any]:
    key = "admin:settings"
    payload = await redis.hgetall(key)
    if not payload:
        payload = {
            "site_name": "ZincMarket",
            "support_email": "support@zinc.local",
            "branding_logo_url": "",
            "feature_ai_enabled": "true",
        }
        await redis.hset(key, mapping=payload)
    return {
        "site_name": payload.get("site_name", "ZincMarket"),
        "support_email": payload.get("support_email", "support@zinc.local"),
        "branding_logo_url": payload.get("branding_logo_url") or None,
        "feature_ai_enabled": payload.get("feature_ai_enabled", "true") == "true",
        "api_keys": [{"id": "default", "name": "OpenAI", "masked_value": "sk-***"}],
    }


@router.patch("/settings")
async def patch_settings(
    request: Request,
    payload: SettingsPatch,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    async def _op():
        key = "admin:settings"
        updates: dict[str, str] = {}
        if payload.site_name is not None:
            updates["site_name"] = payload.site_name
        if payload.support_email is not None:
            updates["support_email"] = payload.support_email
        if payload.branding_logo_url is not None:
            updates["branding_logo_url"] = payload.branding_logo_url
        if payload.feature_ai_enabled is not None:
            updates["feature_ai_enabled"] = "true" if payload.feature_ai_enabled else "false"
        if updates:
            await redis.hset(key, mapping=updates)
            await _audit_admin_action(
                db,
                current_user=current_user,
                request=request,
                action="settings.patch",
                entity_type="settings",
                entity_id="admin:settings",
                payload={"updates": sorted(updates.keys())},
            )
            await db.commit()
        return await get_settings(redis)

    return await execute_idempotent_json(request, redis, scope="admin.settings.patch", handler=_op)


@router.post("/reindex/products")
async def reindex_products(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    async def _op():
        task_id = enqueue_reindex_batches()
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="tasks.reindex.enqueue",
            entity_type="task",
            entity_id=task_id,
            payload={"queued": "reindex"},
        )
        await db.commit()
        return {"task_id": task_id, "queued": "reindex"}

    return await execute_idempotent_json(request, redis, scope="admin.tasks.reindex.enqueue", handler=_op)


@router.post("/embeddings/rebuild")
async def rebuild_embeddings(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    async def _op():
        task_id = enqueue_embedding_batches()
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="tasks.embedding.enqueue",
            entity_type="task",
            entity_id=task_id,
            payload={"queued": "embedding"},
        )
        await db.commit()
        return {"task_id": task_id, "queued": "embedding"}

    return await execute_idempotent_json(request, redis, scope="admin.tasks.embedding.enqueue", handler=_op)


@router.post("/dedupe/run")
async def run_dedupe(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    async def _op():
        task_id = enqueue_dedupe_batches()
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="tasks.dedupe.enqueue",
            entity_type="task",
            entity_id=task_id,
            payload={"queued": "dedupe"},
        )
        await db.commit()
        return {"task_id": task_id, "queued": "dedupe"}

    return await execute_idempotent_json(request, redis, scope="admin.tasks.dedupe.enqueue", handler=_op)


@router.post("/scrape/run")
async def run_scrape(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    async def _op():
        task_id = enqueue_full_crawl()
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="tasks.scrape.enqueue",
            entity_type="task",
            entity_id=task_id,
            payload={"queued": "scrape"},
        )
        await db.commit()
        return {"task_id": task_id, "queued": "scrape"}

    return await execute_idempotent_json(request, redis, scope="admin.tasks.scrape.enqueue", handler=_op)


@router.post("/catalog/rebuild")
async def run_catalog_rebuild(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    async def _op():
        task_id = enqueue_full_catalog_rebuild()
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="tasks.catalog_rebuild.enqueue",
            entity_type="task",
            entity_id=task_id,
            payload={"queued": "catalog_rebuild"},
        )
        await db.commit()
        return {"task_id": task_id, "queued": "catalog_rebuild"}

    return await execute_idempotent_json(request, redis, scope="admin.tasks.catalog_rebuild.enqueue", handler=_op)


@router.get("/quality/reports/latest")
async def get_latest_quality_report(db: AsyncSession = Depends(get_db_session)) -> dict[str, Any]:
    row = (
        await db.execute(
            text(
                """
                select
                    uuid as id,
                    status,
                    summary,
                    checks,
                    created_at
                from catalog_data_quality_reports
                order by created_at desc, id desc
                limit 1
                """
            )
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="quality report not found")
    return _serialize_quality_report_row(dict(row))


@router.get("/quality/reports")
async def list_quality_reports(
    limit: int = Query(default=20, ge=1, le=200),
    status: str | None = Query(default=None, pattern="^(ok|warning|critical)$"),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    rows = (
        await db.execute(
            text(
                """
                select
                    uuid as id,
                    status,
                    summary,
                    checks,
                    created_at
                from catalog_data_quality_reports
                where (cast(:status as text) is null or status = cast(:status as text))
                order by created_at desc, id desc
                limit :limit
                """
            ),
            {"status": status, "limit": limit},
        )
    ).mappings().all()
    return {
        "items": [_serialize_quality_report_row(dict(row)) for row in rows],
        "next_cursor": None,
        "request_id": "admin-quality-reports",
    }


@router.get("/quality/products/without-valid-offers")
async def list_quality_products_without_valid_offers(
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=20000),
    active_only: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    total = int(
        (
            await db.execute(
                text(
                    """
                    with offer_stats as (
                        select
                            cp.id,
                            count(distinct case when o.is_valid = true and o.in_stock = true then o.store_id end) as valid_store_count
                        from catalog_canonical_products cp
                        left join catalog_offers o on o.canonical_product_id = cp.id
                        where (not cast(:active_only as boolean) or cp.is_active = true)
                        group by cp.id
                    )
                    select count(*)
                    from offer_stats
                    where valid_store_count = 0
                    """
                ),
                {"active_only": active_only},
            )
        ).scalar_one()
        or 0
    )

    rows = (
        await db.execute(
            text(
                """
                with offer_stats as (
                    select
                        cp.id,
                        cp.uuid as product_uuid,
                        cp.normalized_title,
                        cp.main_image,
                        cp.is_active,
                        cp.updated_at,
                        b.uuid as brand_uuid,
                        b.name as brand_name,
                        c.uuid as category_uuid,
                        coalesce(c.name_ru, c.name_uz, c.name_en, c.slug) as category_name,
                        count(o.id) as total_offers,
                        count(distinct o.store_id) as store_count,
                        count(distinct case when o.is_valid = true and o.in_stock = true then o.store_id end) as valid_store_count,
                        max(o.scraped_at) as last_offer_seen_at,
                        max(o.scraped_at) filter (where o.is_valid = true and o.in_stock = true) as last_valid_offer_seen_at
                    from catalog_canonical_products cp
                    left join catalog_brands b on b.id = cp.brand_id
                    left join catalog_categories c on c.id = cp.category_id
                    left join catalog_offers o on o.canonical_product_id = cp.id
                    where (not cast(:active_only as boolean) or cp.is_active = true)
                    group by
                        cp.id,
                        cp.uuid,
                        cp.normalized_title,
                        cp.main_image,
                        cp.is_active,
                        cp.updated_at,
                        b.uuid,
                        b.name,
                        c.uuid,
                        c.name_ru,
                        c.name_uz,
                        c.name_en,
                        c.slug
                )
                select
                    product_uuid as id,
                    normalized_title,
                    main_image,
                    is_active,
                    store_count,
                    valid_store_count,
                    total_offers,
                    last_offer_seen_at,
                    last_valid_offer_seen_at,
                    updated_at,
                    brand_uuid as brand_id,
                    brand_name,
                    category_uuid as category_id,
                    category_name
                from offer_stats
                where valid_store_count = 0
                order by total_offers desc, last_offer_seen_at desc nulls last, normalized_title asc
                limit :limit
                offset :offset
                """
            ),
            {
                "active_only": active_only,
                "limit": limit,
                "offset": offset,
            },
        )
    ).mappings().all()

    return {
        "items": [_serialize_quality_no_offer_row(dict(row)) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "request_id": "admin-quality-without-valid-offers",
    }


@router.post("/quality/products/without-valid-offers/deactivate")
async def deactivate_quality_products_without_valid_offers(
    request: Request,
    payload: QualityProductsBulkDeactivateIn,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    async def _op():
        resolved_set: set[int] = set()
        for item in payload.product_ids:
            resolved = await _resolve_product_id_or_404(db, item)
            if resolved > 0:
                resolved_set.add(resolved)

        product_ids = sorted(resolved_set)
        if not product_ids:
            raise HTTPException(status_code=422, detail="product_ids must contain at least one valid product reference")

        deactivated_ids = (
            await db.execute(
                text(
                    """
                    with candidates as (
                        select
                            cp.id
                        from catalog_canonical_products cp
                        left join catalog_offers o
                          on o.canonical_product_id = cp.id
                         and o.is_valid = true
                         and o.in_stock = true
                        where cp.id = any(cast(:product_ids as bigint[]))
                        group by cp.id
                        having count(distinct o.store_id) = 0
                    )
                    update catalog_canonical_products cp
                    set is_active = false,
                        updated_at = now()
                    from candidates c
                    where cp.id = c.id
                      and cp.is_active = true
                    returning cp.id
                    """
                ),
                {"product_ids": product_ids},
            )
        ).scalars().all()

        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="quality.products.deactivate",
            entity_type="product",
            entity_id=None,
            payload={"requested": len(product_ids), "deactivated": len(deactivated_ids)},
        )
        await db.commit()
        await _invalidate_product_caches(redis)
        return {
            "ok": True,
            "requested": len(product_ids),
            "deactivated": len(deactivated_ids),
            "skipped": max(0, len(product_ids) - len(deactivated_ids)),
        }

    return await execute_idempotent_json(request, redis, scope="admin.quality.products.deactivate", handler=_op)


@router.get("/canonical/review-cases")
async def list_canonical_review_cases(
    status: str | None = Query(default=None, pattern="^(open|applied|rejected)$"),
    signal_type: str | None = Query(default=None, pattern="^[a-z_]{2,32}$"),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0, le=20000),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    rows = (
        await db.execute(
            text(
                """
                select
                    c.uuid as id,
                    c.store_product_id,
                    c.canonical_product_id,
                    c.candidate_canonical_id,
                    c.canonical_key,
                    c.signal_type,
                    c.confidence_score,
                    c.status,
                    c.payload,
                    c.reviewed_by,
                    c.reviewed_at,
                    c.created_at,
                    c.updated_at,
                    cp.normalized_title as canonical_title,
                    ccp.normalized_title as candidate_title
                from catalog_canonical_review_cases c
                join catalog_canonical_products cp on cp.id = c.canonical_product_id
                left join catalog_canonical_products ccp on ccp.id = c.candidate_canonical_id
                where (cast(:status as text) is null or c.status = cast(:status as text))
                  and (cast(:signal_type as text) is null or c.signal_type = cast(:signal_type as text))
                order by c.created_at desc, c.id desc
                limit :limit
                offset :offset
                """
            ),
            {"status": status, "signal_type": signal_type, "limit": limit, "offset": offset},
        )
    ).mappings().all()
    return {
        "items": [_serialize_canonical_review_case_row(dict(row)) for row in rows],
        "limit": limit,
        "offset": offset,
        "request_id": "admin-canonical-review-cases",
    }


@router.patch("/canonical/review-cases/{case_id}")
async def patch_canonical_review_case(
    request: Request,
    payload: CanonicalReviewCasePatch,
    case_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    async def _op():
        actor_uuid = _ensure_user_uuid(current_user)
        row = (
            await db.execute(
                text(
                    """
                    update catalog_canonical_review_cases
                    set status = cast(:status as text),
                        reviewed_by = cast(:reviewed_by as uuid),
                        reviewed_at = now(),
                        payload = case
                            when cast(:note as text) is null or btrim(cast(:note as text)) = '' then payload
                            else payload || jsonb_build_object('review_note', cast(:note as text))
                        end,
                        updated_at = now()
                    where uuid = cast(:case_id as uuid)
                    returning
                      uuid as id,
                      store_product_id,
                      canonical_product_id,
                      candidate_canonical_id,
                      canonical_key,
                      signal_type,
                      confidence_score,
                      status,
                      payload,
                      reviewed_by,
                      reviewed_at,
                      created_at,
                      updated_at
                    """
                ),
                {
                    "case_id": case_id,
                    "status": payload.status,
                    "reviewed_by": actor_uuid,
                    "note": payload.note,
                },
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="canonical review case not found")

        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="canonical.review_case.patch",
            entity_type="canonical_review_case",
            entity_id=str(case_id).lower(),
            payload={"status": payload.status, "has_note": bool((payload.note or "").strip())},
        )
        await db.commit()
        return _serialize_canonical_review_case_row(dict(row))

    scope = f"admin.canonical.review_case.patch:{case_id.lower()}:{payload.status}"
    return await execute_idempotent_json(request, redis, scope=scope, handler=_op)


@router.post("/quality/reports/run")
async def run_quality_report(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    async def _op():
        task_id = enqueue_catalog_quality_report()
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="quality.report.enqueue",
            entity_type="task",
            entity_id=task_id,
            payload={"queued": "maintenance"},
        )
        await db.commit()
        return {"task_id": task_id, "queued": "maintenance"}

    return await execute_idempotent_json(request, redis, scope="admin.quality.report.enqueue", handler=_op)


@router.post("/quality/alerts/test")
async def run_quality_alert_test(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    async def _op():
        task_id = enqueue_test_quality_alert()
        await _audit_admin_action(
            db,
            current_user=current_user,
            request=request,
            action="quality.alert_test.enqueue",
            entity_type="task",
            entity_id=task_id,
            payload={"queued": "maintenance"},
        )
        await db.commit()
        return {"task_id": task_id, "queued": "maintenance"}

    return await execute_idempotent_json(request, redis, scope="admin.quality.alert_test.enqueue", handler=_op)


@router.get("/tasks/{task_id}")
async def get_admin_task_status(task_id: str) -> dict:
    status = get_task_status(task_id)
    state = status["state"]
    progress_map = {"PENDING": 15, "RECEIVED": 25, "STARTED": 60, "RETRY": 75, "SUCCESS": 100, "FAILURE": 100, "REVOKED": 100}
    info = status.get("info") if isinstance(status.get("info"), dict) else {}
    if isinstance(info, dict) and isinstance(info.get("progress"), (int, float)):
        status["progress"] = int(max(0, min(100, float(info["progress"]))))
    elif isinstance(info, dict) and isinstance(info.get("current"), (int, float)) and isinstance(info.get("total"), (int, float)):
        total = float(info["total"])
        current = float(info["current"])
        status["progress"] = int(max(0, min(100, (current / total) * 100))) if total > 0 else progress_map.get(state, 40)
    else:
        status["progress"] = progress_map.get(state, 40)
    return status
