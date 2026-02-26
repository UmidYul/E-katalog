from __future__ import annotations

from typing import Any

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import logger
from app.platform.services.canonical_matching import canonical_key, extract_attributes
from app.platform.services.pipeline_offsets import ensure_offsets_table, get_offset, set_offset


def _cache_key(canonical_key_value: str) -> str:
    normalized = str(canonical_key_value or "").strip().lower()
    return f"{settings.canonical_index_cache_prefix}:k:{normalized}"


async def _redis_client() -> Redis | None:
    if not settings.canonical_index_cache_enabled:
        return None
    return Redis.from_url(settings.redis_url, decode_responses=True)


async def _redis_close(redis: Redis | None) -> None:
    if redis is None:
        return
    if hasattr(redis, "aclose"):
        await redis.aclose()
    else:
        await redis.close()


async def resolve_canonical_by_key(session: AsyncSession, *, canonical_key_value: str) -> int | None:
    normalized = str(canonical_key_value or "").strip().lower()
    if not normalized:
        return None

    redis = await _redis_client()
    try:
        if redis is not None:
            cached = await redis.get(_cache_key(normalized))
            if cached and cached.isdigit():
                return int(cached)

        row = (
            await session.execute(
                text(
                    """
                    select idx.canonical_product_id
                    from catalog_canonical_key_index idx
                    join catalog_canonical_products cp on cp.id = idx.canonical_product_id
                    where idx.canonical_key = :canonical_key
                      and cp.is_active = true
                    limit 1
                    """
                ),
                {"canonical_key": normalized},
            )
        ).first()
        if row is None:
            return None
        canonical_product_id = int(row[0])
        if redis is not None:
            await redis.set(
                _cache_key(normalized),
                str(canonical_product_id),
                ex=max(300, int(settings.canonical_index_cache_ttl_seconds)),
            )
        return canonical_product_id
    finally:
        await _redis_close(redis)


async def upsert_canonical_index_entry(
    session: AsyncSession,
    *,
    canonical_product_id: int,
    canonical_title: str,
    source: str = "normalize",
) -> str:
    attrs = extract_attributes(canonical_title)
    key_value = canonical_key(attrs).strip().lower()
    if not key_value:
        return ""

    payload = {
        "canonical_key": key_value,
        "canonical_product_id": int(canonical_product_id),
        "brand": attrs.brand,
        "model": attrs.model,
        "storage": attrs.storage,
        "source": str(source or "normalize").strip().lower()[:32] or "normalize",
    }
    await session.execute(
        text(
            """
            insert into catalog_canonical_key_index
              (canonical_key, canonical_product_id, brand, model, storage, source, created_at, updated_at)
            values
              (
                :canonical_key,
                :canonical_product_id,
                :brand,
                :model,
                :storage,
                :source,
                now(),
                now()
              )
            on conflict (canonical_key) do update
              set canonical_product_id = excluded.canonical_product_id,
                  brand = excluded.brand,
                  model = excluded.model,
                  storage = excluded.storage,
                  source = excluded.source,
                  updated_at = now()
            """
        ),
        payload,
    )

    redis = await _redis_client()
    try:
        if redis is not None:
            await redis.set(
                _cache_key(key_value),
                str(canonical_product_id),
                ex=max(300, int(settings.canonical_index_cache_ttl_seconds)),
            )
    finally:
        await _redis_close(redis)

    return key_value


async def rebuild_canonical_key_index(session: AsyncSession, *, limit: int = 50000) -> dict[str, Any]:
    rows = (
        await session.execute(
            text(
                """
                select cp.id, cp.normalized_title
                from catalog_canonical_products cp
                where cp.is_active = true
                order by cp.id asc
                limit :limit
                """
            ),
            {"limit": max(1, int(limit))},
        )
    ).all()

    indexed = 0
    skipped = 0
    for row in rows:
        canonical_id = int(row.id)
        title = str(row.normalized_title or "").strip()
        if not title:
            skipped += 1
            continue
        key_value = await upsert_canonical_index_entry(
            session,
            canonical_product_id=canonical_id,
            canonical_title=title,
            source="rebuild",
        )
        if key_value:
            indexed += 1
        else:
            skipped += 1

    logger.info("canonical_index_rebuilt", indexed=indexed, skipped=skipped, limit=max(1, int(limit)))
    return {"indexed": indexed, "skipped": skipped, "limit": max(1, int(limit))}


async def sync_canonical_key_index_batch(
    session: AsyncSession,
    *,
    limit: int = 5000,
    reset_offset: bool = False,
) -> dict[str, Any]:
    await ensure_offsets_table(session)
    job_name = "canonical_key_index"
    if reset_offset:
        last_ts = None
        last_id = 0
    else:
        last_ts, last_id = await get_offset(session, job_name)

    params: dict[str, Any] = {"limit": max(100, int(limit))}
    where_clause = ""
    if last_ts is not None:
        where_clause = "and (cp.updated_at > :last_ts or (cp.updated_at = :last_ts and cp.id > :last_id))"
        params["last_ts"] = last_ts
        params["last_id"] = int(last_id)

    rows = (
        await session.execute(
            text(
                f"""
                select cp.id, cp.normalized_title, cp.updated_at
                from catalog_canonical_products cp
                where cp.is_active = true
                {where_clause}
                order by cp.updated_at asc, cp.id asc
                limit :limit
                """
            ),
            params,
        )
    ).all()

    indexed = 0
    skipped = 0
    watermark_ts = last_ts
    watermark_id = int(last_id)
    for row in rows:
        canonical_id = int(row.id)
        title = str(row.normalized_title or "").strip()
        if not title:
            skipped += 1
        else:
            key_value = await upsert_canonical_index_entry(
                session,
                canonical_product_id=canonical_id,
                canonical_title=title,
                source="sync",
            )
            if key_value:
                indexed += 1
            else:
                skipped += 1
        watermark_ts = row.updated_at
        watermark_id = canonical_id

    if rows:
        await set_offset(session, job_name, last_ts=watermark_ts, last_id=watermark_id)

    has_more = len(rows) >= int(params["limit"])
    logger.info(
        "canonical_index_sync_batch_completed",
        indexed=indexed,
        skipped=skipped,
        limit=int(params["limit"]),
        has_more=has_more,
        reset_offset=bool(reset_offset),
    )
    return {
        "indexed": indexed,
        "skipped": skipped,
        "processed": len(rows),
        "limit": int(params["limit"]),
        "has_more": has_more,
    }
