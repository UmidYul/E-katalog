from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import logger
from app.platform.models import CatalogBrand, CatalogCanonicalProduct, CatalogCategory, CatalogStoreProduct
from app.platform.services.normalization import normalize_specs

_COPY_MODE_PREVIOUS = "previous_generation"
_COPY_MODE_CURRENT = "current_improvements"
_MAX_WHATS_NEW_ITEMS = 4

_SPEC_HINT_ORDER: tuple[tuple[tuple[str, ...], str], ...] = (
    (("processor", "chipset", "soc", "cpu"), "Обновлена платформа: {value}."),
    (("main_camera_mp", "camera_mp", "camera"), "Усилена камера: {value}."),
    (("display_inches", "screen_size", "diagonal"), "Экран: {value}."),
    (("refresh_rate_hz", "screen_refresh_rate"), "Плавность интерфейса: {value}."),
    (("battery_mah", "battery_capacity"), "Аккумулятор: {value}."),
    (("storage_gb", "storage"), "Встроенная память: {value}."),
    (("ram_gb", "ram"), "Оперативная память: {value}."),
    (("os", "operating_system"), "Актуальная ОС: {value}."),
    (("esim",), "Поддержка eSIM: {value}."),
)

_STORAGE_NUMBERS = {
    8,
    16,
    32,
    64,
    128,
    256,
    512,
    1024,
    120,
    144,
    165,
    240,
}

_MEMORY_SPEC_KEYS = {"ram_gb", "ram", "storage_gb", "storage"}
_PLACEHOLDER_SPEC_VALUES = {
    "",
    "-",
    "--",
    "—",
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "not specified",
    "не указано",
}

_OPENAI_QUOTA_BACKOFF = timedelta(minutes=30)
_openai_quota_exhausted_until: datetime | None = None


def _extract_output_text(payload: dict[str, Any]) -> str:
    chunks: list[str] = []
    for item in payload.get("output", []):
        content_items = item.get("content", [])
        if not isinstance(content_items, list):
            continue
        for content in content_items:
            if isinstance(content, dict) and content.get("type") == "output_text":
                chunks.append(str(content.get("text", "")))
    return "\n".join(chunks).strip()


def parse_copywriting_response(raw_text: str) -> dict[str, Any] | None:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    try:
        parsed = json.loads(cleaned)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def _to_string_map(specs: dict[str, Any] | None) -> dict[str, str]:
    if not isinstance(specs, dict):
        return {}
    normalized: dict[str, str] = {}
    for key, raw_value in specs.items():
        if raw_value is None:
            continue
        clean_key = str(key).strip()
        if not clean_key:
            continue
        clean_value = re.sub(r"\s+", " ", str(raw_value).replace("\u00a0", " ")).strip()
        if not clean_value:
            continue
        normalized[clean_key] = clean_value
    return normalized


def _is_placeholder_spec_value(value: str) -> bool:
    return str(value or "").strip().lower() in _PLACEHOLDER_SPEC_VALUES


def _extract_numeric_value(value: str) -> float | None:
    match = re.search(r"\d+(?:[.,]\d+)?", str(value))
    if not match:
        return None
    token = match.group(0).replace(",", ".")
    try:
        return float(token)
    except ValueError:
        return None


def _is_zero_memory_value(value: str) -> bool:
    numeric = _extract_numeric_value(value)
    if numeric is None:
        return False
    return numeric <= 0


def _prefer_spec_value(key: str, current: str | None, candidate: str) -> str:
    if not current:
        return candidate
    if _is_placeholder_spec_value(current) and not _is_placeholder_spec_value(candidate):
        return candidate
    if _is_placeholder_spec_value(candidate):
        return current

    if key in _MEMORY_SPEC_KEYS:
        current_zero = _is_zero_memory_value(current)
        candidate_zero = _is_zero_memory_value(candidate)
        if current_zero and not candidate_zero:
            return candidate
        if candidate_zero and not current_zero:
            return current

    current_digits = len(re.findall(r"\d", current))
    candidate_digits = len(re.findall(r"\d", candidate))
    if candidate_digits > current_digits:
        return candidate
    if len(candidate) > len(current):
        return candidate
    return current


def _merge_copy_specs(*sources: dict[str, Any] | None) -> dict[str, str]:
    merged: dict[str, str] = {}
    for source in sources:
        if not isinstance(source, dict):
            continue
        normalized_source = _to_string_map(normalize_specs(source))
        for key, value in normalized_source.items():
            merged[key] = _prefer_spec_value(key, merged.get(key), value)
    return merged


def _extract_storage_from_title(title: str) -> str | None:
    normalized = str(title or "").lower()
    normalized = re.sub(r"\b(?:гб|РіР±)\b", "gb", normalized, flags=re.IGNORECASE)
    pair_match = re.search(r"\b\d{1,2}\s*/\s*(\d{2,4})\s*gb\b", normalized, flags=re.IGNORECASE)
    if pair_match:
        return pair_match.group(1)
    storage_match = re.search(r"\b(\d{2,4})\s*gb\b", normalized, flags=re.IGNORECASE)
    if storage_match:
        return storage_match.group(1)
    return None


def _extract_generation_number(title: str) -> int | None:
    normalized = re.sub(r"[^0-9a-zA-Zа-яА-Я\s]", " ", str(title))
    for match in re.finditer(r"\b(\d{1,4})\b", normalized):
        value = int(match.group(1))
        if value in _STORAGE_NUMBERS:
            continue
        if value > 2100:
            continue
        if value <= 0:
            continue
        return value
    return None


def _is_previous_generation(input_title: str, candidate_title: str) -> bool:
    current = _extract_generation_number(input_title)
    previous = _extract_generation_number(candidate_title)
    if current is None or previous is None:
        return False
    return previous == current - 1


def build_copy_source_hash(source: dict[str, Any]) -> str:
    serialized = json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _trim_sentence(value: str, *, max_length: int) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "").strip())
    if not cleaned:
        return ""
    if len(cleaned) <= max_length:
        return cleaned
    shortened = cleaned[: max_length - 1].rstrip()
    return f"{shortened}..."


def _normalize_whats_new(items: Iterable[Any]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_item in items:
        if raw_item is None:
            continue
        text_value = _trim_sentence(str(raw_item), max_length=180)
        if not text_value:
            continue
        key = text_value.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text_value)
        if len(normalized) >= _MAX_WHATS_NEW_ITEMS:
            break
    return normalized


def build_fallback_copy(
    *,
    title: str,
    category_name: str,
    brand_name: str | None,
    specs: dict[str, Any] | None,
) -> tuple[str, list[str]]:
    normalized_specs = _to_string_map(specs)
    title_text = _trim_sentence(title, max_length=180)
    category_text = _trim_sentence(category_name, max_length=80) or "категории"
    brand_text = _trim_sentence(brand_name or "", max_length=80)
    intro_subject = f"от {brand_text}" if brand_text else "для повседневного использования"

    highlights: list[str] = []
    for key_group, template in _SPEC_HINT_ORDER:
        value = None
        matched_key = None
        for key in key_group:
            if key in normalized_specs:
                value = normalized_specs[key]
                matched_key = key
                break
        if not value:
            continue
        if matched_key in _MEMORY_SPEC_KEYS and _is_zero_memory_value(value):
            continue
        highlights.append(template.format(value=value))
        if len(highlights) >= _MAX_WHATS_NEW_ITEMS:
            break

    if not highlights:
        highlights = [
            "Обновлены ключевые характеристики производительности.",
            "Улучшен общий баланс экрана, камеры и автономности.",
            "Модель актуализирована под ежедневные сценарии использования.",
        ]

    short_description = (
        f"{title_text} - актуальная модель {intro_subject} в категории {category_text}."
        if title_text
        else f"Актуальная модель в категории {category_text}."
    )
    if normalized_specs:
        primary_specs = []
        for key in ("processor", "storage_gb", "ram_gb", "camera_mp", "battery_mah"):
            value = normalized_specs.get(key)
            if key in _MEMORY_SPEC_KEYS and value and _is_zero_memory_value(value):
                continue
            if value:
                primary_specs.append(f"{key}: {value}")
            if len(primary_specs) >= 3:
                break
        if primary_specs:
            short_description = f"{short_description} Ключевые параметры: {', '.join(primary_specs)}."

    short_description = _trim_sentence(short_description, max_length=380)
    return short_description, _normalize_whats_new(highlights)


def normalize_copy_payload(
    ai_payload: dict[str, Any] | None,
    *,
    fallback_short_description: str,
    fallback_whats_new: list[str],
    min_compare_confidence: float,
) -> dict[str, Any]:
    mode = _COPY_MODE_CURRENT
    compare_confidence = 0.0
    short_description = ""
    whats_new: list[str] = []

    if isinstance(ai_payload, dict):
        raw_mode = str(ai_payload.get("mode") or "").strip().lower()
        if raw_mode == _COPY_MODE_PREVIOUS:
            mode = _COPY_MODE_PREVIOUS
        elif raw_mode == _COPY_MODE_CURRENT:
            mode = _COPY_MODE_CURRENT

        raw_conf = ai_payload.get("compare_confidence", 0.0)
        try:
            compare_confidence = float(raw_conf)
        except Exception:  # noqa: BLE001
            compare_confidence = 0.0
        compare_confidence = max(0.0, min(1.0, compare_confidence))

        short_description = _trim_sentence(str(ai_payload.get("short_description") or ""), max_length=380)
        whats_new = _normalize_whats_new(ai_payload.get("whats_new") or [])

    if not short_description:
        short_description = _trim_sentence(fallback_short_description, max_length=380)
    if not whats_new:
        whats_new = _normalize_whats_new(fallback_whats_new)

    if mode == _COPY_MODE_PREVIOUS and compare_confidence < min_compare_confidence:
        mode = _COPY_MODE_CURRENT
        compare_confidence = 0.0
        whats_new = _normalize_whats_new(fallback_whats_new) or whats_new

    if not whats_new:
        whats_new = [
            "Модель получила обновленные характеристики по сравнению с предыдущими версиями.",
            "Уточнены ключевые параметры для повседневных сценариев использования.",
        ]

    return {
        "short_description": short_description or None,
        "whats_new": whats_new,
        "mode": mode,
        "compare_confidence": compare_confidence,
    }


async def _find_previous_generation_candidate(
    session: AsyncSession,
    *,
    product: CatalogCanonicalProduct,
) -> dict[str, Any] | None:
    if product.category_id is None:
        return None
    candidate_query = text(
        """
        select id, normalized_title, specs
        from catalog_canonical_products
        where is_active = true
          and id <> :product_id
          and category_id = :category_id
          and brand_id is not distinct from cast(:brand_id as bigint)
        order by similarity(lower(normalized_title), lower(:title)) desc, id asc
        limit :limit
        """
    )
    try:
        rows = (
            await session.execute(
                candidate_query,
                {
                    "product_id": product.id,
                    "category_id": product.category_id,
                    "brand_id": product.brand_id,
                    "title": product.normalized_title,
                    "limit": 30,
                },
            )
        ).mappings().all()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ai_copy_previous_candidate_query_failed", product_id=product.id, error=str(exc))
        return None

    for row in rows:
        title = str(row.get("normalized_title") or "").strip()
        if not title:
            continue
        if not _is_previous_generation(product.normalized_title, title):
            continue
        specs = row.get("specs")
        return {
            "id": int(row["id"]),
            "title": title,
            "specs": _to_string_map(specs if isinstance(specs, dict) else {}),
        }
    return None


async def _load_store_specs_samples(
    session: AsyncSession,
    *,
    product_id: int,
    limit: int = 12,
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            text(
                """
                with ranked_specs as (
                    select
                        case
                            when jsonb_typeof(metadata->'specifications') = 'object' then metadata->'specifications'
                            when jsonb_typeof(metadata->'specs') = 'object' then metadata->'specs'
                            else '{}'::jsonb
                        end as specs,
                        case
                            when jsonb_typeof(metadata->'specifications') = 'object' then (select count(*) from jsonb_each(metadata->'specifications'))
                            when jsonb_typeof(metadata->'specs') = 'object' then (select count(*) from jsonb_each(metadata->'specs'))
                            else 0
                        end as specs_count,
                        last_seen_at,
                        id
                    from catalog_store_products
                    where canonical_product_id = :product_id
                )
                select specs
                from ranked_specs
                where specs <> '{}'::jsonb
                order by specs_count desc, last_seen_at desc, id desc
                limit :limit
                """
            ),
            {"product_id": product_id, "limit": max(1, min(int(limit), 50))},
        )
    ).all()
    return [row.specs for row in rows if isinstance(row.specs, dict)]


async def build_product_copy_source(
    session: AsyncSession,
    *,
    product: CatalogCanonicalProduct,
) -> dict[str, Any]:
    category_name = (
        await session.execute(select(CatalogCategory.name_uz).where(CatalogCategory.id == product.category_id))
    ).scalar_one_or_none()
    brand_name = None
    if product.brand_id is not None:
        brand_name = (
            await session.execute(select(CatalogBrand.name).where(CatalogBrand.id == product.brand_id))
        ).scalar_one_or_none()

    descriptions = (
        await session.execute(
            select(CatalogStoreProduct.description_raw)
            .where(
                CatalogStoreProduct.canonical_product_id == product.id,
                CatalogStoreProduct.description_raw.is_not(None),
                func.length(func.trim(CatalogStoreProduct.description_raw)) > 0,
            )
            .order_by(CatalogStoreProduct.last_seen_at.desc(), CatalogStoreProduct.id.desc())
            .limit(3)
        )
    ).scalars().all()
    description_samples = [_trim_sentence(str(value), max_length=800) for value in descriptions if str(value).strip()]

    previous_candidate = await _find_previous_generation_candidate(session, product=product)
    store_specs_samples = await _load_store_specs_samples(session, product_id=int(product.id))
    merged_specs = _merge_copy_specs(
        product.specs if isinstance(product.specs, dict) else {},
        *store_specs_samples,
    )
    title_storage = _extract_storage_from_title(str(product.normalized_title or ""))
    if title_storage:
        merged_specs["storage_gb"] = title_storage

    return {
        "product_id": int(product.id),
        "title": str(product.normalized_title or "").strip(),
        "category": str(category_name or "").strip(),
        "brand": str(brand_name or "").strip() or None,
        "specs": merged_specs,
        "description_samples": description_samples,
        "previous_generation_candidate": previous_candidate,
    }


def _build_openai_prompt(source: dict[str, Any]) -> str:
    return (
        "Ты пишешь краткий e-commerce текст на русском языке.\n"
        "Сгенерируй для карточки товара:\n"
        "1) short_description: 1-2 коротких предложения.\n"
        "2) whats_new: 2-4 коротких пункта.\n"
        "3) mode: previous_generation или current_improvements.\n"
        "4) compare_confidence: число от 0 до 1.\n"
        "Правила:\n"
        "- Отвечай ТОЛЬКО валидным JSON без markdown.\n"
        "- Не выдумывай технические характеристики.\n"
        "- Если уверенного сравнения с прошлым поколением нет, используй mode=current_improvements.\n"
        f"Входные данные: {json.dumps(source, ensure_ascii=False)}"
    )


async def _generate_with_openai(source: dict[str, Any]) -> dict[str, Any] | None:
    global _openai_quota_exhausted_until
    if not settings.openai_api_key:
        return None
    if _openai_quota_exhausted_until is not None and datetime.now(UTC) < _openai_quota_exhausted_until:
        return None
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.openai_model,
        "input": _build_openai_prompt(source),
    }
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            response = await client.post("https://api.openai.com/v1/responses", headers=headers, json=body)
            if response.status_code >= 400:
                if response.status_code == 429:
                    try:
                        response_payload = response.json()
                    except Exception:  # noqa: BLE001
                        response_payload = {}
                    error_code = str((response_payload or {}).get("error", {}).get("code") or "").strip().lower()
                    if error_code == "insufficient_quota":
                        _openai_quota_exhausted_until = datetime.now(UTC) + _OPENAI_QUOTA_BACKOFF
                        logger.warning(
                            "ai_copy_openai_quota_exhausted",
                            retry_after_iso=_openai_quota_exhausted_until.isoformat(),
                        )
                        return None
                logger.warning(
                    "ai_copy_openai_request_failed",
                    status_code=response.status_code,
                    body=response.text[:300],
                )
                return None
            payload = response.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ai_copy_openai_request_error", error=str(exc))
        return None

    output_text = _extract_output_text(payload)
    if not output_text:
        return None
    return parse_copywriting_response(output_text)


async def generate_product_copy(
    session: AsyncSession,
    *,
    product: CatalogCanonicalProduct,
    min_compare_confidence: float,
) -> dict[str, Any]:
    source = await build_product_copy_source(session, product=product)
    source_hash = build_copy_source_hash(source)
    fallback_short_description, fallback_whats_new = build_fallback_copy(
        title=str(source.get("title") or ""),
        category_name=str(source.get("category") or ""),
        brand_name=source.get("brand"),
        specs=source.get("specs") if isinstance(source.get("specs"), dict) else {},
    )

    ai_payload: dict[str, Any] | None = None
    if settings.ai_product_copy_enabled and settings.openai_api_key:
        ai_payload = await _generate_with_openai(source)

    normalized = normalize_copy_payload(
        ai_payload,
        fallback_short_description=fallback_short_description,
        fallback_whats_new=fallback_whats_new,
        min_compare_confidence=min_compare_confidence,
    )
    normalized["source_hash"] = source_hash
    normalized["source"] = source
    return normalized
