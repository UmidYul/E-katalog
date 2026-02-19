from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.core.rate_limit import enforce_rate_limit
from app.api.deps import get_db_session, get_redis
from app.schemas.catalog import CompareRequest
from app.core.config import settings
from app.repositories.catalog import CatalogRepository

router = APIRouter(tags=["compare"])


@router.post("/compare")
async def compare_products(payload: CompareRequest, request: Request, db: AsyncSession = Depends(get_db_session)):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="compare", limit=30)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    products = []
    for product_id in payload.product_ids:
        product = await repo.get_product(product_id)
        if product is None:
            raise HTTPException(status_code=404, detail=f"product {product_id} not found")
        products.append(
            {
                "id": product.id,
                "normalized_title": product.normalized_title,
                "attributes": product.attributes,
                "specs": product.specs,
            }
        )
    return {"items": products, "request_id": request.state.request_id}
