from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.v1.routers.auth import get_current_user
from app.services.worker_client import enqueue_dedupe_batches
from app.services.worker_client import enqueue_embedding_batches
from app.services.worker_client import enqueue_full_crawl
from app.services.worker_client import enqueue_reindex_batches
from app.services.worker_client import get_task_status

def require_admin(user: dict = Depends(get_current_user)) -> dict:
    role = str(user.get("role", "")).lower()
    if role != "admin":
        raise HTTPException(status_code=403, detail="admin access required")
    return user


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


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
    parent_id: int | None = None


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
    product_ids: list[int]


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "store"


async def _invalidate_product_caches(redis: Redis) -> None:
    keys = [key async for key in redis.scan_iter(match="plp:*")]
    keys.extend([key async for key in redis.scan_iter(match="pdp:*")])
    if keys:
        await redis.delete(*keys)


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


@router.get("/users", response_model=PaginatedOut)
async def list_users(
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
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
        row = {
            "id": int(payload["id"]),
            "email": payload.get("email"),
            "full_name": payload.get("full_name", ""),
            "role": payload.get("role", "moderator"),
            "is_active": payload.get("is_active", "true") == "true",
            "created_at": payload.get("created_at", datetime.now(UTC).isoformat()),
            "last_seen_at": payload.get("last_seen_at"),
        }
        if q and q.lower() not in f"{row['email']} {row['full_name']}".lower():
            continue
        rows.append(row)

    start = (page - 1) * limit
    items = rows[start : start + limit]
    return {"items": items, "next_cursor": None, "request_id": "admin-users"}


@router.get("/users/{user_id}")
async def get_user(user_id: int, redis: Redis = Depends(get_redis)) -> dict[str, Any]:
    payload = await redis.hgetall(f"auth:user:{user_id}")
    if not payload:
        raise HTTPException(status_code=404, detail="user not found")
    return {
        "id": int(payload["id"]),
        "email": payload.get("email"),
        "full_name": payload.get("full_name", ""),
        "role": payload.get("role", "moderator"),
        "is_active": payload.get("is_active", "true") == "true",
        "created_at": payload.get("created_at", datetime.now(UTC).isoformat()),
        "last_seen_at": payload.get("last_seen_at"),
    }


@router.patch("/users/{user_id}")
async def patch_user(user_id: int, payload: dict[str, Any], redis: Redis = Depends(get_redis)) -> dict[str, Any]:
    key = f"auth:user:{user_id}"
    current = await redis.hgetall(key)
    if not current:
        raise HTTPException(status_code=404, detail="user not found")
    updates: dict[str, str] = {}
    if "full_name" in payload:
        updates["full_name"] = str(payload["full_name"])
    if "role" in payload:
        updates["role"] = str(payload["role"])
    if "is_active" in payload:
        updates["is_active"] = "true" if bool(payload["is_active"]) else "false"
    if updates:
        await redis.hset(key, mapping=updates)
    return await get_user(user_id, redis)


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, redis: Redis = Depends(get_redis)) -> dict[str, bool]:
    key = f"auth:user:{user_id}"
    payload = await redis.hgetall(key)
    if payload:
        email = payload.get("email")
        if email:
            await redis.delete(f"auth:user:email:{email}")
        await redis.delete(key)
    return {"ok": True}


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
            s.id,
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
async def create_store(payload: StoreCreate, db: AsyncSession = Depends(get_db_session)) -> dict[str, Any]:
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
                        id, slug, name, provider, base_url, country_code, is_active, trust_score, crawl_priority
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
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="store with same id/slug already exists")
    if not row:
        raise HTTPException(status_code=500, detail="failed to create store")
    return {**dict(row), "sources_count": 0}


@router.patch("/stores/{store_id}")
async def patch_store(store_id: int, payload: StorePatch, db: AsyncSession = Depends(get_db_session)) -> dict[str, Any]:
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
            "id": store_id,
            "name": payload.name,
            "slug": payload.slug,
            "provider": payload.provider.lower() if payload.provider else None,
            "base_url": payload.base_url,
            "country_code": payload.country_code.upper() if payload.country_code else None,
            "trust_score": payload.trust_score,
            "crawl_priority": payload.crawl_priority,
            "is_active": payload.is_active,
        },
    )
    await db.commit()
    row = (
        await db.execute(
            text(
                """
                select
                    s.id, s.slug, s.name, s.provider, s.base_url, s.country_code, s.is_active, s.trust_score, s.crawl_priority,
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
            {"id": store_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="store not found")
    return dict(row)


@router.delete("/stores/{store_id}")
async def delete_store(store_id: int, db: AsyncSession = Depends(get_db_session)) -> dict[str, bool]:
    await db.execute(text("delete from catalog_stores where id = :id"), {"id": store_id})
    await db.commit()
    return {"ok": True}


@router.get("/stores/{store_id}/sources", response_model=PaginatedOut)
async def list_store_sources(
    store_id: int,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    exists = (await db.execute(text("select 1 from catalog_stores where id = :id"), {"id": store_id})).scalar_one_or_none()
    if not exists:
        raise HTTPException(status_code=404, detail="store not found")
    rows = (
        await db.execute(
            text(
                """
                select id, store_id, url, source_type, is_active, priority, created_at, updated_at
                from catalog_scrape_sources
                where store_id = :store_id
                order by priority asc, id asc
                offset :offset
                limit :limit
                """
            ),
            {"store_id": store_id, "offset": (page - 1) * limit, "limit": limit},
        )
    ).mappings().all()
    return {"items": [dict(row) for row in rows], "next_cursor": None, "request_id": "admin-store-sources"}


@router.post("/stores/{store_id}/sources")
async def create_store_source(store_id: int, payload: ScrapeSourceCreate, db: AsyncSession = Depends(get_db_session)) -> dict[str, Any]:
    exists = (await db.execute(text("select 1 from catalog_stores where id = :id"), {"id": store_id})).scalar_one_or_none()
    if not exists:
        raise HTTPException(status_code=404, detail="store not found")
    normalized_url, normalized_type = await _normalize_source_payload(
        db,
        store_id=store_id,
        url_value=payload.url,
        source_type=payload.source_type,
    )
    row = (
        await db.execute(
            text(
                """
                insert into catalog_scrape_sources (store_id, url, source_type, is_active, priority)
                values (:store_id, :url, :source_type, :is_active, :priority)
                returning id, store_id, url, source_type, is_active, priority, created_at, updated_at
                """
            ),
            {
                "store_id": store_id,
                "url": normalized_url,
                "source_type": normalized_type,
                "is_active": payload.is_active,
                "priority": payload.priority,
            },
        )
    ).mappings().first()
    await db.commit()
    if not row:
        raise HTTPException(status_code=500, detail="failed to create source")
    return dict(row)


@router.patch("/stores/{store_id}/sources/{source_id}")
async def patch_store_source(
    store_id: int,
    source_id: int,
    payload: ScrapeSourcePatch,
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    current = (
        await db.execute(
            text("select url, source_type from catalog_scrape_sources where id = :source_id and store_id = :store_id"),
            {"source_id": source_id, "store_id": store_id},
        )
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="source not found")
    normalized_url, normalized_type = await _normalize_source_payload(
        db,
        store_id=store_id,
        url_value=payload.url if payload.url is not None else current["url"],
        source_type=payload.source_type if payload.source_type is not None else current["source_type"],
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
            "source_id": source_id,
            "store_id": store_id,
            "url": normalized_url,
            "source_type": normalized_type,
            "is_active": payload.is_active,
            "priority": payload.priority,
        },
    )
    await db.commit()
    row = (
        await db.execute(
            text(
                """
                select id, store_id, url, source_type, is_active, priority, created_at, updated_at
                from catalog_scrape_sources
                where id = :source_id and store_id = :store_id
                """
            ),
            {"source_id": source_id, "store_id": store_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="source not found")
    return dict(row)


@router.delete("/stores/{store_id}/sources/{source_id}")
async def delete_store_source(store_id: int, source_id: int, db: AsyncSession = Depends(get_db_session)) -> dict[str, bool]:
    await db.execute(
        text("delete from catalog_scrape_sources where id = :source_id and store_id = :store_id"),
        {"source_id": source_id, "store_id": store_id},
    )
    await db.commit()
    return {"ok": True}


@router.post("/categories")
async def create_category(payload: CategoryCreate, db: AsyncSession = Depends(get_db_session)) -> dict[str, Any]:
    inserted = (
        await db.execute(
            text(
                """
                insert into catalog_categories (slug, name_uz, parent_id, lft, rgt, is_active)
                values (:slug, :name, :parent_id, 0, 0, true)
                returning id, slug, name_uz, parent_id, is_active
                """
            ),
            {"slug": payload.slug, "name": payload.name, "parent_id": payload.parent_id},
        )
    ).mappings().first()
    await db.commit()
    if not inserted:
        raise HTTPException(status_code=500, detail="failed to create category")
    return {
        "id": inserted["id"],
        "slug": inserted["slug"],
        "name": inserted["name_uz"],
        "parent_id": inserted["parent_id"],
        "is_active": inserted["is_active"],
    }


@router.patch("/categories/{category_id}")
async def patch_category(category_id: int, payload: dict[str, Any], db: AsyncSession = Depends(get_db_session)) -> dict[str, Any]:
    await db.execute(
        text(
            """
            update catalog_categories
            set slug = coalesce(:slug, slug),
                name_uz = coalesce(:name_uz, name_uz),
                parent_id = coalesce(:parent_id, parent_id)
            where id = :id
            """
        ),
        {"id": category_id, "slug": payload.get("slug"), "name_uz": payload.get("name"), "parent_id": payload.get("parent_id")},
    )
    await db.commit()
    row = (
        await db.execute(
            text("select id, slug, name_uz, parent_id, is_active from catalog_categories where id = :id"),
            {"id": category_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="category not found")
    return {"id": row["id"], "slug": row["slug"], "name": row["name_uz"], "parent_id": row["parent_id"], "is_active": row["is_active"]}


@router.delete("/categories/{category_id}")
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db_session)) -> dict[str, bool]:
    await db.execute(text("delete from catalog_categories where id = :id"), {"id": category_id})
    await db.commit()
    return {"ok": True}


@router.patch("/products/{product_id}")
async def patch_product(product_id: int, payload: dict[str, Any], db: AsyncSession = Depends(get_db_session)) -> dict[str, Any]:
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
        {"id": product_id, "title": payload.get("normalized_title"), "main_image": payload.get("main_image"), "specs": payload.get("specs")},
    )
    await db.commit()
    return {"ok": True}


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: int, db: AsyncSession = Depends(get_db_session), redis: Redis = Depends(get_redis)
) -> dict[str, bool]:
    await db.execute(text("delete from catalog_canonical_products where id = :id"), {"id": product_id})
    await db.commit()
    await _invalidate_product_caches(redis)
    return {"ok": True}


@router.post("/products/bulk-delete")
async def bulk_delete_products(
    payload: ProductsBulkDeleteIn,
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
    product_ids = sorted({int(item) for item in payload.product_ids if int(item) > 0})
    if not product_ids:
        raise HTTPException(status_code=422, detail="product_ids must contain at least one positive id")

    deleted_count = (
        await db.execute(
            text("delete from catalog_canonical_products where id = any(cast(:product_ids as bigint[]))"),
            {"product_ids": product_ids},
        )
    ).rowcount or 0
    await db.commit()
    await _invalidate_product_caches(redis)
    return {"ok": True, "requested": len(product_ids), "deleted": int(deleted_count)}


@router.post("/products/import")
async def import_products(_payload: dict[str, Any]) -> dict[str, bool]:
    return {"ok": True}


@router.get("/products/export")
async def export_products(format: str = Query(default="csv")) -> dict[str, str]:
    return {"url": f"/exports/products.{format}"}


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
        seed = [
            {"id": 1, "user_id": 1, "total_amount": 12500000, "currency": "UZS", "status": "new", "created_at": datetime.now(UTC).isoformat()},
            {"id": 2, "user_id": 2, "total_amount": 8990000, "currency": "UZS", "status": "processing", "created_at": datetime.now(UTC).isoformat()},
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
async def get_order(order_id: int, redis: Redis = Depends(get_redis)) -> dict[str, Any]:
    rows = await list_orders(page=1, limit=500, redis=redis)
    for row in rows["items"]:
        if int(row["id"]) == order_id:
            return row
    raise HTTPException(status_code=404, detail="order not found")


@router.patch("/orders/{order_id}")
async def patch_order(order_id: int, payload: OrderStatusPatch, redis: Redis = Depends(get_redis)) -> dict[str, Any]:
    key = "admin:orders"
    raw_rows = await redis.lrange(key, 0, -1)
    next_rows: list[str] = []
    target: dict[str, Any] | None = None
    for raw in raw_rows:
        row = json.loads(raw)
        if int(row["id"]) == order_id:
            row["status"] = payload.status
            target = row
        next_rows.append(json.dumps(row, ensure_ascii=False))
    if target is None:
        raise HTTPException(status_code=404, detail="order not found")
    await redis.delete(key)
    if next_rows:
        await redis.rpush(key, *next_rows)
    return target


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
    return {
        "total_users": users_count,
        "total_orders": orders_count,
        "total_products": int(products_count),
        "revenue": revenue,
        "trend": [{"label": f"D{i}", "value": int(revenue / max(i, 1) / 100000)} for i in range(1, 8)],
        "recent_activity": [
            {"id": secrets.token_hex(4), "title": "Daily sync completed", "timestamp": datetime.now(UTC).isoformat()},
            {"id": secrets.token_hex(4), "title": f"Period: {period}", "timestamp": datetime.now(UTC).isoformat()},
        ],
    }


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
async def patch_settings(payload: SettingsPatch, redis: Redis = Depends(get_redis)) -> dict[str, Any]:
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
    return await get_settings(redis)


@router.post("/reindex/products")
async def reindex_products() -> dict:
    task_id = enqueue_reindex_batches()
    return {"task_id": task_id, "queued": "reindex"}


@router.post("/embeddings/rebuild")
async def rebuild_embeddings() -> dict:
    task_id = enqueue_embedding_batches()
    return {"task_id": task_id, "queued": "embedding"}


@router.post("/dedupe/run")
async def run_dedupe() -> dict:
    task_id = enqueue_dedupe_batches()
    return {"task_id": task_id, "queued": "dedupe"}


@router.post("/scrape/run")
async def run_scrape() -> dict:
    task_id = enqueue_full_crawl()
    return {"task_id": task_id, "queued": "scrape"}


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
