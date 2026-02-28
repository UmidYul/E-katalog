from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.idempotency import execute_idempotent_json
from app.api.rbac import require_roles
from app.core.rate_limit import enforce_rate_limit
from app.schemas.seller import (
    SellerInventoryLogListOut,
    SellerInventoryLogOut,
    SellerProductCreateIn,
    SellerProductOut,
    SellerProductPatchIn,
    SellerProductStatusEventListOut,
    SellerProductStockPatchIn,
)
from app.services.seller_product_timeline_service import (
    list_seller_product_status_events,
    record_seller_product_status_event,
)


router = APIRouter(prefix="/seller/products", tags=["seller-products"])

UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
SELLER_MUTABLE_PRODUCT_STATUSES = {"draft", "pending_moderation", "archived"}


async def get_current_seller_user(current_user: dict = Depends(require_roles("seller", detail="seller access required"))) -> dict:
    return current_user


async def _resolve_shop(db: AsyncSession, *, user_uuid: str) -> dict:
    row = (
        await db.execute(
            text(
                """
                select id, uuid
                from seller_shops
                where owner_user_uuid = cast(:user_uuid as uuid)
                order by updated_at desc, id desc
                limit 1
                """
            ),
            {"user_uuid": str(user_uuid).strip().lower()},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="seller shop not found")
    return {"id": int(row["id"]), "uuid": str(row["uuid"])}


def _serialize_product(row: dict) -> SellerProductOut:
    return SellerProductOut(
        id=str(row["uuid"]),
        shop_id=str(row["shop_uuid"]),
        source=str(row.get("source") or "manual"),
        title=str(row["title"]),
        description=row.get("description"),
        category_id=str(row["category_uuid"]) if row.get("category_uuid") else None,
        images=row.get("images") if isinstance(row.get("images"), list) else [],
        price=float(row.get("price") or 0.0),
        old_price=float(row.get("old_price")) if row.get("old_price") is not None else None,
        sku=row.get("sku"),
        barcode=row.get("barcode"),
        status=str(row.get("status") or "draft"),
        moderation_comment=row.get("moderation_comment"),
        track_inventory=bool(row.get("track_inventory")),
        stock_quantity=int(row.get("stock_quantity") or 0),
        stock_reserved=int(row.get("stock_reserved") or 0),
        stock_alert_threshold=int(row.get("stock_alert_threshold")) if row.get("stock_alert_threshold") is not None else None,
        attributes=row.get("attributes") if isinstance(row.get("attributes"), dict) else {},
        views_count=int(row.get("views_count") or 0),
        clicks_count=int(row.get("clicks_count") or 0),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _serialize_inventory_item(row: dict) -> SellerInventoryLogOut:
    return SellerInventoryLogOut(
        id=int(row["id"]),
        product_id=str(row["product_uuid"]),
        action=str(row["action"]),
        quantity_before=int(row["quantity_before"]),
        quantity_after=int(row["quantity_after"]),
        delta=int(row["delta"]),
        reference_id=str(row["reference_id"]) if row.get("reference_id") else None,
        comment=row.get("comment"),
        created_by_user_id=str(row["created_by_user_uuid"]) if row.get("created_by_user_uuid") else None,
        created_at=str(row["created_at"]),
    )


def _payload_fingerprint(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def _normalize_uuid(value: str | None) -> str | None:
    normalized = str(value or "").strip().lower()
    return normalized or None


def _status_change_reason_for_seller(status: str) -> str:
    if status == "draft":
        return "seller_saved_draft"
    if status == "pending_moderation":
        return "seller_submitted_for_moderation"
    if status == "archived":
        return "seller_archived"
    return "seller_status_change"


def _has_significant_changes(payload: SellerProductPatchIn, current: dict) -> bool:
    if payload.title is not None and payload.title.strip() != str(current.get("title") or "").strip():
        return True

    if payload.price is not None:
        current_price = float(current.get("price") or 0.0)
        if float(payload.price) != current_price:
            return True

    if payload.category_id is not None:
        current_category = _normalize_uuid(str(current.get("category_uuid") or ""))
        if _normalize_uuid(payload.category_id) != current_category:
            return True

    if payload.images is not None:
        current_images = current.get("images") if isinstance(current.get("images"), list) else []
        if payload.images != current_images:
            return True

    return False


async def _load_product_row(db: AsyncSession, *, shop_id: int, product_uuid: str) -> dict | None:
    row = (
        await db.execute(
            text(
                """
                select
                    p.id as product_id,
                    p.uuid,
                    s.uuid as shop_uuid,
                    p.source,
                    p.title,
                    p.description,
                    c.uuid as category_uuid,
                    p.images,
                    p.price,
                    p.old_price,
                    p.sku,
                    p.barcode,
                    p.status,
                    p.moderation_comment,
                    p.track_inventory,
                    p.stock_quantity,
                    p.stock_reserved,
                    p.stock_alert_threshold,
                    p.attributes,
                    p.views_count,
                    p.clicks_count,
                    p.created_at,
                    p.updated_at
                from seller_products p
                join seller_shops s on s.id = p.shop_id
                left join catalog_categories c on c.id = p.category_id
                where p.uuid = cast(:product_uuid as uuid)
                  and p.shop_id = :shop_id
                limit 1
                """
            ),
            {"product_uuid": product_uuid, "shop_id": shop_id},
        )
    ).mappings().first()
    return dict(row) if row else None


@router.get("/", response_model=list[SellerProductOut])
async def list_seller_products(
    request: Request,
    status: str | None = Query(default=None, pattern=r"^(draft|pending_moderation|active|rejected|archived)$"),
    q: str | None = Query(default=None, min_length=1, max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="seller-products-read", limit=240)
    shop = await _resolve_shop(db, user_uuid=str(current_user.get("id")))
    rows = (
        await db.execute(
            text(
                """
                select
                    p.uuid,
                    s.uuid as shop_uuid,
                    p.source,
                    p.title,
                    p.description,
                    c.uuid as category_uuid,
                    p.images,
                    p.price,
                    p.old_price,
                    p.sku,
                    p.barcode,
                    p.status,
                    p.moderation_comment,
                    p.track_inventory,
                    p.stock_quantity,
                    p.stock_reserved,
                    p.stock_alert_threshold,
                    p.attributes,
                    p.views_count,
                    p.clicks_count,
                    p.created_at,
                    p.updated_at
                from seller_products p
                join seller_shops s on s.id = p.shop_id
                left join catalog_categories c on c.id = p.category_id
                where p.shop_id = :shop_id
                  and (:status is null or p.status = :status)
                  and (
                    :q is null
                    or lower(p.title) like lower(cast(:q_like as text))
                    or lower(coalesce(p.sku, '')) like lower(cast(:q_like as text))
                  )
                order by p.updated_at desc, p.id desc
                limit :limit
                offset :offset
                """
            ),
            {
                "shop_id": shop["id"],
                "status": status,
                "q": q,
                "q_like": f"%{q.strip()}%" if q else None,
                "limit": limit,
                "offset": offset,
            },
        )
    ).mappings().all()
    return [_serialize_product(dict(row)) for row in rows]


@router.get("/{product_id}", response_model=SellerProductOut)
async def get_seller_product(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="seller-products-read", limit=240)
    shop = await _resolve_shop(db, user_uuid=str(current_user.get("id")))
    row = await _load_product_row(db, shop_id=shop["id"], product_uuid=product_id)
    if not row:
        raise HTTPException(status_code=404, detail="product not found")
    return _serialize_product(row)


@router.get("/{product_id}/status-history", response_model=SellerProductStatusEventListOut)
async def list_seller_product_status_history(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="seller-products-read", limit=240)
    shop = await _resolve_shop(db, user_uuid=str(current_user.get("id")))
    product = await _load_product_row(db, shop_id=shop["id"], product_uuid=product_id)
    if not product:
        raise HTTPException(status_code=404, detail="product not found")
    payload = await list_seller_product_status_events(
        db,
        product_id=int(product["product_id"]),
        limit=limit,
        offset=offset,
    )
    return SellerProductStatusEventListOut(**payload)


@router.get("/{product_id}/inventory-log", response_model=SellerInventoryLogListOut)
async def list_seller_product_inventory_log(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=5000),
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="seller-products-read", limit=240)
    shop = await _resolve_shop(db, user_uuid=str(current_user.get("id")))
    product = await _load_product_row(db, shop_id=shop["id"], product_uuid=product_id)
    if not product:
        raise HTTPException(status_code=404, detail="product not found")

    rows = (
        await db.execute(
            text(
                """
                select
                    l.id,
                    p.uuid as product_uuid,
                    l.action,
                    l.quantity_before,
                    l.quantity_after,
                    l.delta,
                    l.reference_id,
                    l.comment,
                    l.created_by_user_uuid,
                    l.created_at
                from seller_inventory_log l
                join seller_products p on p.id = l.product_id
                where l.shop_id = :shop_id
                  and p.uuid = cast(:product_uuid as uuid)
                order by l.created_at desc, l.id desc
                limit :limit
                offset :offset
                """
            ),
            {"shop_id": shop["id"], "product_uuid": product_id, "limit": limit, "offset": offset},
        )
    ).mappings().all()
    total = int(
        (
            await db.execute(
                text(
                    """
                    select count(*)::int
                    from seller_inventory_log l
                    join seller_products p on p.id = l.product_id
                    where l.shop_id = :shop_id
                      and p.uuid = cast(:product_uuid as uuid)
                    """
                ),
                {"shop_id": shop["id"], "product_uuid": product_id},
            )
        ).scalar_one()
        or 0
    )
    return SellerInventoryLogListOut(
        items=[_serialize_inventory_item(dict(row)) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/", response_model=SellerProductOut)
async def create_seller_product(
    request: Request,
    payload: SellerProductCreateIn,
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    user_uuid = str(current_user.get("id") or "").strip().lower()
    fingerprint = _payload_fingerprint(payload.model_dump(exclude_none=True))

    async def _op():
        await enforce_rate_limit(request, redis, bucket="seller-products-write", limit=120)
        shop = await _resolve_shop(db, user_uuid=user_uuid)
        target_status = "pending_moderation" if payload.publish else "draft"
        created = (
            await db.execute(
                text(
                    """
                    insert into seller_products (
                        shop_id,
                        source,
                        title,
                        description,
                        category_id,
                        images,
                        price,
                        old_price,
                        sku,
                        barcode,
                        status,
                        track_inventory,
                        stock_quantity,
                        stock_alert_threshold,
                        attributes
                    )
                    values (
                        :shop_id,
                        'manual',
                        :title,
                        :description,
                        (select id from catalog_categories where uuid = cast(:category_uuid as uuid)),
                        cast(:images as jsonb),
                        :price,
                        :old_price,
                        :sku,
                        :barcode,
                        :status,
                        :track_inventory,
                        :stock_quantity,
                        :stock_alert_threshold,
                        cast(:attributes as jsonb)
                    )
                    returning id, uuid, status
                    """
                ),
                {
                    "shop_id": shop["id"],
                    "title": payload.title.strip(),
                    "description": payload.description,
                    "category_uuid": payload.category_id,
                    "images": json.dumps(payload.images, ensure_ascii=False),
                    "price": payload.price,
                    "old_price": payload.old_price,
                    "sku": payload.sku,
                    "barcode": payload.barcode,
                    "status": target_status,
                    "track_inventory": payload.track_inventory,
                    "stock_quantity": payload.stock_quantity,
                    "stock_alert_threshold": payload.stock_alert_threshold,
                    "attributes": json.dumps(payload.attributes, ensure_ascii=False),
                },
            )
        ).mappings().one()
        await record_seller_product_status_event(
            db,
            product_id=int(created["id"]),
            shop_id=shop["id"],
            from_status=None,
            to_status=str(created["status"]),
            event_type="status_change",
            reason_code="seller_created",
            actor_role="seller",
            actor_user_uuid=user_uuid,
        )
        await db.commit()
        row = await _load_product_row(db, shop_id=shop["id"], product_uuid=str(created["uuid"]))
        if not row:
            raise HTTPException(status_code=404, detail="product not found")
        return _serialize_product(row)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"seller.products.create:{user_uuid}:{fingerprint}",
        handler=_op,
    )


@router.put("/{product_id}", response_model=SellerProductOut)
async def update_seller_product(
    request: Request,
    payload: SellerProductPatchIn,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    user_uuid = str(current_user.get("id") or "").strip().lower()
    fingerprint = _payload_fingerprint(payload.model_dump(exclude_none=True))

    async def _op():
        await enforce_rate_limit(request, redis, bucket="seller-products-write", limit=120)
        shop = await _resolve_shop(db, user_uuid=user_uuid)
        current = await _load_product_row(db, shop_id=shop["id"], product_uuid=product_id)
        if not current:
            raise HTTPException(status_code=404, detail="product not found")

        requested_status = str(payload.status or "").strip().lower() or None
        if requested_status and requested_status not in SELLER_MUTABLE_PRODUCT_STATUSES:
            raise HTTPException(
                status_code=422,
                detail="seller can set product status only to draft, pending_moderation, or archived",
            )

        target_status = requested_status
        current_status = str(current.get("status") or "").strip().lower()
        auto_remoderation = current_status == "active" and _has_significant_changes(payload, current) and requested_status != "archived"
        if auto_remoderation:
            target_status = "pending_moderation"

        updated = (
            await db.execute(
                text(
                    """
                    update seller_products
                    set
                        title = coalesce(:title, title),
                        description = coalesce(:description, description),
                        category_id = coalesce((select id from catalog_categories where uuid = cast(:category_uuid as uuid)), category_id),
                        images = coalesce(cast(:images as jsonb), images),
                        price = coalesce(:price, price),
                        old_price = coalesce(:old_price, old_price),
                        sku = coalesce(:sku, sku),
                        barcode = coalesce(:barcode, barcode),
                        status = coalesce(:status, status),
                        moderation_comment = case
                            when :status = 'pending_moderation' then null
                            else moderation_comment
                        end,
                        track_inventory = coalesce(:track_inventory, track_inventory),
                        stock_alert_threshold = coalesce(:stock_alert_threshold, stock_alert_threshold),
                        attributes = coalesce(cast(:attributes as jsonb), attributes),
                        updated_at = now()
                    where uuid = cast(:product_uuid as uuid)
                      and shop_id = :shop_id
                    returning id, uuid, status
                    """
                ),
                {
                    "title": payload.title.strip() if payload.title is not None else None,
                    "description": payload.description,
                    "category_uuid": payload.category_id,
                    "images": json.dumps(payload.images, ensure_ascii=False) if payload.images is not None else None,
                    "price": payload.price,
                    "old_price": payload.old_price,
                    "sku": payload.sku,
                    "barcode": payload.barcode,
                    "status": target_status,
                    "track_inventory": payload.track_inventory,
                    "stock_alert_threshold": payload.stock_alert_threshold,
                    "attributes": json.dumps(payload.attributes, ensure_ascii=False) if payload.attributes is not None else None,
                    "product_uuid": product_id,
                    "shop_id": shop["id"],
                },
            )
        ).mappings().first()
        if not updated:
            raise HTTPException(status_code=404, detail="product not found")
        next_status = str(updated.get("status") or current_status).strip().lower()
        if next_status != current_status:
            reason_code = "auto_remoderation_significant_change" if auto_remoderation else _status_change_reason_for_seller(next_status)
            actor_role = "system" if auto_remoderation else "seller"
            await record_seller_product_status_event(
                db,
                product_id=int(updated["id"]),
                shop_id=shop["id"],
                from_status=current_status,
                to_status=next_status,
                event_type="status_change",
                reason_code=reason_code,
                actor_role=actor_role,
                actor_user_uuid=user_uuid if actor_role == "seller" else None,
            )
        await db.commit()
        row = await _load_product_row(db, shop_id=shop["id"], product_uuid=product_id)
        if not row:
            raise HTTPException(status_code=404, detail="product not found")
        return _serialize_product(row)

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"seller.products.update:{product_id.lower()}:{user_uuid}:{fingerprint}",
        handler=_op,
    )


@router.delete("/{product_id}")
async def archive_seller_product(
    request: Request,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    user_uuid = str(current_user.get("id") or "").strip().lower()

    async def _op():
        await enforce_rate_limit(request, redis, bucket="seller-products-write", limit=120)
        shop = await _resolve_shop(db, user_uuid=user_uuid)
        updated = (
            await db.execute(
                text(
                    """
                    with target as (
                        select id, status
                        from seller_products
                        where uuid = cast(:product_uuid as uuid)
                          and shop_id = :shop_id
                        limit 1
                    )
                    update seller_products p
                    set status = 'archived', updated_at = now()
                    from target t
                    where p.id = t.id
                    returning p.id, p.uuid, t.status as previous_status, p.status as current_status
                    """
                ),
                {"product_uuid": product_id, "shop_id": shop["id"]},
            )
        ).mappings().first()
        if not updated:
            raise HTTPException(status_code=404, detail="product not found")
        previous_status = str(updated.get("previous_status") or "").strip().lower() or None
        current_status = str(updated.get("current_status") or "").strip().lower() or "archived"
        if previous_status != current_status:
            await record_seller_product_status_event(
                db,
                product_id=int(updated["id"]),
                shop_id=shop["id"],
                from_status=previous_status,
                to_status=current_status,
                event_type="status_change",
                reason_code="seller_archived",
                actor_role="seller",
                actor_user_uuid=user_uuid,
            )
        await db.commit()
        return {"ok": True, "id": str(updated["uuid"])}

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"seller.products.archive:{product_id.lower()}:{user_uuid}",
        handler=_op,
    )


@router.patch("/{product_id}/stock")
async def patch_seller_product_stock(
    request: Request,
    payload: SellerProductStockPatchIn,
    product_id: str = Path(..., pattern=UUID_REF_PATTERN),
    current_user: dict = Depends(get_current_seller_user),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    user_uuid = str(current_user.get("id") or "").strip().lower()
    comment_hash = hashlib.sha256(str(payload.comment or "").strip().encode("utf-8")).hexdigest()[:12]

    async def _op():
        await enforce_rate_limit(request, redis, bucket="seller-products-write", limit=120)
        shop = await _resolve_shop(db, user_uuid=user_uuid)
        row = (
            await db.execute(
                text(
                    """
                    with target as (
                        select id, stock_quantity
                        from seller_products
                        where uuid = cast(:product_uuid as uuid)
                          and shop_id = :shop_id
                        limit 1
                    )
                    update seller_products p
                    set stock_quantity = :quantity, updated_at = now()
                    from target t
                    where p.id = t.id
                    returning p.id, t.stock_quantity as quantity_before, p.stock_quantity as quantity_after
                    """
                ),
                {"quantity": payload.quantity, "product_uuid": product_id, "shop_id": shop["id"]},
            )
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="product not found")
        quantity_before = int(row["quantity_before"])
        quantity_after = int(row["quantity_after"])
        delta = quantity_after - quantity_before
        await db.execute(
            text(
                """
                insert into seller_inventory_log (
                    product_id,
                    shop_id,
                    action,
                    quantity_before,
                    quantity_after,
                    delta,
                    comment,
                    created_by_user_uuid
                )
                values (
                    :product_id,
                    :shop_id,
                    'manual_update',
                    :quantity_before,
                    :quantity_after,
                    :delta,
                    :comment,
                    cast(:created_by_user_uuid as uuid)
                )
                """
            ),
            {
                "product_id": int(row["id"]),
                "shop_id": shop["id"],
                "quantity_before": quantity_before,
                "quantity_after": quantity_after,
                "delta": delta,
                "comment": payload.comment,
                "created_by_user_uuid": user_uuid,
            },
        )
        await db.commit()
        return {"ok": True, "quantity": quantity_after, "delta": delta}

    return await execute_idempotent_json(
        request,
        redis,
        scope=f"seller.products.stock.patch:{product_id.lower()}:{user_uuid}:{payload.quantity}:{comment_hash}",
        handler=_op,
    )
