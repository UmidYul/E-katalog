from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import secrets
from decimal import Decimal, InvalidOperation
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import urljoin

from fastapi import APIRouter, Depends, HTTPException, Query, Response
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
from app.services.worker_client import enqueue_full_catalog_rebuild
from app.services.worker_client import enqueue_ingested_products_pipeline
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


class ProductsImportIn(BaseModel):
    source: Literal["csv", "json"]
    content: str
    store_id: int | None = None


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


async def _resolve_default_store_id(db: AsyncSession, explicit_store_id: int | None) -> int:
    if explicit_store_id is not None:
        exists = (
            await db.execute(text("select id from catalog_stores where id = :id"), {"id": explicit_store_id})
        ).scalar_one_or_none()
        if exists is None:
            raise HTTPException(status_code=422, detail=f"store_id {explicit_store_id} not found")
        return int(exists)

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
async def import_products(
    payload: ProductsImportIn,
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, Any]:
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


@router.post("/catalog/rebuild")
async def run_catalog_rebuild() -> dict:
    task_id = enqueue_full_catalog_rebuild()
    return {"task_id": task_id, "queued": "catalog_rebuild"}


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
