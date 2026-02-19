from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from redis.asyncio import Redis

from app.api.deps import get_redis
from app.api.v1.routers.auth import get_current_user

router = APIRouter(prefix="/users", tags=["users"])


class FavoriteItem(BaseModel):
    product_id: int


@router.get("/favorites", response_model=list[FavoriteItem])
async def list_favorites(current_user: dict = Depends(get_current_user), redis: Redis = Depends(get_redis)):
    key = f"auth:favorites:{current_user['id']}"
    items = await redis.smembers(key)
    return [FavoriteItem(product_id=int(item)) for item in sorted(items, key=lambda x: int(x))]


@router.post("/favorites/{product_id}")
async def toggle_favorite(product_id: int, current_user: dict = Depends(get_current_user), redis: Redis = Depends(get_redis)):
    key = f"auth:favorites:{current_user['id']}"
    exists = await redis.sismember(key, str(product_id))
    if exists:
        await redis.srem(key, str(product_id))
        return {"ok": True, "favorited": False}

    await redis.sadd(key, str(product_id))
    return {"ok": True, "favorited": True}
