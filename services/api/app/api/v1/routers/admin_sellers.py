from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from shared.utils.time import UTC

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.rbac import ADMIN_ROLE, require_roles
from app.api.v1.routers.seller_provisioning import apply_partner_lead_status_actions
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.seller import SellerProductStatusEventListOut
from app.services.seller_onboarding_service import canonicalize_partner_lead_status, internalize_seller_status
from app.services.seller_product_timeline_service import (
    list_seller_product_status_events,
    record_seller_product_status_event,
)


router = APIRouter(prefix="/admin/sellers", tags=["admin-sellers"])

UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"


class AdminSellerProductModerationPatchIn(BaseModel):
    status: str = Field(pattern=r"^(active|rejected|archived)$")
    moderation_comment: str | None = Field(default=None, max_length=2000)


class AdminSellerApplicationPatchIn(BaseModel):
    status: str = Field(pattern=r"^(pending|review|approved|rejected)$")
    review_note: str | None = Field(default=None, max_length=2000)


class AdminSellerApplicationBulkPatchIn(BaseModel):
    application_ids: list[str] = Field(min_length=1, max_length=200)
    status: str = Field(pattern=r"^(pending|review|approved|rejected)$")
    review_note: str | None = Field(default=None, max_length=2000)


class AdminSellerTariffAssignIn(BaseModel):
    plan_code: str = Field(min_length=2, max_length=64)


def _parse_iso(value: object) -> datetime | None:
    text_value = str(value or "").strip()
    if not text_value:
        return None
    try:
        parsed = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _age_hours(value: object) -> int:
    parsed = _parse_iso(value)
    if parsed is None:
        return 0
    return max(0, int((datetime.now(UTC) - parsed).total_seconds() // 3600))


def _priority_by_age(*, status: str, age_hours: int) -> str:
    if status not in {"pending", "review"}:
        return "resolved"
    if age_hours >= 72:
        return "critical"
    if age_hours >= 24:
        return "high"
    return "normal"


def _with_sla(item: dict) -> dict:
    normalized = dict(item)
    status = canonicalize_partner_lead_status(str(normalized.get("status") or "submitted"))
    submitted_at = str(normalized.get("created_at") or "")
    age_hours = _age_hours(submitted_at)
    normalized["status"] = status
    normalized["submitted_at"] = submitted_at
    normalized["age_hours"] = age_hours
    normalized["priority"] = _priority_by_age(status=status, age_hours=age_hours)
    return normalized


def _parse_date_start(value: str | None) -> datetime | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    try:
        return datetime.fromisoformat(f"{normalized}T00:00:00+00:00").astimezone(UTC)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"invalid date value: {normalized}") from exc


def _parse_date_end_exclusive(value: str | None) -> datetime | None:
    start = _parse_date_start(value)
    if start is None:
        return None
    return start + timedelta(days=1)


def _duplicate_email_exists_sql(*, alias: str = "pl") -> str:
    return f"""
        exists (
            select 1
            from b2b_partner_leads dup_email
            where dup_email.id <> {alias}.id
              and lower(trim(coalesce(dup_email.email, ''))) = lower(trim(coalesce({alias}.email, '')))
              and trim(coalesce({alias}.email, '')) <> ''
        )
    """


def _duplicate_company_exists_sql(*, alias: str = "pl") -> str:
    return f"""
        exists (
            select 1
            from b2b_partner_leads dup_company
            where dup_company.id <> {alias}.id
              and lower(trim(coalesce(dup_company.company_name, ''))) = lower(trim(coalesce({alias}.company_name, '')))
              and trim(coalesce({alias}.company_name, '')) <> ''
        )
    """


def _build_partner_leads_where(
    *,
    status: str | None,
    q: str | None,
    country_code: str | None,
    created_from: datetime | None,
    created_to: datetime | None,
    duplicates_only: bool,
) -> tuple[str, dict]:
    where = ["1=1"]
    params: dict = {}
    if status:
        where.append("pl.status = :status")
        params["status"] = status
    normalized_q = str(q or "").strip()
    if normalized_q:
        where.append("(pl.company_name ilike :q or pl.email ilike :q or pl.contact_name ilike :q)")
        params["q"] = f"%{normalized_q}%"
    normalized_country = str(country_code or "").strip().upper()
    if normalized_country:
        where.append("upper(pl.country_code) = :country_code")
        params["country_code"] = normalized_country
    if created_from is not None:
        where.append("pl.created_at >= :created_from")
        params["created_from"] = created_from
    if created_to is not None:
        where.append("pl.created_at < :created_to")
        params["created_to"] = created_to
    if duplicates_only:
        where.append(f"({_duplicate_email_exists_sql(alias='pl')} or {_duplicate_company_exists_sql(alias='pl')})")
    return " and ".join(where), params


def _priority_rank(value: str | None) -> int:
    normalized = str(value or "").strip().lower()
    if normalized == "critical":
        return 3
    if normalized == "high":
        return 2
    if normalized == "normal":
        return 1
    return 0


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


def _history_status(value: object) -> str | None:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return None
    return canonicalize_partner_lead_status(normalized)


def _history_note(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _history_created_at(value: object) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC).isoformat()
        return value.astimezone(UTC).isoformat()
    return str(value or "")


def _serialize_application_history_row(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    return {
        "id": str(row.get("event_id") or row.get("uuid") or ""),
        "action": str(row.get("action") or ""),
        "actor_user_id": str(row.get("actor_user_uuid") or "") or None,
        "actor_role": str(row.get("actor_role") or "system"),
        "status_from": _history_status(payload.get("status_from")),
        "status_to": _history_status(payload.get("status_to_public") or payload.get("status_to")),
        "review_note": _history_note(payload.get("review_note")),
        "notification_sent": bool(payload.get("notification_sent")) if "notification_sent" in payload else None,
        "notification_error": _history_note(payload.get("notification_error")),
        "source": str(payload.get("source") or "admin_sellers"),
        "created_at": _history_created_at(row.get("created_at")),
    }


async def _record_application_history_event(
    *,
    db: AsyncSession,
    current_user: dict,
    request: Request,
    application_id: str,
    action: str,
    payload: dict[str, Any],
) -> None:
    actor_uuid = str(current_user.get("id") or "").strip().lower() or None
    actor_role = str(current_user.get("role") or "admin").strip().lower() or "admin"
    request_id = getattr(getattr(request, "state", None), "request_id", None)
    try:
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
                    'seller_application',
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
                "entity_id": application_id,
                "request_id": str(request_id) if request_id else None,
                "method": request.method,
                "path": request.url.path,
                "ip_address": _request_ip(request),
                "user_agent": str(request.headers.get("user-agent") or "")[:512],
                "payload": json.dumps(payload, ensure_ascii=False, default=str),
            },
        )
        await db.commit()
    except Exception:  # noqa: BLE001
        await db.rollback()


@router.get("/applications")
async def admin_list_seller_applications(
    request: Request,
    status: str | None = Query(default=None, pattern=r"^(pending|review|approved|rejected)$"),
    q: str | None = Query(default=None, min_length=2, max_length=120),
    country_code: str | None = Query(default=None, pattern=r"^[A-Za-z]{2}$"),
    created_from: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    created_to: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    duplicates_only: bool = Query(default=False),
    sort_by: str = Query(default="recent", pattern=r"^(recent|oldest|age_desc|age_asc|company_asc|company_desc|priority_desc)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    b2b_status = internalize_seller_status(status) if status else None
    created_from_dt = _parse_date_start(created_from)
    created_to_dt = _parse_date_end_exclusive(created_to)
    if created_from_dt and created_to_dt and created_from_dt >= created_to_dt:
        raise HTTPException(status_code=422, detail="created_from must be earlier than created_to")
    result = await repo.list_admin_partner_leads(
        status=b2b_status,
        q=q,
        country_code=country_code,
        created_from=created_from_dt,
        created_to=created_to_dt,
        duplicates_only=duplicates_only,
        limit=limit,
        offset=offset,
    )
    items = [_with_sla(item) for item in result.get("items", [])]
    if sort_by == "oldest":
        items.sort(key=lambda item: _parse_iso(item.get("submitted_at")) or datetime.now(UTC))
    elif sort_by == "age_desc":
        items.sort(key=lambda item: int(item.get("age_hours") or 0), reverse=True)
    elif sort_by == "age_asc":
        items.sort(key=lambda item: int(item.get("age_hours") or 0))
    elif sort_by == "company_asc":
        items.sort(key=lambda item: str(item.get("company_name") or "").strip().lower())
    elif sort_by == "company_desc":
        items.sort(key=lambda item: str(item.get("company_name") or "").strip().lower(), reverse=True)
    elif sort_by == "priority_desc":
        items.sort(
            key=lambda item: (
                _priority_rank(str(item.get("priority") or "")),
                int(item.get("age_hours") or 0),
            ),
            reverse=True,
        )
    else:
        items.sort(key=lambda item: _parse_iso(item.get("submitted_at")) or datetime.fromtimestamp(0, tz=UTC), reverse=True)
    result["items"] = items
    return result


@router.get("/applications/summary")
async def admin_seller_applications_summary(
    request: Request,
    status: str | None = Query(default=None, pattern=r"^(pending|review|approved|rejected)$"),
    q: str | None = Query(default=None, min_length=2, max_length=120),
    country_code: str | None = Query(default=None, pattern=r"^[A-Za-z]{2}$"),
    created_from: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    created_to: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)

    b2b_status = internalize_seller_status(status) if status else None
    created_from_dt = _parse_date_start(created_from)
    created_to_dt = _parse_date_end_exclusive(created_to)
    if created_from_dt and created_to_dt and created_from_dt >= created_to_dt:
        raise HTTPException(status_code=422, detail="created_from must be earlier than created_to")
    where_sql, where_params = _build_partner_leads_where(
        status=b2b_status,
        q=q,
        country_code=country_code,
        created_from=created_from_dt,
        created_to=created_to_dt,
        duplicates_only=False,
    )
    duplicate_email_exists_sql = _duplicate_email_exists_sql(alias="pl")
    duplicate_company_exists_sql = _duplicate_company_exists_sql(alias="pl")
    row = (
        await db.execute(
            text(
                f"""
                select
                    count(*)::int as total,
                    count(*) filter (where pl.status = 'submitted')::int as submitted_count,
                    count(*) filter (where pl.status = 'review')::int as review_count,
                    count(*) filter (where pl.status = 'approved')::int as approved_count,
                    count(*) filter (where pl.status = 'rejected')::int as rejected_count,
                    count(*) filter (where pl.created_at >= now() - interval '7 days')::int as created_last_7d,
                    count(*) filter (where ({duplicate_email_exists_sql} or {duplicate_company_exists_sql}))::int as duplicates_count,
                    avg(extract(epoch from (pl.reviewed_at - pl.created_at)) / 3600.0)
                        filter (where pl.reviewed_at is not null and pl.status in ('review', 'approved', 'rejected')) as avg_review_hours,
                    percentile_cont(0.5) within group (order by extract(epoch from (now() - pl.created_at)) / 3600.0)
                        filter (where pl.status in ('submitted', 'review')) as median_open_hours,
                    max(extract(epoch from (now() - pl.created_at)) / 3600.0)
                        filter (where pl.status in ('submitted', 'review')) as oldest_open_hours
                from b2b_partner_leads pl
                where {where_sql}
                """
            ),
            where_params,
        )
    ).mappings().first()
    if not row:
        return {
            "total": 0,
            "status_counts": {"pending": 0, "review": 0, "approved": 0, "rejected": 0},
            "created_last_7d": 0,
            "duplicates_count": 0,
            "avg_review_hours": 0,
            "median_open_hours": 0,
            "oldest_open_hours": 0,
        }
    pending_count = int(row.get("submitted_count") or 0)
    review_count = int(row.get("review_count") or 0)
    approved_count = int(row.get("approved_count") or 0)
    rejected_count = int(row.get("rejected_count") or 0)
    avg_review_hours = float(row.get("avg_review_hours") or 0.0)
    median_open_hours = float(row.get("median_open_hours") or 0.0)
    oldest_open_hours = float(row.get("oldest_open_hours") or 0.0)
    return {
        "total": int(row.get("total") or 0),
        "status_counts": {
            "pending": pending_count,
            "review": review_count,
            "approved": approved_count,
            "rejected": rejected_count,
        },
        "created_last_7d": int(row.get("created_last_7d") or 0),
        "duplicates_count": int(row.get("duplicates_count") or 0),
        "avg_review_hours": round(avg_review_hours, 1),
        "median_open_hours": int(round(median_open_hours)),
        "oldest_open_hours": int(round(oldest_open_hours)),
    }


@router.get("/applications/{application_id}")
async def admin_get_seller_application(
    request: Request,
    application_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    row = (
        await db.execute(
            text(
                """
                select
                    uuid,
                    status,
                    company_name,
                    legal_name,
                    tax_id,
                    website_url,
                    contact_name,
                    contact_role,
                    email,
                    phone,
                    categories,
                    notes,
                    review_note,
                    provisioning_status,
                    created_at,
                    updated_at
                from b2b_partner_leads
                where uuid = cast(:application_id as uuid)
                limit 1
                """
            ),
            {"application_id": application_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="application not found")
    return _with_sla(dict(row))


@router.get("/applications/{application_id}/history")
async def admin_get_seller_application_history(
    request: Request,
    application_id: str = Path(..., pattern=UUID_REF_PATTERN),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    lead_exists = (
        await db.execute(
            text(
                """
                select 1
                from b2b_partner_leads
                where uuid = cast(:application_id as uuid)
                limit 1
                """
            ),
            {"application_id": application_id},
        )
    ).scalar_one_or_none()
    if lead_exists is None:
        raise HTTPException(status_code=404, detail="application not found")

    total_events = int(
        (
            await db.execute(
                text(
                    """
                    select count(*)::int
                    from admin_audit_events
                    where entity_type = 'seller_application'
                      and entity_id = :application_id
                    """
                ),
                {"application_id": application_id},
            )
        ).scalar_one()
        or 0
    ) + 1
    rows = (
        await db.execute(
            text(
                """
                select event_id, actor_user_uuid, actor_role, action, payload, created_at
                from (
                    select
                        ae.uuid::text as event_id,
                        ae.actor_user_uuid::text as actor_user_uuid,
                        ae.actor_role as actor_role,
                        ae.action as action,
                        ae.payload as payload,
                        ae.created_at as created_at
                    from admin_audit_events ae
                    where ae.entity_type = 'seller_application'
                      and ae.entity_id = :application_id
                    union all
                    select
                        concat('submitted-', pl.uuid::text) as event_id,
                        null::text as actor_user_uuid,
                        'system'::text as actor_role,
                        'seller_application.submitted'::text as action,
                        jsonb_build_object('status_to', pl.status, 'source', 'public_intake') as payload,
                        pl.created_at as created_at
                    from b2b_partner_leads pl
                    where pl.uuid = cast(:application_id as uuid)
                ) history
                order by created_at desc
                limit :limit
                offset :offset
                """
            ),
            {"application_id": application_id, "limit": limit, "offset": offset},
        )
    ).mappings().all()
    return {
        "items": [_serialize_application_history_row(dict(row)) for row in rows],
        "total": total_events,
        "limit": limit,
        "offset": offset,
    }


@router.patch("/applications/{application_id}/status")
async def admin_patch_seller_application(
    request: Request,
    payload: AdminSellerApplicationPatchIn,
    application_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    if payload.status == "rejected" and not str(payload.review_note or "").strip():
        raise HTTPException(status_code=422, detail="review_note is required for rejected status")
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-sellers-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        status = internalize_seller_status(payload.status)
        updated = await repo.patch_admin_partner_lead(
            lead_uuid=application_id,
            status=status,
            review_note=payload.review_note,
            reviewer_uuid=str(current_user.get("id")),
        )
        if not updated:
            raise HTTPException(status_code=404, detail="application not found")
        result = await apply_partner_lead_status_actions(
            lead_id=application_id,
            status_value=status,
            review_note=payload.review_note,
            updated=updated,
            previous_status=updated.get("status_before"),
            current_user_id=str(current_user.get("id")),
            repo=repo,
            redis=redis,
            db=db,
        )
        result_payload = result if isinstance(result, dict) else updated
        await _record_application_history_event(
            db=db,
            current_user=current_user,
            request=request,
            application_id=application_id,
            action="seller_application.status_patch",
            payload={
                "source": "admin_sellers",
                "mode": "single",
                "status_from": updated.get("status_before"),
                "status_to": status,
                "status_to_public": payload.status,
                "review_note": payload.review_note,
                "notification_sent": result_payload.get("notification_sent"),
                "notification_error": result_payload.get("notification_error"),
            },
        )
        if isinstance(result, dict):
            return _with_sla(result)
        return _with_sla(updated)

    return await execute_idempotent_json(
        request,
        redis,
        scope=(
            f"admin.sellers.applications.patch:{application_id.lower()}:{payload.status}:"
            f"{hashlib.sha256(str(payload.review_note or '').encode('utf-8')).hexdigest()[:12]}"
        ),
        handler=_op,
    )


@router.post("/applications/bulk-status")
async def admin_bulk_patch_seller_applications(
    request: Request,
    payload: AdminSellerApplicationBulkPatchIn,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    if payload.status == "rejected" and not str(payload.review_note or "").strip():
        raise HTTPException(status_code=422, detail="review_note is required for rejected status")
    cleaned_ids: list[str] = []
    seen: set[str] = set()
    for value in payload.application_ids:
        normalized = str(value or "").strip().lower()
        if not re.match(UUID_REF_PATTERN, normalized):
            raise HTTPException(status_code=422, detail=f"invalid application id: {value}")
        if normalized in seen:
            continue
        cleaned_ids.append(normalized)
        seen.add(normalized)

    redis = get_redis()
    scope_fingerprint = hashlib.sha256(
        f"{payload.status}|{payload.review_note or ''}|{','.join(sorted(cleaned_ids))}".encode("utf-8")
    ).hexdigest()[:16]

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-sellers-write", limit=120)
        repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
        target_status = internalize_seller_status(payload.status)
        items: list[dict] = []
        not_found: list[str] = []
        failed: list[dict] = []
        for application_id in cleaned_ids:
            try:
                updated = await repo.patch_admin_partner_lead(
                    lead_uuid=application_id,
                    status=target_status,
                    review_note=payload.review_note,
                    reviewer_uuid=str(current_user.get("id")),
                )
                if not updated:
                    not_found.append(application_id)
                    continue
                result = await apply_partner_lead_status_actions(
                    lead_id=application_id,
                    status_value=target_status,
                    review_note=payload.review_note,
                    updated=updated,
                    previous_status=updated.get("status_before"),
                    current_user_id=str(current_user.get("id")),
                    repo=repo,
                    redis=redis,
                    db=db,
                )
                result_payload = result if isinstance(result, dict) else updated
                await _record_application_history_event(
                    db=db,
                    current_user=current_user,
                    request=request,
                    application_id=application_id,
                    action="seller_application.bulk_status_patch",
                    payload={
                        "source": "admin_sellers",
                        "mode": "bulk",
                        "status_from": updated.get("status_before"),
                        "status_to": target_status,
                        "status_to_public": payload.status,
                        "review_note": payload.review_note,
                        "notification_sent": result_payload.get("notification_sent"),
                        "notification_error": result_payload.get("notification_error"),
                        "batch_size": len(cleaned_ids),
                    },
                )
                items.append(_with_sla(result_payload))
            except HTTPException as exc:
                failed.append({"application_id": application_id, "detail": str(exc.detail), "status_code": exc.status_code})
            except Exception as exc:  # noqa: BLE001
                failed.append({"application_id": application_id, "detail": str(exc), "status_code": 500})
        return {
            "ok": not failed,
            "status": payload.status,
            "processed": len(cleaned_ids),
            "updated_count": len(items),
            "not_found_count": len(not_found),
            "failed_count": len(failed),
            "items": items,
            "not_found_ids": not_found,
            "failed": failed,
        }

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"admin.sellers.applications.bulk_patch:{payload.status}:{scope_fingerprint}",
        handler=_op,
    )


@router.get("/shops")
async def admin_list_seller_shops(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    rows = (
        await db.execute(
            text(
                """
                select
                    s.uuid,
                    s.org_uuid,
                    s.owner_user_uuid,
                    s.slug,
                    s.shop_name,
                    s.status,
                    s.website_url,
                    s.contact_email,
                    s.contact_phone,
                    s.is_auto_paused,
                    s.metadata,
                    s.created_at,
                    s.updated_at
                from seller_shops s
                order by s.updated_at desc, s.id desc
                limit :limit
                offset :offset
                """
            ),
            {"limit": limit, "offset": offset},
        )
    ).mappings().all()
    total = int((await db.execute(text("select count(*)::int from seller_shops"))).scalar_one() or 0)
    return {"items": [dict(item) for item in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/product-moderation")
async def admin_list_seller_product_moderation(
    request: Request,
    status: str | None = Query(default="pending_moderation", pattern=r"^(draft|pending_moderation|active|rejected|archived)$"),
    q: str | None = Query(default=None, min_length=1, max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    rows = (
        await db.execute(
            text(
                """
                select
                    p.uuid,
                    p.title,
                    p.status,
                    p.price,
                    p.stock_quantity,
                    p.sku,
                    p.moderation_comment,
                    p.updated_at,
                    s.uuid as shop_uuid,
                    s.shop_name
                from seller_products p
                join seller_shops s on s.id = p.shop_id
                where (:status is null or p.status = :status)
                  and (
                    :q is null
                    or lower(p.title) like lower(cast(:q_like as text))
                    or lower(coalesce(p.sku, '')) like lower(cast(:q_like as text))
                    or lower(s.shop_name) like lower(cast(:q_like as text))
                  )
                order by p.updated_at desc, p.id desc
                limit :limit
                offset :offset
                """
            ),
            {
                "status": status,
                "q": q,
                "q_like": f"%{q.strip()}%" if q else None,
                "limit": limit,
                "offset": offset,
            },
        )
    ).mappings().all()
    total = int(
        (
            await db.execute(
                text(
                    """
                    select count(*)::int
                    from seller_products p
                    join seller_shops s on s.id = p.shop_id
                    where (:status is null or p.status = :status)
                      and (
                        :q is null
                        or lower(p.title) like lower(cast(:q_like as text))
                        or lower(coalesce(p.sku, '')) like lower(cast(:q_like as text))
                        or lower(s.shop_name) like lower(cast(:q_like as text))
                      )
                    """
                ),
                {
                    "status": status,
                    "q": q,
                    "q_like": f"%{q.strip()}%" if q else None,
                },
            )
        ).scalar_one()
        or 0
    )
    return {"items": [dict(item) for item in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/product-moderation/{product_id}/status-history", response_model=SellerProductStatusEventListOut)
async def admin_list_seller_product_status_history(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    target = (
        await db.execute(
            text(
                """
                select id
                from seller_products
                where uuid = cast(:product_uuid as uuid)
                limit 1
                """
            ),
            {"product_uuid": product_id},
        )
    ).mappings().first()
    if not target:
        raise HTTPException(status_code=404, detail="product not found")
    payload = await list_seller_product_status_events(
        db,
        product_id=int(target["id"]),
        limit=limit,
        offset=offset,
    )
    return SellerProductStatusEventListOut(**payload)


@router.patch("/product-moderation/{product_id}/status")
async def admin_patch_seller_product_moderation_status(
    request: Request,
    payload: AdminSellerProductModerationPatchIn,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    if payload.status == "rejected" and not str(payload.moderation_comment or "").strip():
        raise HTTPException(status_code=422, detail="moderation_comment is required when status=rejected")
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-sellers-write", limit=120)
        row = (
            await db.execute(
                text(
                    """
                    with target as (
                        select id, shop_id, status
                        from seller_products
                        where uuid = cast(:product_uuid as uuid)
                        limit 1
                    )
                    update seller_products p
                    set
                        status = :status,
                        moderation_comment = :moderation_comment,
                        updated_at = now()
                    from target t
                    where p.id = t.id
                    returning p.id, p.uuid, t.shop_id, t.status as previous_status, p.status, p.moderation_comment, p.updated_at
                    """
                ),
                {
                    "status": payload.status,
                    "moderation_comment": payload.moderation_comment,
                    "product_uuid": product_id,
                },
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="product not found")
        previous_status = str(row.get("previous_status") or "").strip().lower() or None
        current_status = str(row.get("status") or "").strip().lower() or None
        if current_status and previous_status != current_status:
            await record_seller_product_status_event(
                db,
                product_id=int(row["id"]),
                shop_id=int(row["shop_id"]),
                from_status=previous_status,
                to_status=current_status,
                event_type="status_change",
                reason_code=f"admin_moderation_{current_status}",
                comment=payload.moderation_comment,
                actor_role="admin",
                actor_user_uuid=str(current_user.get("id") or "").strip().lower() or None,
            )
        await db.commit()
        return {
            "uuid": str(row["uuid"]),
            "status": str(row["status"]),
            "moderation_comment": row.get("moderation_comment"),
            "updated_at": str(row["updated_at"]),
        }

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"admin.sellers.product_moderation.patch:{product_id.lower()}:{payload.status}",
        handler=_op,
    )


@router.get("/finance")
async def admin_list_seller_finance(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    rows = (
        await db.execute(
            text(
                """
                select
                    s.uuid as shop_uuid,
                    s.shop_name,
                    s.status as shop_status,
                    coalesce(w.balance, 0) as balance,
                    coalesce(w.credit_limit, 0) as credit_limit,
                    coalesce(sum(case when t.amount > 0 then t.amount else 0 end), 0) as total_topup,
                    coalesce(sum(case when t.amount < 0 then -t.amount else 0 end), 0) as total_spend
                from seller_shops s
                left join b2b_wallet_accounts w on w.org_id = (select o.id from b2b_organizations o where o.uuid = s.org_uuid)
                left join b2b_wallet_transactions t on t.wallet_account_id = w.id
                group by s.uuid, s.shop_name, s.status, w.balance, w.credit_limit
                order by s.updated_at desc
                limit :limit
                offset :offset
                """
            ),
            {"limit": limit, "offset": offset},
        )
    ).mappings().all()
    total = int((await db.execute(text("select count(*)::int from seller_shops"))).scalar_one() or 0)
    return {"items": [dict(item) for item in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/tariffs")
async def admin_list_seller_tariffs(
    request: Request,
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    plans = (
        await db.execute(
            text(
                """
                select
                    p.uuid,
                    p.code,
                    p.name,
                    p.monthly_fee,
                    p.included_clicks,
                    p.click_price,
                    p.currency,
                    p.is_active,
                    p.updated_at
                from b2b_plan_catalog p
                order by p.monthly_fee asc, p.id asc
                """
            )
        )
    ).mappings().all()
    return {"items": [dict(item) for item in plans], "total": len(plans)}


@router.get("/tariffs/assignments")
async def admin_list_seller_tariff_assignments(
    request: Request,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="admin-sellers-read", limit=240)
    rows = (
        await db.execute(
            text(
                """
                with latest_sub as (
                    select
                        s.org_id,
                        s.plan_id,
                        s.status,
                        s.created_at,
                        row_number() over (partition by s.org_id order by s.created_at desc, s.id desc) as rn
                    from b2b_subscriptions s
                )
                select
                    sh.uuid as shop_uuid,
                    sh.shop_name,
                    ls.status as subscription_status,
                    ls.created_at as assigned_at,
                    p.code as plan_code,
                    p.name as plan_name
                from seller_shops sh
                left join latest_sub ls on ls.org_id = (select o.id from b2b_organizations o where o.uuid = sh.org_uuid) and ls.rn = 1
                left join b2b_plan_catalog p on p.id = ls.plan_id
                order by sh.updated_at desc
                limit :limit
                """
            ),
            {"limit": limit},
        )
    ).mappings().all()
    return {"items": [dict(item) for item in rows], "total": len(rows)}


@router.put("/tariffs/assignments/{shop_id}")
async def admin_assign_seller_tariff(
    request: Request,
    payload: AdminSellerTariffAssignIn,
    shop_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(require_roles(ADMIN_ROLE, detail="admin access required")),
    db: AsyncSession = Depends(get_db_session),
):
    del current_user
    redis = get_redis()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="admin-sellers-write", limit=120)
        org_id = (
            await db.execute(
                text("select o.id from b2b_organizations o join seller_shops s on s.org_uuid = o.uuid where s.uuid = cast(:shop_uuid as uuid)"),
                {"shop_uuid": shop_id},
            )
        ).scalar_one_or_none()
        if org_id is None:
            raise HTTPException(status_code=404, detail="shop not found")

        plan_id = (
            await db.execute(
                text("select id from b2b_plan_catalog where code = :code and is_active = true"),
                {"code": payload.plan_code},
            )
        ).scalar_one_or_none()
        if plan_id is None:
            raise HTTPException(status_code=404, detail="tariff plan not found")

        row = (
            await db.execute(
                text(
                    """
                    insert into b2b_subscriptions (org_id, plan_id, status, starts_at, created_at, updated_at)
                    values (:org_id, :plan_id, 'active', now(), now(), now())
                    returning uuid, org_id, plan_id, status, created_at
                    """
                ),
                {"org_id": int(org_id), "plan_id": int(plan_id)},
            )
        ).mappings().one()
        await db.commit()
        return dict(row)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"admin.sellers.tariff.assign:{shop_id.lower()}:{payload.plan_code.lower()}",
        handler=_op,
    )
