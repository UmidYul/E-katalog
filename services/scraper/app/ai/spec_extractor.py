from __future__ import annotations

import asyncio
import json
import random
import re
from datetime import datetime
from shared.utils.time import UTC
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from app.core.config import settings
from app.core.logging import logger

ALLOWED_KEYS = {
    "device_type",
    "brand",
    "model",
    "ram_gb",
    "virtual_ram_gb",
    "storage_gb",
    "cpu",
    "gpu",
    "display_inches",
    "refresh_rate_hz",
    "battery_mah",
    "camera_mp",
    "network",
    "color",
    "os",
}


INT_KEYS = {"ram_gb", "virtual_ram_gb", "storage_gb", "refresh_rate_hz", "battery_mah", "camera_mp"}
FLOAT_KEYS = {"display_inches"}


def _extract_first_int(value: str) -> str | None:
    match = re.search(r"\d{1,5}", value)
    return match.group(0) if match else None


def _extract_first_float(value: str) -> str | None:
    match = re.search(r"\d{1,2}(?:[.,]\d{1,2})?", value)
    if not match:
        return None
    return match.group(0).replace(",", ".")


def _normalize_network(value: str) -> str | None:
    upper = value.upper()
    if "5G" in upper:
        return "5G"
    if "4G" in upper:
        return "4G"
    return None


def _sanitize(payload: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in payload.items():
        if k not in ALLOWED_KEYS:
            continue
        if v is None:
            continue
        value = str(v).strip()
        if value:
            if k in INT_KEYS:
                parsed = _extract_first_int(value)
                if parsed:
                    out[k] = parsed
                continue
            if k in FLOAT_KEYS:
                parsed = _extract_first_float(value)
                if parsed:
                    out[k] = parsed
                continue
            if k == "network":
                parsed = _normalize_network(value)
                if parsed:
                    out[k] = parsed
                continue
            out[k] = value[:120]
    return out


def _retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    stripped = value.strip()
    if not stripped:
        return None

    try:
        seconds = float(stripped)
        return max(0.0, seconds)
    except ValueError:
        pass

    try:
        dt = parsedate_to_datetime(stripped)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        delta = (dt - datetime.now(UTC)).total_seconds()
        return max(0.0, delta)
    except Exception:  # noqa: BLE001
        return None


async def ai_extract_specs(
    title: str,
    description: str | None,
    category_hint: str | None = None,
    required_keys: list[str] | None = None,
) -> dict[str, str]:
    if not settings.ai_spec_enrichment_enabled or not settings.openai_api_key:
        return {}

    prompt = (
        "Extract technical product specs from title/description.\n"
        "Return JSON object only with known keys.\n"
        f"Allowed keys: {sorted(ALLOWED_KEYS)}.\n"
        "Rules:\n"
        "- Keep values concise.\n"
        "- For numeric fields keep plain number where possible.\n"
        "- If unknown, omit key.\n"
        f"- category_hint: {category_hint or ''}\n"
        f"- required_keys_priority: {required_keys or []}\n"
        f"- title: {title}\n"
        f"- description: {description or ''}\n"
    )

    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.openai_model,
        "input": prompt,
        "temperature": 0,
    }

    attempts = max(1, settings.ai_request_max_retries)
    data: dict[str, Any] | None = None

    async with httpx.AsyncClient(timeout=25) as client:
        for attempt in range(attempts):
            try:
                resp = await client.post("https://api.openai.com/v1/responses", headers=headers, json=body)
            except Exception as exc:  # noqa: BLE001
                if attempt >= attempts - 1:
                    logger.warning("ai_specs_request_failed", error=str(exc), attempt=attempt + 1)
                    return {}
                delay = min(
                    settings.ai_request_max_delay_seconds,
                    settings.ai_request_base_delay_seconds * (2**attempt),
                ) + random.uniform(0, 0.35)
                await asyncio.sleep(delay)
                continue

            if resp.status_code < 400:
                data = resp.json()
                break

            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt >= attempts - 1:
                    logger.warning(
                        "ai_specs_request_rate_limited",
                        status_code=resp.status_code,
                        attempt=attempt + 1,
                        body=resp.text[:400],
                    )
                    return {}
                retry_after = _retry_after_seconds(resp.headers.get("Retry-After"))
                backoff = min(
                    settings.ai_request_max_delay_seconds,
                    settings.ai_request_base_delay_seconds * (2**attempt),
                )
                delay = (retry_after if retry_after is not None else backoff) + random.uniform(0, 0.35)
                await asyncio.sleep(delay)
                continue

            logger.warning(
                "ai_specs_request_bad_status",
                status_code=resp.status_code,
                body=resp.text[:400],
            )
            return {}

    if data is None:
        return {}

    text_out = ""
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                text_out += content.get("text", "")

    if not text_out:
        return {}

    try:
        # Keep robust against markdown wrappers.
        text_out = text_out.strip().removeprefix("```json").removesuffix("```").strip()
        parsed = json.loads(text_out)
    except Exception:  # noqa: BLE001
        return {}

    if not isinstance(parsed, dict):
        return {}
    return _sanitize(parsed)

