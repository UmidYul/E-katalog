from __future__ import annotations

import argparse
import asyncio
import re
from typing import Any

import httpx
from sqlalchemy import select

from app.ai.spec_extractor import ai_extract_specs
from app.core.config import settings
from app.db.models import Offer, Product
from app.db.session import AsyncSessionLocal
from app.utils.specs import missing_required_fields, needs_ai_enrichment, normalize_product_specs


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill offer availability/specifications from Uzum product API.")
    parser.add_argument("--limit", type=int, default=500, help="Max number of offers to scan.")
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Update only offers where availability='unknown' or specifications is empty.",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=100,
        help="Print progress every N scanned offers.",
    )
    return parser.parse_args()


def extract_product_id(url: str) -> str | None:
    match = re.search(r"/(?:ru|uz)/product/(\d+)", url)
    if match:
        return match.group(1)
    match = re.search(r"/product/[\w\-]+-(\d+)", url)
    if match:
        return match.group(1)
    return None


def extract_specs(payload: dict[str, Any]) -> dict[str, str]:
    specs: dict[str, str] = {}

    characteristics = payload.get("characteristics") or []
    if isinstance(characteristics, list):
        for characteristic in characteristics:
            if not isinstance(characteristic, dict):
                continue
            title = characteristic.get("title")
            values = characteristic.get("values") or []
            if not title or not isinstance(values, list):
                continue
            value_titles = [str(v.get("title")) for v in values if isinstance(v, dict) and v.get("title")]
            if value_titles:
                specs[str(title)] = ", ".join(value_titles)

    attributes = payload.get("attributes") or []
    if isinstance(attributes, list):
        for attribute in attributes:
            if not isinstance(attribute, dict):
                continue
            title = attribute.get("title")
            value = attribute.get("value")
            if title and value:
                specs[str(title)] = str(value)

    return specs


def extract_availability(payload: dict[str, Any]) -> str:
    total_available = payload.get("totalAvailableAmount")
    try:
        if total_available is not None and int(total_available) > 0:
            return "in_stock"
        if total_available is not None and int(total_available) <= 0:
            return "out_of_stock"
    except Exception:  # noqa: BLE001
        return "unknown"
    return "unknown"


async def backfill(limit: int, only_missing: bool, progress_every: int) -> None:
    verify: bool | str = settings.http_verify_ssl
    if settings.http_ca_bundle:
        verify = settings.http_ca_bundle

    headers = {"User-Agent": settings.user_agents[0]} if settings.user_agents else {}

    async with AsyncSessionLocal() as session, httpx.AsyncClient(
        timeout=settings.default_timeout_seconds,
        follow_redirects=True,
        verify=verify,
        headers=headers,
    ) as client:
        rows = (
            await session.execute(
                select(Offer, Product.title).join(Product, Product.id == Offer.product_id).order_by(Offer.id.desc()).limit(limit)
            )
        ).all()

        scanned = 0
        updated = 0
        skipped = 0

        batch_size = 50
        since_commit = 0

        for offer, product_title in rows:
            scanned += 1
            if progress_every > 0 and scanned % progress_every == 0:
                print(f"Progress: scanned={scanned}, updated={updated}, skipped={skipped}", flush=True)

            if only_missing and offer.availability != "unknown" and bool(offer.specifications):
                skipped += 1
                continue

            product_id = extract_product_id(offer.link)
            if not product_id:
                skipped += 1
                continue

            try:
                resp = await client.get(f"https://api.uzum.uz/api/v2/product/{product_id}")
                resp.raise_for_status()
                payload = resp.json().get("payload", {}).get("data", {})
            except Exception:  # noqa: BLE001
                skipped += 1
                continue

            specs = extract_specs(payload)
            availability = extract_availability(payload)
            normalized_specs = normalize_product_specs(
                product_title or "",
                {**(offer.specifications or {}), **specs},
                extra_text=str(payload.get("description") or ""),
            )
            if needs_ai_enrichment(normalized_specs):
                ai_specs = await ai_extract_specs(
                    title=product_title or "",
                    description=str(payload.get("description") or ""),
                    category_hint=offer.link,
                )
                for key, value in ai_specs.items():
                    normalized_specs.setdefault(key, value)
            if settings.ai_spec_strict_mode:
                for _ in range(max(0, settings.ai_spec_max_attempts - 1)):
                    missing = missing_required_fields(normalized_specs)
                    if not missing:
                        break
                    ai_specs = await ai_extract_specs(
                        title=product_title or "",
                        description=str(payload.get("description") or ""),
                        category_hint=offer.link,
                        required_keys=missing,
                    )
                    for key, value in ai_specs.items():
                        normalized_specs.setdefault(key, value)

            changed = False
            if normalized_specs and normalized_specs != (offer.specifications or {}):
                offer.specifications = normalized_specs
                changed = True
            if availability != "unknown" and availability != offer.availability:
                offer.availability = availability
                changed = True

            if changed:
                updated += 1
                since_commit += 1

            if since_commit >= batch_size:
                await session.commit()
                since_commit = 0

        await session.commit()

    print(f"Scanned: {scanned}")
    print(f"Updated: {updated}")
    print(f"Skipped: {skipped}")


async def _main() -> None:
    args = parse_args()
    try:
        await backfill(args.limit, args.only_missing, args.progress_every)
    except KeyboardInterrupt:
        print("Interrupted by user (Ctrl+C). Partial progress was committed.")


if __name__ == "__main__":
    asyncio.run(_main())
