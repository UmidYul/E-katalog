from __future__ import annotations

import hashlib
from datetime import datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.b2b import B2BRepository
from app.schemas.b2b import B2BGoRedirectOut
from shared.utils.time import UTC


UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"

router = APIRouter(tags=["b2b-go-redirect"])


def _extract_ip(request: Request) -> str:
    forwarded = str(request.headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        head = forwarded.split(",", maxsplit=1)[0].strip()
        if head:
            return head
    real_ip = str(request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _append_query(url: str, key: str, value: str) -> str:
    parsed = urlsplit(url)
    query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
    query_pairs = [(k, v) for k, v in query_pairs if k != key]
    query_pairs.append((key, value))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query_pairs), parsed.fragment))


@router.post("/go/{offer_id}")
async def redirect_offer_click(
    request: Request,
    offer_id: str = Path(..., pattern=UUID_REF_PATTERN),
    source_page: str = Query(default="unknown", max_length=64),
    placement: str = Query(default="unknown", max_length=64),
    session_key: str | None = Query(default=None, max_length=128),
    no_redirect: bool = Query(default=False),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="go-redirect", limit=600)
    repo = B2BRepository(db, cursor_secret=settings.cursor_secret)
    offer = await repo.resolve_offer_destination(offer_uuid=offer_id)
    if offer is None:
        raise HTTPException(status_code=404, detail="offer not found")

    destination_url = str(offer.get("destination_url") or "").strip()
    if not destination_url:
        raise HTTPException(status_code=404, detail="offer destination is not configured")

    if not bool(settings.b2b_enabled):
        if no_redirect:
            return B2BGoRedirectOut(
                click_event_id="",
                destination_url=destination_url,
                billable=False,
                status="b2b_disabled",
            )
        return RedirectResponse(url=destination_url, status_code=307)

    store_id = int(offer["store_id"])
    org_id = await repo.resolve_org_for_store(store_id=store_id)
    campaign = await repo.resolve_active_campaign_for_store(org_id=org_id, store_id=store_id)
    plan_click_price = await repo.resolve_plan_click_price(org_id=org_id)
    effective_default_click_price = max(float(settings.b2b_default_click_price_uzs), float(plan_click_price))

    ip_address = _extract_ip(request)
    user_agent = str(request.headers.get("user-agent") or "")[:1000]
    source_referrer = str(request.headers.get("referer") or "")
    resolved_session_key = (
        str(session_key).strip()
        if session_key
        else str(request.headers.get("x-session-id") or request.cookies.get("session_id") or _sha256(f"{ip_address}:{user_agent}"))[
            :128
        ]
    )
    dedupe_key = _sha256(f"{offer_id}:{resolved_session_key}:{placement}:{ip_address}")[:64]

    click = await repo.create_click_event(
        offer_id=int(offer["id"]),
        offer_uuid=str(offer["uuid"]),
        store_id=store_id,
        destination_url=destination_url,
        source_page=source_page,
        placement=placement,
        session_key=resolved_session_key,
        ip_hash=_sha256(ip_address),
        user_agent_hash=_sha256(user_agent),
        referrer=source_referrer,
        org_id=org_id,
        campaign=campaign,
        dedupe_key=dedupe_key,
        dedupe_window_seconds=int(settings.b2b_click_dedupe_window_seconds),
        default_click_price=effective_default_click_price,
    )

    expires_at = datetime.now(UTC) + timedelta(seconds=max(30, int(settings.b2b_click_token_ttl_seconds)))
    token = repo.build_click_token(
        click_event_uuid=str(click["click_event_uuid"]),
        offer_uuid=str(offer["uuid"]),
        expires_at=expires_at,
    )
    await repo.attach_click_attribution_token(click_event_id=int(click["click_event_id"]), attribution_token=token)
    attributed_destination = _append_query(destination_url, "ek_click", token)

    if no_redirect:
        return B2BGoRedirectOut(
            click_event_id=str(click["click_event_uuid"]),
            destination_url=attributed_destination,
            billable=bool(click.get("billable")),
            status=str(click.get("status") or "valid"),
        )

    return RedirectResponse(
        url=attributed_destination,
        status_code=307,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "X-Click-Event-Id": str(click["click_event_uuid"]),
        },
    )
