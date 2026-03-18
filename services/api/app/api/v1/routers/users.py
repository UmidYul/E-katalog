from __future__ import annotations

import json
import secrets
from datetime import datetime
from typing import Literal
from shared.utils.time import UTC

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.v1.routers.auth import _ensure_user_uuid, get_current_user
from app.core.config import settings
from app.repositories.catalog import CatalogRepository
from app.schemas.catalog import ProductPriceAlertOut
from shared.db.models import AuthSession, AuthSessionToken, AuthUser, CatalogCanonicalProduct, CatalogPriceAlert

router = APIRouter(prefix="/users", tags=["users"])
UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
RECENTLY_VIEWED_LIMIT = 30
NOTIFICATION_PREFERENCES_FIELD = "notification_preferences"
COMPARE_LIMIT = 4
TELEGRAM_CONNECT_TTL_SECONDS = 60 * 10


class FavoriteItem(BaseModel):
    product_id: str


class UserProfileOut(BaseModel):
    id: str
    email: str
    full_name: str
    display_name: str
    phone: str = ""
    city: str = ""
    telegram: str = ""
    about: str = ""
    updated_at: str | None = None
    created_at: str | None = None
    last_login_at: str | None = None


class UserProfilePatch(BaseModel):
    email: str | None = Field(default=None, max_length=150)
    display_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    city: str | None = Field(default=None, max_length=120)
    telegram: str | None = Field(default=None, max_length=64)
    about: str | None = Field(default=None, max_length=600)


class NotificationChannels(BaseModel):
    email: bool = True
    telegram: bool = False


class NotificationChannelsPatch(BaseModel):
    email: bool | None = None
    telegram: bool | None = None


class NotificationMatrix(BaseModel):
    price_drop: NotificationChannels = Field(default_factory=lambda: NotificationChannels(email=True, telegram=True))
    new_offers: NotificationChannels = Field(default_factory=lambda: NotificationChannels(email=True, telegram=False))
    weekly_digest: NotificationChannels = Field(default_factory=lambda: NotificationChannels(email=True, telegram=False))
    daily_deals: NotificationChannels = Field(default_factory=lambda: NotificationChannels(email=False, telegram=True))
    marketing: NotificationChannels = Field(default_factory=lambda: NotificationChannels(email=False, telegram=False))


class NotificationMatrixPatch(BaseModel):
    price_drop: NotificationChannelsPatch | None = None
    new_offers: NotificationChannelsPatch | None = None
    weekly_digest: NotificationChannelsPatch | None = None
    daily_deals: NotificationChannelsPatch | None = None
    marketing: NotificationChannelsPatch | None = None


class NotificationPreferences(BaseModel):
    price_drop_alerts: bool = True
    stock_alerts: bool = True
    weekly_digest: bool = False
    marketing_emails: bool = False
    public_profile: bool = False
    compact_view: bool = False
    channels: NotificationChannels = Field(default_factory=NotificationChannels)
    matrix: NotificationMatrix = Field(default_factory=NotificationMatrix)
    digest_frequency: Literal["daily", "weekly", "monthly"] = "weekly"
    interested_categories: list[str] = Field(default_factory=list)
    sms_alerts: bool = False


class NotificationPreferencesPatch(BaseModel):
    price_drop_alerts: bool | None = None
    stock_alerts: bool | None = None
    weekly_digest: bool | None = None
    marketing_emails: bool | None = None
    public_profile: bool | None = None
    compact_view: bool | None = None
    channels: NotificationChannelsPatch | None = None
    matrix: NotificationMatrixPatch | None = None
    digest_frequency: Literal["daily", "weekly", "monthly"] | None = None
    interested_categories: list[str] | None = None
    sms_alerts: bool | None = None


class UserCompareState(BaseModel):
    ids: list[str] = Field(default_factory=list)


class UserCompareStatePatch(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=COMPARE_LIMIT)


class TelegramConnectResponse(BaseModel):
    token: str
    expires_in: int = TELEGRAM_CONNECT_TTL_SECONDS
    deep_link: str


class DeleteAccountPayload(BaseModel):
    confirmation: str = Field(min_length=1, max_length=16)


class RecentlyViewedItem(BaseModel):
    id: str
    slug: str
    title: str
    min_price: float | None = None
    viewed_at: str


class RecentlyViewedUpsert(BaseModel):
    product_id: str = Field(pattern=UUID_REF_PATTERN)


def _clean_optional_text(value: str | None, *, max_length: int) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if len(cleaned) > max_length:
        raise HTTPException(status_code=422, detail=f"value exceeds {max_length} characters")
    return cleaned


async def _load_user_payload(redis: Redis, user_id: int) -> dict[str, str]:
    user_key = f"auth:user:{user_id}"
    payload = await redis.hgetall(user_key)
    if not payload:
        raise HTTPException(status_code=404, detail="user not found")
    await _ensure_user_uuid(redis, user_key=user_key, payload=payload)
    return payload


def _build_profile_response(payload: dict[str, str]) -> UserProfileOut:
    full_name = str(payload.get("full_name", "")).strip()
    display_name = str(payload.get("display_name", "")).strip() or full_name
    return UserProfileOut(
        id=str(payload["uuid"]),
        email=str(payload["email"]),
        full_name=full_name,
        display_name=display_name,
        phone=str(payload.get("phone", "")).strip(),
        city=str(payload.get("city", "")).strip(),
        telegram=str(payload.get("telegram", "")).strip(),
        about=str(payload.get("about", "")).strip(),
        updated_at=payload.get("updated_at"),
        created_at=payload.get("created_at"),
        last_login_at=payload.get("last_seen_at"),
    )


def _current_user_internal_id(current_user: dict) -> int:
    internal = current_user.get("internal_id")
    if internal is not None:
        try:
            return int(internal)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=401, detail="invalid user session") from exc
    # Backward compatibility for any old shape.
    fallback = current_user.get("id")
    try:
        return int(fallback)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="invalid user session") from exc


def _current_user_uuid(current_user: dict) -> str:
    user_uuid = str(current_user.get("id") or "").strip().lower()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="invalid user session")
    return user_uuid


def _auth_reads_from_postgres() -> bool:
    return settings.auth_storage_mode == "postgres"


def _to_float_or_none(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _map_price_alert_row(alert: CatalogPriceAlert, *, product_uuid: str) -> ProductPriceAlertOut:
    updated_at = alert.updated_at or datetime.now(UTC)
    return ProductPriceAlertOut(
        id=str(alert.uuid),
        product_id=product_uuid,
        channel=str(alert.channel),
        alerts_enabled=bool(alert.alerts_enabled),
        baseline_price=_to_float_or_none(alert.baseline_price),
        target_price=_to_float_or_none(alert.target_price),
        last_seen_price=_to_float_or_none(alert.last_seen_price),
        last_notified_at=alert.last_notified_at.isoformat() if alert.last_notified_at else None,
        updated_at=updated_at.isoformat(),
    )


def _default_notification_preferences() -> dict:
    return {
        "price_drop_alerts": True,
        "stock_alerts": True,
        "weekly_digest": False,
        "marketing_emails": False,
        "public_profile": False,
        "compact_view": False,
        "channels": {"email": True, "telegram": False},
        "matrix": {
            "price_drop": {"email": True, "telegram": True},
            "new_offers": {"email": True, "telegram": False},
            "weekly_digest": {"email": True, "telegram": False},
            "daily_deals": {"email": False, "telegram": True},
            "marketing": {"email": False, "telegram": False},
        },
        "digest_frequency": "weekly",
        "interested_categories": [],
        "sms_alerts": False,
    }


def _normalize_notification_preferences(payload: dict | None) -> NotificationPreferences:
    source = _default_notification_preferences()
    if payload:
        for field in ("price_drop_alerts", "stock_alerts", "weekly_digest", "marketing_emails", "public_profile", "compact_view"):
            if field in payload:
                source[field] = bool(payload[field])
        channels_payload = payload.get("channels")
        if isinstance(channels_payload, dict):
            source["channels"]["email"] = bool(channels_payload.get("email", source["channels"]["email"]))
            source["channels"]["telegram"] = bool(channels_payload.get("telegram", source["channels"]["telegram"]))
        matrix_payload = payload.get("matrix")
        if isinstance(matrix_payload, dict):
            for event in ("price_drop", "new_offers", "weekly_digest", "daily_deals", "marketing"):
                event_payload = matrix_payload.get(event)
                if not isinstance(event_payload, dict):
                    continue
                source["matrix"][event]["email"] = bool(event_payload.get("email", source["matrix"][event]["email"]))
                source["matrix"][event]["telegram"] = bool(
                    event_payload.get("telegram", source["matrix"][event]["telegram"])
                )
        digest_frequency = str(payload.get("digest_frequency") or "").strip().lower()
        if digest_frequency in {"daily", "weekly", "monthly"}:
            source["digest_frequency"] = digest_frequency
        interested_categories = payload.get("interested_categories")
        if isinstance(interested_categories, list):
            source["interested_categories"] = [str(item).strip() for item in interested_categories if str(item).strip()]
        if "sms_alerts" in payload:
            source["sms_alerts"] = bool(payload.get("sms_alerts"))
    return NotificationPreferences.model_validate(source)


def _merge_notification_preferences(current: NotificationPreferences, patch: NotificationPreferencesPatch) -> NotificationPreferences:
    data = current.model_dump()
    for field in ("price_drop_alerts", "stock_alerts", "weekly_digest", "marketing_emails", "public_profile", "compact_view"):
        incoming = getattr(patch, field)
        if incoming is not None:
            data[field] = incoming

    channels = dict(data.get("channels") or {"email": True, "telegram": False})
    if patch.channels is not None:
        if patch.channels.email is not None:
            channels["email"] = patch.channels.email
        if patch.channels.telegram is not None:
            channels["telegram"] = patch.channels.telegram
    data["channels"] = channels
    matrix = dict(data.get("matrix") or {})
    if patch.matrix is not None:
        for event in ("price_drop", "new_offers", "weekly_digest", "daily_deals", "marketing"):
            event_patch = getattr(patch.matrix, event)
            existing_event = dict(matrix.get(event) or {"email": False, "telegram": False})
            if event_patch is None:
                matrix[event] = existing_event
                continue
            if event_patch.email is not None:
                existing_event["email"] = event_patch.email
            if event_patch.telegram is not None:
                existing_event["telegram"] = event_patch.telegram
            matrix[event] = existing_event
    data["matrix"] = matrix
    if patch.digest_frequency is not None:
        data["digest_frequency"] = patch.digest_frequency
    if patch.interested_categories is not None:
        data["interested_categories"] = [str(item).strip() for item in patch.interested_categories if str(item).strip()]
    if patch.sms_alerts is not None:
        data["sms_alerts"] = patch.sms_alerts
    return NotificationPreferences.model_validate(data)


def _recently_viewed_key(user_id: int) -> str:
    return f"auth:recently-viewed:{user_id}"


def _compare_state_key(user_id: int) -> str:
    return f"auth:compare:{user_id}"


def _telegram_connect_key(token: str) -> str:
    return f"auth:telegram-connect:{token}"


def _normalize_compare_ids(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        candidate = str(raw or "").strip().lower()
        if not candidate or candidate in seen:
            continue
        if len(normalized) >= COMPARE_LIMIT:
            break
        if not candidate:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    return normalized


def _extract_min_price(product: dict) -> float | None:
    offers_by_store = product.get("offers_by_store")
    if not isinstance(offers_by_store, list):
        return None
    prices: list[float] = []
    for block in offers_by_store:
        if not isinstance(block, dict):
            continue
        value = block.get("minimal_price")
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        if numeric > 0:
            prices.append(numeric)
    return min(prices) if prices else None


async def _load_recently_viewed(redis: Redis, user_id: int) -> list[RecentlyViewedItem]:
    rows = await redis.lrange(_recently_viewed_key(user_id), 0, RECENTLY_VIEWED_LIMIT - 1)
    items: list[RecentlyViewedItem] = []
    for row in rows:
        try:
            payload = json.loads(row)
            items.append(RecentlyViewedItem.model_validate(payload))
        except Exception:
            continue
    return items


async def _persist_recently_viewed(redis: Redis, user_id: int, items: list[RecentlyViewedItem]) -> None:
    key = _recently_viewed_key(user_id)
    pipe = redis.pipeline()
    pipe.delete(key)
    serialized = [json.dumps(item.model_dump(), separators=(",", ":")) for item in items[:RECENTLY_VIEWED_LIMIT]]
    if serialized:
        pipe.rpush(key, *serialized)
    await pipe.execute()


async def _load_pg_user_or_404(db: AsyncSession, *, user_id: int) -> AuthUser:
    user = (
        await db.execute(
            select(AuthUser).where(AuthUser.id == user_id).limit(1)
        )
    ).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    return user


def _build_profile_response_from_pg(user: AuthUser) -> UserProfileOut:
    full_name = str(user.full_name or "").strip()
    display_name = str(user.display_name or "").strip() or full_name
    updated_at = user.updated_at.astimezone(UTC).isoformat() if user.updated_at else None
    created_at = user.created_at.astimezone(UTC).isoformat() if user.created_at else None
    last_login_at = user.last_seen_at.astimezone(UTC).isoformat() if user.last_seen_at else None
    return UserProfileOut(
        id=str(user.uuid),
        email=str(user.email),
        full_name=full_name,
        display_name=display_name,
        phone=str(user.phone or "").strip(),
        city=str(user.city or "").strip(),
        telegram=str(user.telegram or "").strip(),
        about=str(user.about or "").strip(),
        updated_at=updated_at,
        created_at=created_at,
        last_login_at=last_login_at,
    )


@router.get("/me/profile", response_model=UserProfileOut)
async def get_my_profile(
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    if _auth_reads_from_postgres():
        user = await _load_pg_user_or_404(db, user_id=_current_user_internal_id(current_user))
        return _build_profile_response_from_pg(user)
    payload = await _load_user_payload(redis, _current_user_internal_id(current_user))
    return _build_profile_response(payload)


@router.patch("/me/profile", response_model=UserProfileOut)
async def patch_my_profile(
    request: Request,
    profile_patch: UserProfilePatch,
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    current_user_id = _current_user_internal_id(current_user)
    async def _op():
        if _auth_reads_from_postgres():
            user = await _load_pg_user_or_404(db, user_id=current_user_id)
            updates: dict[str, str] = {}

            if profile_patch.email is not None:
                next_email = (_clean_optional_text(profile_patch.email, max_length=150) or "").lower()
                if "@" not in next_email:
                    raise HTTPException(status_code=422, detail="email is invalid")
                updates["email"] = next_email

            if profile_patch.display_name is not None:
                display_name = _clean_optional_text(profile_patch.display_name, max_length=120) or ""
                if len(display_name) < 2:
                    raise HTTPException(status_code=422, detail="display_name must be at least 2 characters")
                updates["display_name"] = display_name
                updates["full_name"] = display_name

            for field, max_length in (("phone", 32), ("city", 120), ("telegram", 64), ("about", 600)):
                incoming = getattr(profile_patch, field)
                if incoming is None:
                    continue
                updates[field] = _clean_optional_text(incoming, max_length=max_length) or ""

            if not updates:
                return _build_profile_response_from_pg(user)

            await db.execute(
                update(AuthUser)
                .where(AuthUser.id == current_user_id)
                .values(**updates, updated_at=datetime.now(UTC))
            )
            await db.commit()
            user = await _load_pg_user_or_404(db, user_id=current_user_id)
            return _build_profile_response_from_pg(user)

        payload = await _load_user_payload(redis, current_user_id)
        updates: dict[str, str] = {}
        previous_email = str(payload.get("email", "")).strip().lower()

        if profile_patch.email is not None:
            next_email = (_clean_optional_text(profile_patch.email, max_length=150) or "").lower()
            if "@" not in next_email:
                raise HTTPException(status_code=422, detail="email is invalid")
            updates["email"] = next_email

        if profile_patch.display_name is not None:
            display_name = _clean_optional_text(profile_patch.display_name, max_length=120) or ""
            if len(display_name) < 2:
                raise HTTPException(status_code=422, detail="display_name must be at least 2 characters")
            updates["display_name"] = display_name
            updates["full_name"] = display_name

        for field, max_length in (("phone", 32), ("city", 120), ("telegram", 64), ("about", 600)):
            incoming = getattr(profile_patch, field)
            if incoming is None:
                continue
            updates[field] = _clean_optional_text(incoming, max_length=max_length) or ""

        if not updates:
            return _build_profile_response(payload)

        updates["updated_at"] = datetime.now(UTC).isoformat()
        pipe = redis.pipeline()
        pipe.hset(f"auth:user:{current_user_id}", mapping=updates)
        next_email = str(updates.get("email", previous_email)).strip().lower()
        if previous_email and previous_email != next_email:
            pipe.delete(f"auth:user:email:{previous_email}")
            pipe.set(f"auth:user:email:{next_email}", str(current_user_id))
        await pipe.execute()
        payload = await _load_user_payload(redis, current_user_id)
        return _build_profile_response(payload)

    return await execute_idempotent_json(request, redis, scope=f"users.profile.patch:{current_user_id}", handler=_op)


@router.get("/favorites", response_model=list[FavoriteItem])
async def list_favorites(
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    key = f"auth:favorites:{_current_user_internal_id(current_user)}"
    items = await redis.smembers(key)
    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    favorites: list[FavoriteItem] = []
    seen: set[str] = set()
    for item in items:
        product = await repo.get_product(item, allow_numeric=True)
        if product is None:
            continue
        product_id = str(product["id"])
        if product_id in seen:
            continue
        seen.add(product_id)
        favorites.append(FavoriteItem(product_id=product_id))
    favorites.sort(key=lambda item: item.product_id)
    return favorites


@router.post("/favorites/{product_id}")
async def toggle_favorite(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    user_id = _current_user_internal_id(current_user)

    async def _op():
        key = f"auth:favorites:{user_id}"
        repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
        product = await repo.get_product(product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="product not found")

        canonical_product_id = str(product["id"])
        legacy_product_id = str(product["legacy_id"])

        exists = await redis.sismember(key, canonical_product_id)
        exists_legacy = await redis.sismember(key, legacy_product_id)
        if exists or exists_legacy:
            await redis.srem(key, canonical_product_id, legacy_product_id, str(product_id))
            return {"ok": True, "favorited": False}

        await redis.sadd(key, canonical_product_id)
        return {"ok": True, "favorited": True}

    return await execute_idempotent_json(request, redis, scope=f"users.favorites.toggle:{user_id}:{product_id}", handler=_op)


@router.get("/me/notification-preferences", response_model=NotificationPreferences)
async def get_notification_preferences(
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    user_id = _current_user_internal_id(current_user)
    if _auth_reads_from_postgres():
        user = await _load_pg_user_or_404(db, user_id=user_id)
        decoded = user.notification_preferences if isinstance(user.notification_preferences, dict) else None
        normalized = _normalize_notification_preferences(decoded)
        if not decoded:
            await db.execute(
                update(AuthUser)
                .where(AuthUser.id == user_id)
                .values(
                    notification_preferences=normalized.model_dump(),
                    updated_at=datetime.now(UTC),
                )
            )
            await db.commit()
        return normalized

    payload = await _load_user_payload(redis, user_id)
    raw = str(payload.get(NOTIFICATION_PREFERENCES_FIELD, "")).strip()
    decoded: dict | None = None
    if raw:
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                decoded = loaded
        except json.JSONDecodeError:
            decoded = None
    normalized = _normalize_notification_preferences(decoded)
    if not raw:
        await redis.hset(f"auth:user:{user_id}", mapping={NOTIFICATION_PREFERENCES_FIELD: json.dumps(normalized.model_dump())})
    return normalized


@router.patch("/me/notification-preferences", response_model=NotificationPreferences)
async def patch_notification_preferences(
    request: Request,
    patch: NotificationPreferencesPatch,
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    user_id = _current_user_internal_id(current_user)
    async def _op():
        if _auth_reads_from_postgres():
            user = await _load_pg_user_or_404(db, user_id=user_id)
            decoded = user.notification_preferences if isinstance(user.notification_preferences, dict) else None
            current_preferences = _normalize_notification_preferences(decoded)
            next_preferences = _merge_notification_preferences(current_preferences, patch)
            await db.execute(
                update(AuthUser)
                .where(AuthUser.id == user_id)
                .values(
                    notification_preferences=next_preferences.model_dump(),
                    updated_at=datetime.now(UTC),
                )
            )
            await db.commit()
            return next_preferences

        payload = await _load_user_payload(redis, user_id)
        raw = str(payload.get(NOTIFICATION_PREFERENCES_FIELD, "")).strip()
        decoded: dict | None = None
        if raw:
            try:
                loaded = json.loads(raw)
                if isinstance(loaded, dict):
                    decoded = loaded
            except json.JSONDecodeError:
                decoded = None
        current_preferences = _normalize_notification_preferences(decoded)
        next_preferences = _merge_notification_preferences(current_preferences, patch)
        await redis.hset(
            f"auth:user:{user_id}",
            mapping={
                NOTIFICATION_PREFERENCES_FIELD: json.dumps(next_preferences.model_dump()),
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )
        return next_preferences

    return await execute_idempotent_json(request, redis, scope=f"users.notifications.patch:{user_id}", handler=_op)


@router.get("/me/alerts", response_model=list[ProductPriceAlertOut])
async def list_my_price_alerts(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
    channel: str | None = Query(default=None, pattern="^(telegram|email)$"),
    active_only: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    user_uuid = _current_user_uuid(current_user)

    stmt = (
        select(CatalogPriceAlert, CatalogCanonicalProduct.uuid.label("product_uuid"))
        .join(CatalogCanonicalProduct, CatalogCanonicalProduct.id == CatalogPriceAlert.product_id)
        .where(CatalogPriceAlert.user_uuid == user_uuid)
        .order_by(CatalogPriceAlert.updated_at.desc(), CatalogPriceAlert.id.desc())
        .limit(limit)
        .offset(offset)
    )
    if channel:
        stmt = stmt.where(CatalogPriceAlert.channel == channel)
    if active_only:
        stmt = stmt.where(CatalogPriceAlert.alerts_enabled.is_(True))

    rows = (await db.execute(stmt)).all()
    return [_map_price_alert_row(alert, product_uuid=str(product_uuid)) for alert, product_uuid in rows]


@router.delete("/me/alerts/{alert_id}")
async def delete_my_price_alert(
    request: Request,
    alert_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    user_uuid = _current_user_uuid(current_user)

    async def _op():
        stmt = (
            select(CatalogPriceAlert)
            .where(CatalogPriceAlert.user_uuid == user_uuid)
            .where(CatalogPriceAlert.uuid == alert_id.lower())
            .limit(1)
        )
        alert = (await db.execute(stmt)).scalar_one_or_none()
        if alert is None:
            raise HTTPException(status_code=404, detail="alert not found")
        await db.delete(alert)
        await db.commit()
        return {"ok": True}

    return await execute_idempotent_json(request, redis, scope=f"users.alerts.delete:{user_uuid}:{alert_id.lower()}", handler=_op)


@router.get("/me/compare", response_model=UserCompareState)
async def get_compare_state(
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
):
    user_id = _current_user_internal_id(current_user)
    raw = await redis.get(_compare_state_key(user_id))
    if not raw:
        return UserCompareState(ids=[])
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError:
        return UserCompareState(ids=[])
    if not isinstance(decoded, list):
        return UserCompareState(ids=[])
    return UserCompareState(ids=_normalize_compare_ids([str(item) for item in decoded]))


@router.put("/me/compare", response_model=UserCompareState)
async def put_compare_state(
    request: Request,
    payload: UserCompareStatePatch,
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
):
    user_id = _current_user_internal_id(current_user)

    async def _op():
        normalized = _normalize_compare_ids(payload.ids)
        await redis.set(_compare_state_key(user_id), json.dumps(normalized), ex=60 * 60 * 24 * 30)
        return UserCompareState(ids=normalized)

    return await execute_idempotent_json(request, redis, scope=f"users.compare.put:{user_id}", handler=_op)


@router.post("/me/telegram-connect", response_model=TelegramConnectResponse)
async def create_telegram_connect_token(
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
):
    user_id = _current_user_internal_id(current_user)
    user_uuid = _current_user_uuid(current_user)
    token = secrets.token_urlsafe(24)
    payload = {
        "user_id": user_id,
        "user_uuid": user_uuid,
        "created_at": datetime.now(UTC).isoformat(),
    }
    await redis.set(_telegram_connect_key(token), json.dumps(payload), ex=TELEGRAM_CONNECT_TTL_SECONDS)
    bot_username = str(getattr(settings, "price_alerts_telegram_bot_username", "doxx_uz_alerts_bot") or "doxx_uz_alerts_bot").strip().lstrip("@")
    return TelegramConnectResponse(
        token=token,
        deep_link=f"https://t.me/{bot_username}?start={token}",
    )


@router.delete("/me/account")
async def soft_delete_my_account(
    request: Request,
    payload: DeleteAccountPayload,
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    confirmation = str(payload.confirmation or "").strip().upper()
    if confirmation not in {"ЎЧИРИШ", "OCHIRISH", "O'CHIRISH"}:
        raise HTTPException(status_code=422, detail="invalid confirmation")
    user_id = _current_user_internal_id(current_user)

    async def _op():
        now = datetime.now(UTC)
        stamp = int(now.timestamp())
        if _auth_reads_from_postgres():
            user = await _load_pg_user_or_404(db, user_id=user_id)
            if not user.is_active:
                return {"ok": True}
            tombstone_email = f"deleted+{user.id}-{stamp}@doxx.local"
            await db.execute(
                update(AuthUser)
                .where(AuthUser.id == user_id)
                .values(
                    is_active=False,
                    email=tombstone_email,
                    full_name="Deleted user",
                    display_name="Deleted user",
                    phone="",
                    city="",
                    telegram="",
                    about="",
                    notification_preferences={},
                    updated_at=now,
                    last_seen_at=now,
                )
            )
            await db.execute(
                update(AuthSession)
                .where(AuthSession.user_id == user_id)
                .where(AuthSession.revoked_at.is_(None))
                .values(revoked_at=now)
            )
            await db.execute(
                update(AuthSessionToken)
                .where(AuthSessionToken.user_id == user_id)
                .where(AuthSessionToken.revoked_at.is_(None))
                .values(revoked_at=now)
            )
            await db.commit()
            return {"ok": True}

        payload_user = await _load_user_payload(redis, user_id)
        original_email = str(payload_user.get("email", "")).strip().lower()
        tombstone_email = f"deleted+{user_id}-{stamp}@doxx.local"
        updates = {
            "email": tombstone_email,
            "is_active": "0",
            "full_name": "Deleted user",
            "display_name": "Deleted user",
            "phone": "",
            "city": "",
            "telegram": "",
            "about": "",
            NOTIFICATION_PREFERENCES_FIELD: json.dumps({}),
            "updated_at": now.isoformat(),
            "last_seen_at": now.isoformat(),
        }
        pipe = redis.pipeline()
        pipe.hset(f"auth:user:{user_id}", mapping=updates)
        pipe.delete(_compare_state_key(user_id))
        pipe.delete(f"auth:favorites:{user_id}")
        if original_email:
            pipe.delete(f"auth:user:email:{original_email}")
        pipe.set(f"auth:user:email:{tombstone_email}", str(user_id))
        await pipe.execute()
        return {"ok": True}

    return await execute_idempotent_json(request, redis, scope=f"users.account.delete:{user_id}", handler=_op)


@router.get("/me/recently-viewed", response_model=list[RecentlyViewedItem])
async def get_recently_viewed(current_user: dict = Depends(get_current_user), redis: Redis = Depends(get_redis)):
    user_id = _current_user_internal_id(current_user)
    return await _load_recently_viewed(redis, user_id)


@router.post("/me/recently-viewed", response_model=RecentlyViewedItem)
async def push_recently_viewed(
    request: Request,
    payload: RecentlyViewedUpsert,
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    user_id = _current_user_internal_id(current_user)
    async def _op():
        repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
        product = await repo.get_product(payload.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="product not found")

        next_item = RecentlyViewedItem(
            id=str(product["id"]),
            slug=str(product.get("slug") or product["id"]),
            title=str(product.get("title") or ""),
            min_price=_extract_min_price(product),
            viewed_at=datetime.now(UTC).isoformat(),
        )

        existing = await _load_recently_viewed(redis, user_id)
        updated = [next_item, *[item for item in existing if item.id != next_item.id]]
        await _persist_recently_viewed(redis, user_id, updated)
        return next_item

    return await execute_idempotent_json(request, redis, scope=f"users.recently_viewed.push:{user_id}:{payload.product_id.lower()}", handler=_op)


@router.delete("/me/recently-viewed")
async def clear_recently_viewed(
    request: Request,
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
):
    user_id = _current_user_internal_id(current_user)
    async def _op():
        await redis.delete(_recently_viewed_key(user_id))
        return {"ok": True}

    return await execute_idempotent_json(request, redis, scope=f"users.recently_viewed.clear:{user_id}", handler=_op)

