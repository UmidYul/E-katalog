from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import settings
from app.core.logging import logger


def _extract_output_text(payload: dict[str, Any]) -> str:
    chunks: list[str] = []
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                chunks.append(str(content.get("text", "")))
    return "\n".join(chunks).strip()


def _safe_json(text: str) -> dict[str, Any] | None:
    cleaned = text.strip().removeprefix("```json").removesuffix("```").strip()
    try:
        data = json.loads(cleaned)
    except Exception:  # noqa: BLE001
        return None
    return data if isinstance(data, dict) else None


async def ai_choose_canonical_candidate(
    *,
    input_title: str,
    input_specs: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> tuple[int | None, float, str]:
    if not settings.ai_canonical_matching_enabled:
        return None, 0.0, "ai_canonical_disabled"
    if not settings.openai_api_key or not candidates:
        return None, 0.0, "ai_key_or_candidates_missing"

    prompt = (
        "You are a strict product matching system.\n"
        "Task: pick one canonical candidate that is the same exact product variant as input.\n"
        "Important: model and storage are variant-defining attributes for smartphones.\n"
        "Color differences alone should not create a separate canonical.\n"
        "Return ONLY JSON: {\"candidate_id\": <int|null>, \"confidence\": <0..1>, \"reason\": \"...\"}.\n"
        f"Input title: {input_title}\n"
        f"Input specs: {json.dumps(input_specs, ensure_ascii=False)}\n"
        f"Candidates: {json.dumps(candidates, ensure_ascii=False)}\n"
    )

    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.openai_model,
        "input": prompt,
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post("https://api.openai.com/v1/responses", headers=headers, json=body)
            if resp.status_code >= 400:
                logger.warning("ai_canonical_request_failed", status_code=resp.status_code, body=resp.text[:300])
                return None, 0.0, "request_failed"
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ai_canonical_request_error", error=str(exc))
        return None, 0.0, "request_error"

    parsed = _safe_json(_extract_output_text(data) or "")
    if not parsed:
        return None, 0.0, "invalid_json"

    candidate_id = parsed.get("candidate_id")
    confidence = parsed.get("confidence", 0.0)
    reason = str(parsed.get("reason") or "ai_decision")

    try:
        conf = float(confidence)
    except Exception:  # noqa: BLE001
        conf = 0.0
    if conf < 0:
        conf = 0.0
    if conf > 1:
        conf = 1.0

    if candidate_id is None:
        return None, conf, reason
    try:
        cid = int(candidate_id)
    except Exception:  # noqa: BLE001
        return None, conf, "invalid_candidate_id"
    return cid, conf, reason


async def ai_should_merge_duplicates(
    *,
    left: dict[str, Any],
    right: dict[str, Any],
) -> tuple[bool, float, str]:
    if not settings.ai_dedupe_merge_enabled:
        return True, 1.0, "ai_dedupe_disabled_allow_rule_based"
    if not settings.openai_api_key:
        return False, 0.0, "ai_key_missing"

    prompt = (
        "You are a strict deduplication judge for e-commerce products.\n"
        "Decide if two canonical products are EXACT same variant.\n"
        "If unsure, return merge=false.\n"
        "Return ONLY JSON: {\"merge\": <bool>, \"confidence\": <0..1>, \"reason\": \"...\"}.\n"
        f"Left: {json.dumps(left, ensure_ascii=False)}\n"
        f"Right: {json.dumps(right, ensure_ascii=False)}\n"
    )

    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.openai_model,
        "input": prompt,
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post("https://api.openai.com/v1/responses", headers=headers, json=body)
            if resp.status_code >= 400:
                logger.warning("ai_dedupe_request_failed", status_code=resp.status_code, body=resp.text[:300])
                return False, 0.0, "request_failed"
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ai_dedupe_request_error", error=str(exc))
        return False, 0.0, "request_error"

    parsed = _safe_json(_extract_output_text(data) or "")
    if not parsed:
        return False, 0.0, "invalid_json"

    merge = bool(parsed.get("merge"))
    try:
        confidence = float(parsed.get("confidence", 0.0))
    except Exception:  # noqa: BLE001
        confidence = 0.0
    confidence = min(max(confidence, 0.0), 1.0)
    reason = str(parsed.get("reason") or "ai_decision")
    return merge, confidence, reason
