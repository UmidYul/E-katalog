from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.api.v1.routers.auth import _send_auth_email
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.catalog import CatalogRepository
from app.schemas.catalog import (
    ContactRequestIn,
    ContactRequestOut,
    HomeLastSyncOut,
    HomePriceDropsOut,
    HomeTrustStatsOut,
    NewsletterSubscriptionIn,
    NewsletterSubscriptionOut,
)
from app.services.email_templates import render_text_as_html_email

router = APIRouter(tags=["home"])
logger = logging.getLogger(__name__)


@router.get("/last-sync", response_model=HomeLastSyncOut)
async def get_last_sync(request: Request, db: AsyncSession = Depends(get_db_session)):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="home", limit=120)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    return {"timestamp": await repo.get_last_sync_timestamp()}


@router.get("/home/trust", response_model=HomeTrustStatsOut)
async def get_home_trust(request: Request, db: AsyncSession = Depends(get_db_session)):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="home", limit=120)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.get_home_trust_stats()


@router.get("/home/price-drops", response_model=HomePriceDropsOut)
async def get_home_price_drops(
    request: Request,
    limit: int = Query(default=8, ge=1, le=16),
    hours: int = Query(default=24, ge=1, le=72),
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="home", limit=120)

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    return {"items": await repo.list_price_drops(limit=limit, hours=hours)}


@router.post("/home/newsletter-subscriptions", response_model=NewsletterSubscriptionOut)
async def subscribe_home_newsletter(payload: NewsletterSubscriptionIn, db: AsyncSession = Depends(get_db_session)):
    normalized_email = str(payload.email or "").strip().lower()
    if "@" not in normalized_email or normalized_email.startswith("@") or normalized_email.endswith("@"):
        raise HTTPException(status_code=422, detail="invalid email")

    repo = CatalogRepository(db, cursor_secret=settings.cursor_secret)
    return await repo.upsert_newsletter_subscription(
        email=normalized_email,
        categories=[str(item) for item in payload.categories],
        locale=payload.locale,
        source="homepage",
    )


@router.post("/contact", response_model=ContactRequestOut)
async def submit_contact_request(
    request: Request,
    payload: ContactRequestIn,
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis()
    await enforce_rate_limit(request, redis, bucket="contact-form", limit=80)

    normalized_name = str(payload.name or "").strip()
    normalized_contact = str(payload.contact or "").strip()
    normalized_subject = str(payload.subject or "general").strip().lower()
    normalized_message = str(payload.message or "").strip()

    row = (
        await db.execute(
            text(
                """
                insert into catalog_contact_requests (
                    name,
                    contact,
                    subject,
                    message,
                    source,
                    status,
                    metadata,
                    created_at,
                    updated_at
                )
                values (
                    :name,
                    :contact,
                    :subject,
                    :message,
                    'contacts_page',
                    'new',
                    cast(:metadata as jsonb),
                    now(),
                    now()
                )
                returning uuid
                """
            ),
            {
                "name": normalized_name,
                "contact": normalized_contact,
                "subject": normalized_subject,
                "message": normalized_message,
                "metadata": '{"channel":"web"}',
            },
        )
    ).mappings().first()
    await db.commit()

    subject_labels = {
        "general": "Умумий савол",
        "technical": "Техник муаммо",
        "partnership": "Ҳамкорлик",
        "other": "Бошқа",
    }
    subject_label = subject_labels.get(normalized_subject, "Умумий савол")

    support_email = "support@doxx.uz"
    email_subject = f"Doxx контакт: {subject_label}"
    email_text = "\n".join(
        [
            "Янги мурожаат қабул қилинди.",
            "",
            f"ID: {str(row['uuid']) if row else ''}",
            f"Исм: {normalized_name}",
            f"Алоқа: {normalized_contact}",
            f"Мавзу: {subject_label}",
            "",
            normalized_message,
        ]
    )
    email_html = render_text_as_html_email(
        subject=email_subject,
        text_value=email_text,
        brand_name="Doxx",
    )
    sent, error_message = await _send_auth_email(
        recipient=support_email,
        subject=email_subject,
        text_value=email_text,
        html_value=email_html,
    )
    if not sent and error_message:
        logger.warning("contact_request_email_send_failed: %s", error_message)

    return ContactRequestOut(
        ok=True,
        id=str(row["uuid"]) if row else "",
        message="Мурожаатингиз қабул қилинди. Тез орада жавоб берамиз.",
    )
