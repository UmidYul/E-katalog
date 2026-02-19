from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.routers import admin, brands, categories, compare, filters, health, products, search, stores

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(search.router)
api_router.include_router(products.router)
api_router.include_router(categories.router)
api_router.include_router(brands.router)
api_router.include_router(filters.router)
api_router.include_router(stores.router)
api_router.include_router(compare.router)
api_router.include_router(admin.router)
