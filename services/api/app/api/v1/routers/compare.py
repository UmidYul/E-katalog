from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import enforce_rate_limit
from app.api.deps import get_db_session, get_redis
from app.schemas.catalog import CompareRequest, CompareShareCreateOut, CompareShareCreateRequest, CompareShareResolveOut
from app.core.config import settings
from app.repositories.catalog import CatalogRepository

router = APIRouter(tags=["compare"])


def _decode_share_payload(token: str) -> dict:
    try:
        padded = token + "=" * (-len(token) % 4)
        wrapped = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
        payload = wrapped.get("d")
        signature = str(wrapped.get("s", ""))
        if not isinstance(payload, dict):
            raise ValueError("invalid payload")
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        expected = hmac.new(settings.cursor_secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise ValueError("invalid signature")
        return payload
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid compare share token") from exc


def _encode_share_payload(*, product_ids: list[str], expires_at: datetime) -> str:
    payload = {
        "v": 1,
        "product_ids": product_ids,
        "exp": int(expires_at.timestamp()),
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = hmac.new(settings.cursor_secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    wrapped = {"d": payload, "s": signature}
    token = base64.urlsafe_b64encode(json.dumps(wrapped, separators=(",", ":")).encode("utf-8")).decode("utf-8")
    return token.rstrip("=")


def _parse_share_expiry(payload: dict) -> datetime:
    try:
        exp_ts = int(payload.get("exp", 0))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid compare share token") from exc
    if exp_ts <= 0:
        raise HTTPException(status_code=400, detail="invalid compare share token")
    expires_at = datetime.fromtimestamp(exp_ts, tz=UTC)
    if expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=410, detail="compare share token expired")
    return expires_at


def _parse_share_product_ids(payload: dict) -> list[str]:
    value = payload.get("product_ids")
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail="invalid compare share token")
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_id in value:
        text = str(raw_id).strip().lower()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    if len(normalized) < 2 or len(normalized) > 4:
        raise HTTPException(status_code=400, detail="invalid compare share token")
    return normalized


async def _resolve_compare_products(repo: CatalogRepository, product_ids: list[str]) -> tuple[list[str], list[dict]]:
    resolved_ids: list[str] = []
    products: list[dict] = []
    seen: set[str] = set()
    for product_id in product_ids:
        resolved_product_id = await repo.resolve_entity_ref("product", product_id)
        if resolved_product_id is None:
            raise HTTPException(status_code=404, detail=f"product {product_id} not found")
        product = await repo.get_product(resolved_product_id)
        if product is None:
            raise HTTPException(status_code=404, detail=f"product {product_id} not found")
        canonical_id = str(product["id"]).lower()
        if canonical_id in seen:
            continue
        seen.add(canonical_id)
        resolved_ids.append(canonical_id)
        products.append(product)
    if len(resolved_ids) < 2:
        raise HTTPException(status_code=422, detail="at least two distinct products are required")
    return resolved_ids, products


@router.post("/compare")
async def compare_products(payload: CompareRequest, request: Request, db: AsyncSession = Depends(get_db_session)):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="compare", limit=30)
    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    _, products_data = await _resolve_compare_products(repo, [str(product_id) for product_id in payload.product_ids])
    products = []
    for product in products_data:
        compare_meta = await repo.get_product_compare_meta(int(product["legacy_id"]))
        products.append(
            {
                "id": product["id"],
                "normalized_title": product["title"],
                "main_image": product.get("main_image"),
                "attributes": compare_meta,
                "specs": product["specs"],
            }
        )
    return {"items": products, "request_id": request.state.request_id}


@router.post("/compare/share", response_model=CompareShareCreateOut)
async def create_compare_share_link(
    payload: CompareShareCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="compare-share-write", limit=45)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    resolved_ids, _ = await _resolve_compare_products(repo, [str(product_id) for product_id in payload.product_ids])

    expires_at = datetime.now(UTC) + timedelta(days=int(payload.ttl_days))
    token = _encode_share_payload(product_ids=resolved_ids, expires_at=expires_at)
    return CompareShareCreateOut(
        token=token,
        product_ids=resolved_ids,
        share_path=f"/compare?share={token}",
        expires_at=expires_at.isoformat(),
        request_id=request.state.request_id,
    )


@router.get("/compare/share/{token}", response_model=CompareShareResolveOut)
async def resolve_compare_share_link(
    request: Request,
    token: str = Path(..., min_length=16, max_length=2048),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="compare-share-read", limit=90)

    payload = _decode_share_payload(token)
    expires_at = _parse_share_expiry(payload)
    product_ids = _parse_share_product_ids(payload)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    resolved_ids, _ = await _resolve_compare_products(repo, product_ids)
    return CompareShareResolveOut(
        product_ids=resolved_ids,
        expires_at=expires_at.isoformat(),
        request_id=request.state.request_id,
    )
