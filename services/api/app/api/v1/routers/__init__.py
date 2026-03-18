from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.routers import (
    admin,
    admin_b2b,
    admin_sellers,
    auth,
    b2b_analytics,
    b2b_billing,
    b2b_campaigns,
    b2b_feeds,
    b2b_onboarding,
    b2b_partners,
    b2b_orgs,
    b2b_support,
    brands,
    categories,
    compare,
    filters,
    go_redirect,
    health,
    home,
    product_feedback,
    seller_dashboard,
    seller_products,
    seller_public,
    products,
    search,
    stores,
    users,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(home.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(search.router)
api_router.include_router(products.router)
api_router.include_router(product_feedback.router)
api_router.include_router(categories.router)
api_router.include_router(brands.router)
api_router.include_router(filters.router)
api_router.include_router(stores.router)
api_router.include_router(compare.router)
api_router.include_router(admin.router)
api_router.include_router(admin_sellers.router)
api_router.include_router(seller_public.router)
api_router.include_router(seller_dashboard.router)
api_router.include_router(seller_products.router)
api_router.include_router(b2b_orgs.router)
api_router.include_router(b2b_partners.router)
api_router.include_router(b2b_onboarding.router)
api_router.include_router(b2b_feeds.router)
api_router.include_router(b2b_campaigns.router)
api_router.include_router(b2b_analytics.router)
api_router.include_router(b2b_billing.router)
api_router.include_router(b2b_support.router)
api_router.include_router(admin_b2b.router)
api_router.include_router(go_redirect.router)
