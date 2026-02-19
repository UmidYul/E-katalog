from __future__ import annotations

import json
import re
from typing import Any

import httpx

from app.core.config import settings

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

    try:
        async with httpx.AsyncClient(timeout=25) as client:
            resp = await client.post("https://api.openai.com/v1/responses", headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
    except Exception:  # noqa: BLE001
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
