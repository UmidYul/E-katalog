from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.v1.routers.auth import _ensure_user_uuid, get_current_user
from app.core.config import settings
from app.repositories.catalog import CatalogRepository

router = APIRouter(prefix="/users", tags=["users"])
UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"


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


@router.get("/me/profile", response_model=UserProfileOut)
async def get_my_profile(current_user: dict = Depends(get_current_user), redis: Redis = Depends(get_redis)):
    payload = await _load_user_payload(redis, _current_user_internal_id(current_user))
    return _build_profile_response(payload)


@router.patch("/me/profile", response_model=UserProfileOut)
async def patch_my_profile(
    profile_patch: UserProfilePatch,
    current_user: dict = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
):
    current_user_id = _current_user_internal_id(current_user)
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
