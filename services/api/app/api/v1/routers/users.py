from __future__ import annotations

import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.v1.routers.auth import _ensure_user_uuid, get_current_user
from app.core.config import settings
from app.repositories.catalog import CatalogRepository
from app.schemas.catalog import ProductPriceAlertOut
from shared.db.models import AuthUser, CatalogCanonicalProduct, CatalogPriceAlert

router = APIRouter(prefix="/users", tags=["users"])
UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
RECENTLY_VIEWED_LIMIT = 30
NOTIFICATION_PREFERENCES_FIELD = "notification_preferences"


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


class UserProfilePatch(BaseModel):
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


class NotificationPreferences(BaseModel):
    price_drop_alerts: bool = True
    stock_alerts: bool = True
    weekly_digest: bool = False
    marketing_emails: bool = False
    public_profile: bool = False
    compact_view: bool = False
    channels: NotificationChannels = Field(default_factory=NotificationChannels)


class NotificationPreferencesPatch(BaseModel):
    price_drop_alerts: bool | None = None
    stock_alerts: bool | None = None
    weekly_digest: bool | None = None
    marketing_emails: bool | None = None
    public_profile: bool | None = None
    compact_view: bool | None = None
    channels: NotificationChannelsPatch | None = None


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
    return NotificationPreferences.model_validate(data)


def _recently_viewed_key(user_id: int) -> str:
    return f"auth:recently-viewed:{user_id}"


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
    profile_patch: UserProfilePatch,
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    current_user_id = _current_user_internal_id(current_user)
    if _auth_reads_from_postgres():
        user = await _load_pg_user_or_404(db, user_id=current_user_id)
        updates: dict[str, str] = {}

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
    await redis.hset(f"auth:user:{current_user_id}", mapping=updates)
    payload = await _load_user_payload(redis, current_user_id)
    return _build_profile_response(payload)


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
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    key = f"auth:favorites:{_current_user_internal_id(current_user)}"
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
    patch: NotificationPreferencesPatch,
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    user_id = _current_user_internal_id(current_user)
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
    alert_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    user_uuid = _current_user_uuid(current_user)
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


@router.get("/me/recently-viewed", response_model=list[RecentlyViewedItem])
async def get_recently_viewed(current_user: dict = Depends(get_current_user), redis: Redis = Depends(get_redis)):
    user_id = _current_user_internal_id(current_user)
    return await _load_recently_viewed(redis, user_id)


@router.post("/me/recently-viewed", response_model=RecentlyViewedItem)
async def push_recently_viewed(
    payload: RecentlyViewedUpsert,
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    user_id = _current_user_internal_id(current_user)
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


@router.delete("/me/recently-viewed")
async def clear_recently_viewed(current_user: dict = Depends(get_current_user), redis: Redis = Depends(get_redis)):
    user_id = _current_user_internal_id(current_user)
    await redis.delete(_recently_viewed_key(user_id))
    return {"ok": True}
