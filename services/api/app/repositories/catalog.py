from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from decimal import Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import and_, func, literal_column, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db.models import (
    CatalogBrand,
    CatalogCanonicalProduct,
    CatalogCategory,
    CatalogOffer,
    CatalogProductSearch,
    CatalogSeller,
    CatalogStore,
    CatalogStoreProduct,
)

_SPEC_KEY_ALIASES: dict[str, str] = {
    "storage": "storage_gb",
    "storage gb": "storage_gb",
    "built in memory": "storage_gb",
    "built_in_memory": "storage_gb",
    "\u0432\u0441\u0442\u0440\u043e\u0435\u043d\u043d\u0430\u044f \u043f\u0430\u043c\u044f\u0442\u044c": "storage_gb",
    "ram": "ram_gb",
    "ram gb": "ram_gb",
    "\u043e\u043f\u0435\u0440\u0430\u0442\u0438\u0432\u043d\u0430\u044f \u043f\u0430\u043c\u044f\u0442\u044c": "ram_gb",
    "battery": "battery_mah",
    "battery mah": "battery_mah",
    "\u0435\u043c\u043a\u043e\u0441\u0442\u044c \u0430\u043a\u043a\u0443\u043c\u0443\u043b\u044f\u0442\u043e\u0440\u0430": "battery_mah",
    "camera": "camera_mp",
    "camera mp": "camera_mp",
    "main camera": "main_camera_mp",
    "front camera": "front_camera_mp",
    "display": "display_inches",
    "display inches": "display_inches",
    "screen inches": "display_inches",
    "\u0434\u0438\u0430\u0433\u043e\u043d\u0430\u043b\u044c \u044d\u043a\u0440\u0430\u043d\u0430": "display_inches",
    "cpu frequency": "cpu_frequency_mhz",
    "refresh rate": "refresh_rate_hz",
    "refresh rate hz": "refresh_rate_hz",
    "wifi": "wifi_standard",
    "wi fi": "wifi_standard",
    "bluetooth": "bluetooth_standard",
    "operating system": "os",
    "\u043e\u043f\u0435\u0440\u0430\u0446\u0438\u043e\u043d\u043d\u0430\u044f \u0441\u0438\u0441\u0442\u0435\u043c\u0430": "os",
}

_PLACEHOLDER_SPEC_VALUES: set[str] = {
    "",
    "-",
    "--",
    "\u2014",
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "not specified",
    "\u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u043e",
}

_HEX_COLOR_PATTERN = re.compile(r"^(?:#|0x)?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

_OFFICIAL_COLOR_RGB: dict[str, tuple[int, int, int]] = {
    "deep blue": (0x35, 0x3B, 0x4C),
    "cosmic orange": (0xF0, 0x8F, 0x53),
    "mist blue": (0xBA, 0xCA, 0xE2),
    "silver shadow": (0xD9, 0xD3, 0xCE),
    "silver": (0xDE, 0xDE, 0xDE),
    "lightgray": (0xC0, 0xC0, 0xC0),
    "graphite": (0x2D, 0x30, 0x35),
    "jetblack": (0x2D, 0x30, 0x35),
    "blueblack": (0x31, 0x35, 0x40),
    "midnight": (0x00, 0x00, 0x00),
    "black": (0x00, 0x00, 0x00),
    "white": (0xF7, 0xF7, 0xF5),
    "gray": (0x80, 0x80, 0x80),
    "lavender": (0xE6, 0xE6, 0xFA),
    "sage": (0xC5, 0xD0, 0xAA),
    "mint": (0xAD, 0xEB, 0xB3),
    "icy blue": (0x8B, 0x9C, 0xB9),
    "teal": (0xB7, 0xD9, 0xD9),
    "ultramarine": (0x8A, 0x9E, 0xE7),
    "green": (0x00, 0x80, 0x00),
    "pink": (0xF7, 0xE2, 0xE4),
    "yellow": (0xFD, 0xFA, 0xEA),
    "blue": (0x00, 0x00, 0xFF),
}

_OFFICIAL_COLOR_ALIASES: dict[str, str] = {
    "titanium jetblack": "Titanium Jetblack",
    "titanium gray": "Titanium Gray",
    "silver shadow": "Silver Shadow",
    "cosmic orange": "Cosmic Orange",
    "deep blue": "Deep Blue",
    "mist blue": "Mist Blue",
    "blueblack": "Blueblack",
    "blue black": "Blueblack",
    "jetblack": "Jetblack",
    "jet black": "Jetblack",
    "lightgray": "Lightgray",
    "light gray": "Lightgray",
    "ultramarine": "Ultramarine",
    "icy blue": "Icy Blue",
    "lavender": "Lavender",
    "graphite": "Graphite",
    "midnight": "Midnight",
    "silver": "Silver",
    "black": "Black",
    "white": "White",
    "green": "Green",
    "yellow": "Yellow",
    "orange": "Orange",
    "purple": "Purple",
    "blue": "Blue",
    "pink": "Pink",
    "teal": "Teal",
    "mint": "Mint",
    "sage": "Sage",
    "gray": "Gray",
}
_OFFICIAL_COLOR_ALIAS_KEYS = sorted(_OFFICIAL_COLOR_ALIASES.keys(), key=len, reverse=True)


def _normalize_spec_key(raw_key: object) -> str:
    key = str(raw_key).strip().lower().replace("\u00a0", " ")
    key = key.replace("_", " ").replace("-", " ").replace("/", " ")
    key = re.sub(r"\s+", " ", key).strip()
    if not key:
        return ""
    alias = _SPEC_KEY_ALIASES.get(key, key)
    snake = re.sub(r"[^\w]+", "_", alias, flags=re.UNICODE).strip("_")
    if not snake:
        return ""
    return _SPEC_KEY_ALIASES.get(snake, snake)


def _normalize_spec_value(raw_value: object) -> str | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, bool):
        return "yes" if raw_value else "no"
    if isinstance(raw_value, (int, float, Decimal)):
        return str(raw_value)
    if isinstance(raw_value, dict):
        parts: list[str] = []
        for key, value in raw_value.items():
            normalized = _normalize_spec_value(value)
            if not normalized:
                continue
            clean_key = str(key).strip()
            parts.append(f"{clean_key}: {normalized}" if clean_key else normalized)
        return "; ".join(parts) or None
    if isinstance(raw_value, (list, tuple, set)):
        parts: list[str] = []
        seen: set[str] = set()
        for item in raw_value:
            normalized = _normalize_spec_value(item)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            parts.append(normalized)
        return ", ".join(parts) or None
    text = re.sub(r"\s+", " ", str(raw_value).replace("\u00a0", " ")).strip()
    return text or None


def _is_placeholder_spec_value(value: str) -> bool:
    return value.strip().lower() in _PLACEHOLDER_SPEC_VALUES


def _pick_preferred_spec_value(current: str | None, candidate: str) -> str:
    if not current:
        return candidate
    if _is_placeholder_spec_value(current) and not _is_placeholder_spec_value(candidate):
        return candidate
    if _is_placeholder_spec_value(candidate):
        return current

    current_digits = len(re.findall(r"\d", current))
    candidate_digits = len(re.findall(r"\d", candidate))
    if candidate_digits > current_digits:
        return candidate
    if len(candidate) > len(current):
        return candidate
    return current


def _merge_specs_maps(*sources: dict | None) -> dict[str, str]:
    merged: dict[str, str] = {}
    for source in sources:
        if not isinstance(source, dict):
            continue
        for raw_key, raw_value in source.items():
            key = _normalize_spec_key(raw_key)
            if not key:
                continue
            value = _normalize_spec_value(raw_value)
            if not value:
                continue
            merged[key] = _pick_preferred_spec_value(merged.get(key), value)
    return merged


def _normalize_color_text(value: str) -> str:
    text = str(value).strip().lower()
    text = text.replace("_", " ").replace("-", " ").replace("/", " ")
    text = re.sub(r"[^\w\s]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_hex_color(value: str | None) -> str | None:
    if not value:
        return None
    match = _HEX_COLOR_PATTERN.match(str(value).strip())
    if not match or not match.group(1):
        return None
    token = match.group(1).upper()
    if len(token) == 3:
        return "".join(ch + ch for ch in token)
    return token


def _rgb_from_hex(value: str) -> tuple[int, int, int]:
    return (
        int(value[0:2], 16),
        int(value[2:4], 16),
        int(value[4:6], 16),
    )


def _rgb_distance_sq(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


def _extract_official_color_name(value: str | None) -> str | None:
    if not value:
        return None
    text = _normalize_color_text(value)
    if not text:
        return None
    for alias in _OFFICIAL_COLOR_ALIAS_KEYS:
        if re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", text, flags=re.IGNORECASE):
            return _OFFICIAL_COLOR_ALIASES[alias]
    return None


def _color_rgb_from_value(value: str | None) -> tuple[int, int, int] | None:
    normalized_hex = _normalize_hex_color(value)
    if normalized_hex:
        return _rgb_from_hex(normalized_hex)

    official_name = _extract_official_color_name(value)
    if not official_name:
        return None
    return _OFFICIAL_COLOR_RGB.get(official_name.lower())


def _format_color_label(value: str | None) -> str | None:
    official_name = _extract_official_color_name(value)
    if official_name:
        return official_name
    if _normalize_hex_color(value) is not None:
        return None
    text = _normalize_color_text(value or "")
    if not text:
        return None
    return " ".join(part.capitalize() for part in text.split())


def _extract_model_signature(title: str) -> str | None:
    normalized = _normalize_color_text(title)
    normalized = re.sub(r"\b\d{2,4}\s*gb\b", " ", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\s+", " ", normalized).strip()

    iphone_match = re.search(
        r"\biphone\s+\d{1,2}(?:\s+pro\s+max|\s+pro|\s+plus|\s+mini|\s+max)?\b",
        normalized,
        flags=re.IGNORECASE,
    )
    if iphone_match:
        return re.sub(r"\s+", " ", iphone_match.group(0).lower()).strip()

    samsung_match = re.search(
        r"\bgalaxy\s+(?:a|s)\d{2}(?:\s+(?:ultra|plus|fe))?\b",
        normalized,
        flags=re.IGNORECASE,
    )
    if samsung_match:
        return re.sub(r"\s+", " ", samsung_match.group(0).lower()).strip()
    return None


class CatalogRepository:
    def __init__(self, session: AsyncSession, *, cursor_secret: str) -> None:
        self.session = session
        self.cursor_secret = cursor_secret.encode("utf-8")

    def _encode_cursor(self, payload: dict) -> str:
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        sig = hmac.new(self.cursor_secret, raw, hashlib.sha256).hexdigest()
        wrapped = {"d": payload, "s": sig}
        return base64.urlsafe_b64encode(json.dumps(wrapped, separators=(",", ":")).encode("utf-8")).decode("utf-8")

    def decode_cursor(self, cursor: str | None) -> dict | None:
        if not cursor:
            return None
        data = json.loads(base64.urlsafe_b64decode(cursor.encode("utf-8") + b"=="))
        raw = json.dumps(data["d"], separators=(",", ":"), sort_keys=True).encode("utf-8")
        expected = hmac.new(self.cursor_secret, raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, data["s"]):
            raise ValueError("invalid cursor signature")
        return data["d"]

    async def _resolve_official_color_name(
        self,
        *,
        product_id: int,
        title: str,
        color_value: str,
        category_id: int | None,
        brand_id: int | None,
    ) -> str | None:
        normalized_hex = _normalize_hex_color(color_value)
        if normalized_hex is None:
            return _format_color_label(color_value)

        target_rgb = _rgb_from_hex(normalized_hex)
        model_signature = _extract_model_signature(title)
        title_hint = _extract_official_color_name(title)
        if title_hint:
            title_hint_rgb = _OFFICIAL_COLOR_RGB.get(title_hint.lower())
            if title_hint_rgb is not None and _rgb_distance_sq(target_rgb, title_hint_rgb) <= 40000:
                return title_hint

        if category_id is None:
            return None

        candidate_stmt = text(
            """
            select cp.normalized_title as title, cp.specs->>'color' as color
            from catalog_canonical_products cp
            where cp.id <> :product_id
              and cp.category_id = :category_id
              and coalesce(cp.brand_id, -1) = coalesce(cast(:brand_id as bigint), -1)
              and similarity(lower(cp.normalized_title), lower(:title)) >= :min_similarity
            order by similarity(lower(cp.normalized_title), lower(:title)) desc, cp.id asc
            limit :limit
            """
        )
        candidate_rows = (
            await self.session.execute(
                candidate_stmt,
                {
                    "product_id": product_id,
                    "category_id": category_id,
                    "brand_id": brand_id,
                    "title": title,
                    "min_similarity": 0.22,
                    "limit": 80,
                },
            )
        ).mappings().all()

        best_by_name: dict[str, tuple[str, int]] = {}
        for row in candidate_rows:
            candidate_title = row.get("title") if isinstance(row.get("title"), str) else ""
            candidate_color = row.get("color") if isinstance(row.get("color"), str) else None
            normalized_candidate_title = _normalize_color_text(candidate_title)

            if model_signature and model_signature not in normalized_candidate_title:
                continue

            candidate_name = _extract_official_color_name(candidate_title) or _format_color_label(candidate_color)
            if not candidate_name:
                continue

            candidate_rgb = _color_rgb_from_value(candidate_color) or _OFFICIAL_COLOR_RGB.get(candidate_name.lower())
            if candidate_rgb is None:
                continue

            distance = _rgb_distance_sq(target_rgb, candidate_rgb)
            key = candidate_name.lower()
            current = best_by_name.get(key)
            if current is None or distance < current[1]:
                best_by_name[key] = (candidate_name, distance)

        if not best_by_name:
            return None

        best_name, best_distance = min(best_by_name.values(), key=lambda item: item[1])
        if best_distance > 140000:
            return None
        return best_name

    @staticmethod
    def _normalize_ref(value: str | int | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @staticmethod
    def _normalize_uuid_ref(value: str | None) -> str | None:
        normalized = str(value or "").strip()
        if not normalized:
            return None
        try:
            return str(UUID(normalized))
        except ValueError:
            return None

    @staticmethod
    def _entity_model(entity: Literal["product", "category", "brand", "store", "seller", "offer"]):
        model_map = {
            "product": CatalogCanonicalProduct,
            "category": CatalogCategory,
            "brand": CatalogBrand,
            "store": CatalogStore,
            "seller": CatalogSeller,
            "offer": CatalogOffer,
        }
        return model_map[entity]

    async def resolve_entity_ref(
        self,
        entity: Literal["product", "category", "brand", "store", "seller", "offer"],
        value: str | int | None,
        *,
        allow_numeric: bool = False,
    ) -> int | None:
        model = self._entity_model(entity)
        if isinstance(value, int):
            if value <= 0:
                return None
            numeric_match = (
                await self.session.execute(select(model.id).where(model.id == int(value)))
            ).scalar_one_or_none()
            if numeric_match is None:
                return None
            return int(numeric_match)

        normalized = self._normalize_ref(value)
        if normalized is None:
            return None

        if allow_numeric and normalized.isdigit():
            numeric_id = int(normalized)
            if numeric_id > 0:
                numeric_match = (
                    await self.session.execute(select(model.id).where(model.id == numeric_id))
                ).scalar_one_or_none()
                if numeric_match is not None:
                    return int(numeric_match)

        normalized_uuid = self._normalize_uuid_ref(normalized)
        if normalized_uuid is None:
            return None

        uuid_match = (
            await self.session.execute(select(model.id).where(model.uuid == normalized_uuid))
        ).scalar_one_or_none()
        if uuid_match is None:
            return None
        return int(uuid_match)

    async def resolve_entity_refs(
        self,
        entity: Literal["product", "category", "brand", "store", "seller", "offer"],
        values: list[str] | tuple[str, ...] | None,
        *,
        allow_numeric: bool = False,
    ) -> list[int] | None:
        if values is None:
            return None
        resolved: list[int] = []
        seen: set[int] = set()
        for value in values:
            entity_id = await self.resolve_entity_ref(entity, value, allow_numeric=allow_numeric)
            if entity_id is None or entity_id in seen:
                continue
            seen.add(entity_id)
            resolved.append(entity_id)
        return resolved

    async def resolve_product_with_offers(self, product_ref: str | int, *, allow_numeric: bool = False) -> int | None:
        product_id = await self.resolve_entity_ref("product", product_ref, allow_numeric=allow_numeric)
        if product_id is None:
            return None

        current_offers = (
            await self.session.execute(
                select(func.count(CatalogOffer.id)).where(
                    CatalogOffer.canonical_product_id == product_id,
                    CatalogOffer.is_valid.is_(True),
                )
            )
        ).scalar_one()
        if int(current_offers or 0) > 0:
            return product_id

        best_candidate_stmt = text(
            """
            with seed as (
                select id, normalized_title, category_id, brand_id
                from catalog_canonical_products
                where id = :product_id
            ),
            ranked as (
                select
                    cp.id,
                    similarity(lower(cp.normalized_title), lower(seed.normalized_title)) as sim,
                    count(o.id) as offers_count
                from seed
                join catalog_canonical_products cp
                  on cp.is_active = true
                 and cp.id <> seed.id
                 and cp.category_id = seed.category_id
                 and (seed.brand_id is null or cp.brand_id is not distinct from seed.brand_id)
                join catalog_offers o
                  on o.canonical_product_id = cp.id
                 and o.is_valid = true
                group by cp.id, seed.normalized_title
            )
            select id
            from ranked
            where sim >= :min_similarity
            order by sim desc, offers_count desc, id asc
            limit 1
            """
        )
        candidate = (
            await self.session.execute(
                best_candidate_stmt,
                {"product_id": product_id, "min_similarity": 0.30},
            )
        ).scalar_one_or_none()
        if candidate is None:
            return product_id
        return int(candidate)

    async def get_product(self, product_ref: str | int, *, allow_numeric: bool = False) -> dict | None:
        product_id = await self.resolve_entity_ref("product", product_ref, allow_numeric=allow_numeric)
        if product_id is None:
            return None

        visited: set[int] = set()
        row = None
        while True:
            if product_id in visited:
                return None
            visited.add(product_id)
            stmt = (
                select(
                    CatalogCanonicalProduct.id,
                    CatalogCanonicalProduct.uuid,
                    CatalogCanonicalProduct.normalized_title,
                    CatalogCanonicalProduct.main_image,
                    CatalogCanonicalProduct.specs,
                    CatalogCanonicalProduct.category_id,
                    CatalogCanonicalProduct.brand_id,
                    CatalogCanonicalProduct.is_active,
                    CatalogCanonicalProduct.merged_into_id,
                    CatalogCategory.name_uz.label("category_name"),
                    CatalogBrand.name.label("brand_name"),
                )
                .join(CatalogCategory, CatalogCategory.id == CatalogCanonicalProduct.category_id)
                .outerjoin(CatalogBrand, CatalogBrand.id == CatalogCanonicalProduct.brand_id)
                .where(CatalogCanonicalProduct.id == product_id)
            )
            row = (await self.session.execute(stmt)).one_or_none()
            if row is None:
                return None
            if row.is_active or not row.merged_into_id:
                break
            product_id = int(row.merged_into_id)

        fallback_specs_stmt = text(
            """
            with candidates as (
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
                    last_seen_at
                from catalog_store_products
                where canonical_product_id = :product_id
            )
            select specs
            from candidates
            where specs <> '{}'::jsonb
            order by specs_count desc, last_seen_at desc
            limit 8
            """
        )
        fallback_rows = (await self.session.execute(fallback_specs_stmt, {"product_id": product_id})).all()
        fallback_specs = [row_.specs for row_ in fallback_rows if isinstance(row_.specs, dict)]

        specs = _merge_specs_maps(
            row.specs if isinstance(row.specs, dict) else {},
            *fallback_specs,
        )

        raw_color = specs.get("color")
        if raw_color is not None:
            resolved_color = await self._resolve_official_color_name(
                product_id=int(row.id),
                title=str(row.normalized_title),
                color_value=str(raw_color),
                category_id=int(row.category_id) if row.category_id is not None else None,
                brand_id=int(row.brand_id) if row.brand_id is not None else None,
            )
            if resolved_color:
                specs["color"] = resolved_color
        title_color_hint = _extract_official_color_name(str(row.normalized_title))
        if title_color_hint:
            specs["color"] = title_color_hint

        gallery_stmt = text(
            """
            select
                image_url,
                case
                    when jsonb_typeof(metadata->'images') = 'array' then metadata->'images'
                    else '[]'::jsonb
                end as images
            from catalog_store_products
            where canonical_product_id = :product_id
            order by last_seen_at desc, id desc
            limit 40
            """
        )
        gallery_rows = (await self.session.execute(gallery_stmt, {"product_id": product_id})).all()
        gallery_images: list[str] = []
        seen_images: set[str] = set()

        def push_gallery(url: object) -> None:
            value = str(url or "").strip()
            if not value:
                return
            if value in seen_images:
                return
            seen_images.add(value)
            gallery_images.append(value)

        push_gallery(row.main_image)
        for gallery_row in gallery_rows:
            push_gallery(gallery_row.image_url)
            raw_images = gallery_row.images if hasattr(gallery_row, "images") else None
            if isinstance(raw_images, list):
                for image in raw_images:
                    push_gallery(image)
        gallery_images = gallery_images[:24]

        return {
            "id": row.uuid,
            "legacy_id": row.id,
            "title": row.normalized_title,
            "category": row.category_name,
            "brand": row.brand_name,
            "main_image": row.main_image,
            "gallery_images": gallery_images,
            "specs": specs,
        }

    async def get_offers_by_store(
        self,
        product_id: int,
        limit: int,
        in_stock: bool | None,
        sort: str = "price",
        store_ids: list[int] | None = None,
        seller_ids: list[int] | None = None,
        max_delivery_days: int | None = None,
    ) -> list[dict]:
        stmt = (
            select(
                CatalogOffer.id,
                CatalogOffer.uuid.label("offer_uuid"),
                CatalogOffer.store_id,
                CatalogStore.uuid.label("store_uuid"),
                CatalogStore.name.label("store_name"),
                CatalogOffer.seller_id,
                CatalogSeller.uuid.label("seller_uuid"),
                CatalogSeller.name.label("seller_name"),
                CatalogOffer.price_amount,
                CatalogOffer.old_price_amount,
                CatalogOffer.in_stock,
                CatalogOffer.currency,
                CatalogOffer.delivery_days,
                CatalogOffer.scraped_at,
                func.coalesce(CatalogOffer.offer_url, CatalogStoreProduct.external_url).label("link"),
            )
            .join(CatalogStore, CatalogStore.id == CatalogOffer.store_id)
            .join(CatalogStoreProduct, CatalogStoreProduct.id == CatalogOffer.store_product_id)
            .outerjoin(CatalogSeller, CatalogSeller.id == CatalogOffer.seller_id)
            .where(
                CatalogOffer.canonical_product_id == product_id,
                CatalogOffer.is_valid.is_(True),
            )
        )
        if in_stock is not None:
            stmt = stmt.where(CatalogOffer.in_stock == in_stock)
        if store_ids:
            stmt = stmt.where(CatalogOffer.store_id.in_(store_ids))
        if seller_ids:
            stmt = stmt.where(CatalogOffer.seller_id.in_(seller_ids))
        if max_delivery_days is not None:
            stmt = stmt.where(CatalogOffer.delivery_days.is_not(None), CatalogOffer.delivery_days <= max_delivery_days)

        max_offers_per_store = 3
        order_map = {
            "price": CatalogOffer.price_amount.asc(),
            "delivery": CatalogOffer.delivery_days.asc().nulls_last(),
            "seller_rating": CatalogSeller.rating.desc().nulls_last(),
        }
        stmt = stmt.order_by(order_map.get(sort, order_map["price"]), CatalogOffer.scraped_at.desc(), CatalogOffer.id.desc()).limit(limit)
        rows = (await self.session.execute(stmt)).all()

        by_store: dict[int, dict] = {}
        for row in rows:
            if row.store_id not in by_store:
                by_store[row.store_id] = {
                    "store_id": row.store_uuid,
                    "store": row.store_name,
                    "minimal_price": None,
                    "offers_count": 0,
                    "offers": [],
                    "_seen_links": set(),
                }
            bucket = by_store[row.store_id]
            link_key = str(row.link or row.offer_uuid)
            if link_key in bucket["_seen_links"]:
                continue
            if len(bucket["offers"]) >= max_offers_per_store:
                continue

            bucket["_seen_links"].add(link_key)
            offer_payload = {
                "id": row.offer_uuid,
                "seller_id": row.seller_uuid,
                "seller_name": row.seller_name or row.store_name,
                "price_amount": float(row.price_amount),
                "old_price_amount": float(row.old_price_amount) if row.old_price_amount is not None else None,
                "in_stock": row.in_stock,
                "currency": row.currency,
                "delivery_days": row.delivery_days,
                "scraped_at": row.scraped_at,
                "link": row.link,
            }
            bucket["offers"].append(offer_payload)
            bucket["offers_count"] += 1
            if bucket["minimal_price"] is None or offer_payload["price_amount"] < bucket["minimal_price"]:
                bucket["minimal_price"] = offer_payload["price_amount"]

        result = []
        for item in by_store.values():
            item.pop("_seen_links", None)
            result.append(item)

        result.sort(
            key=lambda item: (item["minimal_price"] if item["minimal_price"] is not None else 10**18),
        )
        return result

    async def get_offers(
        self,
        product_id: int,
        limit: int,
        in_stock: bool | None,
        sort: str = "price",
        store_ids: list[int] | None = None,
        seller_ids: list[int] | None = None,
        max_delivery_days: int | None = None,
    ) -> list[dict]:
        offers_by_store = await self.get_offers_by_store(
            product_id=product_id,
            limit=limit,
            in_stock=in_stock,
            sort=sort,
            store_ids=store_ids,
            seller_ids=seller_ids,
            max_delivery_days=max_delivery_days,
        )
        return [offer for group in offers_by_store for offer in group["offers"]]

    async def get_product_compare_meta(self, product_id: int) -> dict:
        stmt = (
            select(
                CatalogProductSearch.min_price,
                CatalogProductSearch.max_price,
                CatalogProductSearch.store_count,
            )
            .where(CatalogProductSearch.product_id == product_id)
        )
        row = (await self.session.execute(stmt)).one_or_none()
        if row is None:
            return {
                "price_min": None,
                "price_max": None,
                "store_count": 0,
            }
        return {
            "price_min": float(row.min_price) if row.min_price is not None else None,
            "price_max": float(row.max_price) if row.max_price is not None else None,
            "store_count": int(row.store_count or 0),
        }

    async def search_products(
        self,
        *,
        q: str | None,
        category_id: int | None,
        brand_ids: list[int] | None,
        min_price: Decimal | None,
        max_price: Decimal | None,
        in_stock: bool | None,
        store_ids: list[int] | None,
        seller_ids: list[int] | None,
        max_delivery_days: int | None,
        sort: str,
        limit: int,
        cursor: str | None,
    ) -> tuple[list[dict], str | None]:
        rank_expr = func.ts_rank_cd(CatalogProductSearch.tsv, func.websearch_to_tsquery("simple", q or ""))
        stmt = (
            select(
                CatalogCanonicalProduct.id,
                CatalogCanonicalProduct.uuid.label("product_uuid"),
                CatalogCanonicalProduct.normalized_title,
                CatalogCanonicalProduct.main_image,
                CatalogBrand.id.label("brand_id"),
                CatalogBrand.uuid.label("brand_uuid"),
                CatalogBrand.name.label("brand_name"),
                CatalogCategory.id.label("category_id"),
                CatalogCategory.uuid.label("category_uuid"),
                CatalogCategory.name_uz.label("category_name"),
                CatalogProductSearch.min_price,
                CatalogProductSearch.max_price,
                CatalogProductSearch.store_count,
                rank_expr.label("rank"),
            )
            .join(CatalogProductSearch, CatalogProductSearch.product_id == CatalogCanonicalProduct.id)
            .join(CatalogCategory, CatalogCategory.id == CatalogCanonicalProduct.category_id)
            .outerjoin(CatalogBrand, CatalogBrand.id == CatalogCanonicalProduct.brand_id)
            .where(
                or_(
                    CatalogCanonicalProduct.is_active.is_(True),
                    and_(
                        CatalogCanonicalProduct.is_active.is_(False),
                        CatalogCanonicalProduct.merged_into_id.is_(None),
                        CatalogProductSearch.store_count > 0,
                    ),
                )
            )
        )

        filters = []
        if q:
            filters.append(CatalogProductSearch.tsv.op("@@")(func.websearch_to_tsquery("simple", q)))
        if category_id:
            filters.append(CatalogCanonicalProduct.category_id == category_id)
        if brand_ids:
            filters.append(CatalogCanonicalProduct.brand_id.in_(brand_ids))
        if min_price is not None:
            filters.append(CatalogProductSearch.min_price >= min_price)
        if max_price is not None:
            filters.append(CatalogProductSearch.min_price <= max_price)
        if in_stock is True:
            filters.append(CatalogProductSearch.store_count > 0)
        elif in_stock is None:
            filters.append(CatalogProductSearch.store_count > 0)
        if store_ids:
            filters.append(
                CatalogCanonicalProduct.id.in_(
                    select(CatalogOffer.canonical_product_id).where(
                        CatalogOffer.store_id.in_(store_ids),
                        CatalogOffer.is_valid.is_(True),
                    )
                )
            )
        if seller_ids:
            filters.append(
                CatalogCanonicalProduct.id.in_(
                    select(CatalogOffer.canonical_product_id).where(
                        CatalogOffer.seller_id.in_(seller_ids),
                        CatalogOffer.is_valid.is_(True),
                    )
                )
            )
        if max_delivery_days is not None:
            filters.append(
                CatalogCanonicalProduct.id.in_(
                    select(CatalogOffer.canonical_product_id).where(
                        CatalogOffer.delivery_days.is_not(None),
                        CatalogOffer.delivery_days <= max_delivery_days,
                        CatalogOffer.is_valid.is_(True),
                    )
                )
            )
        if filters:
            stmt = stmt.where(and_(*filters))

        sort_map = {
            "relevance": [literal_column("rank").desc(), CatalogCanonicalProduct.id.asc()],
            "price_asc": [CatalogProductSearch.min_price.asc().nulls_last(), CatalogCanonicalProduct.id.asc()],
            "price_desc": [CatalogProductSearch.min_price.desc().nulls_last(), CatalogCanonicalProduct.id.asc()],
            "newest": [CatalogCanonicalProduct.created_at.desc(), CatalogCanonicalProduct.id.asc()],
            "popular": [CatalogProductSearch.store_count.desc(), CatalogCanonicalProduct.id.asc()],
        }
        stmt = stmt.order_by(*sort_map.get(sort, sort_map["relevance"]))

        decoded = self.decode_cursor(cursor)
        if decoded:
            last_price = Decimal(decoded["last_price"]) if "last_price" in decoded else None
            if sort == "price_asc":
                stmt = stmt.where(
                    (CatalogProductSearch.min_price > last_price)
                    | ((CatalogProductSearch.min_price == last_price) & (CatalogCanonicalProduct.id > decoded["last_id"]))
                )
            elif sort == "price_desc":
                stmt = stmt.where(
                    (CatalogProductSearch.min_price < last_price)
                    | ((CatalogProductSearch.min_price == last_price) & (CatalogCanonicalProduct.id > decoded["last_id"]))
                )
            else:
                stmt = stmt.where(CatalogCanonicalProduct.id > decoded["last_id"])

        rows = (await self.session.execute(stmt.limit(limit + 1))).all()
        has_next = len(rows) > limit
        rows = rows[:limit]

        items = [
            {
                "id": r.product_uuid,
                "normalized_title": r.normalized_title,
                "image_url": r.main_image,
                "brand": {"id": r.brand_uuid, "name": r.brand_name} if r.brand_id else None,
                "category": {"id": r.category_uuid, "name": r.category_name},
                "min_price": float(r.min_price) if r.min_price is not None else None,
                "max_price": float(r.max_price) if r.max_price is not None else None,
                "store_count": r.store_count,
                "score": float(r.rank or 0),
            }
            for r in rows
        ]

        next_cursor = None
        if has_next and rows:
            last = rows[-1]
            payload = {"last_id": last.id, "sort": sort}
            if sort in {"price_asc", "price_desc"}:
                payload["last_price"] = str(last.min_price or "0")
            next_cursor = self._encode_cursor(payload)

        return items, next_cursor

    async def list_categories(self) -> list[dict]:
        rows = (
            await self.session.execute(
                select(CatalogCategory.id, CatalogCategory.uuid, CatalogCategory.slug, CatalogCategory.name_uz, CatalogCategory.parent_id)
                .where(CatalogCategory.is_active.is_(True))
                .order_by(CatalogCategory.lft.asc(), CatalogCategory.id.asc())
            )
        ).all()
        id_to_uuid = {int(r.id): r.uuid for r in rows}
        return [
            {
                "id": r.uuid,
                "slug": r.slug,
                "name": r.name_uz,
                "parent_id": id_to_uuid.get(int(r.parent_id)) if r.parent_id is not None else None,
            }
            for r in rows
        ]

    async def list_stores(self, active_only: bool) -> list[dict]:
        stmt = select(CatalogStore.id, CatalogStore.uuid, CatalogStore.slug, CatalogStore.name, CatalogStore.is_active)
        if active_only:
            stmt = stmt.where(CatalogStore.is_active.is_(True))
        rows = (await self.session.execute(stmt.order_by(CatalogStore.name.asc()))).all()
        return [{"id": r.uuid, "slug": r.slug, "name": r.name, "is_active": r.is_active} for r in rows]

    async def list_brands(self, q: str | None = None, category_id: int | None = None, limit: int = 100) -> list[dict]:
        stmt = (
            select(CatalogBrand.id, CatalogBrand.uuid, CatalogBrand.name, func.count(CatalogCanonicalProduct.id).label("products_count"))
            .join(CatalogCanonicalProduct, CatalogCanonicalProduct.brand_id == CatalogBrand.id, isouter=True)
            .group_by(CatalogBrand.id, CatalogBrand.name)
            .order_by(CatalogBrand.name.asc())
            .limit(limit)
        )
        if q:
            stmt = stmt.where(CatalogBrand.name.ilike(f"%{q}%"))
        if category_id:
            stmt = stmt.where(CatalogCanonicalProduct.category_id == category_id)
        rows = (await self.session.execute(stmt)).all()
        return [{"id": r.uuid, "name": r.name, "products_count": r.products_count} for r in rows]

    async def get_filter_buckets(self, category_id: int | None = None, q: str | None = None) -> dict:
        base = (
            select(
                func.min(CatalogProductSearch.min_price),
                func.max(CatalogProductSearch.max_price),
                func.count(CatalogCanonicalProduct.id),
            )
            .join(CatalogCanonicalProduct, CatalogCanonicalProduct.id == CatalogProductSearch.product_id)
        )
        if category_id:
            base = base.where(CatalogCanonicalProduct.category_id == category_id)
        if q:
            base = base.where(CatalogProductSearch.tsv.op("@@")(func.websearch_to_tsquery("simple", q)))

        min_price, max_price, count = (await self.session.execute(base)).one()
        brands = await self.list_brands(category_id=category_id, limit=50)
        sellers_stmt = (
            select(CatalogSeller.id, CatalogSeller.uuid, CatalogSeller.name, func.count(CatalogOffer.id).label("offers_count"))
            .join(CatalogOffer, CatalogOffer.seller_id == CatalogSeller.id)
            .join(CatalogCanonicalProduct, CatalogCanonicalProduct.id == CatalogOffer.canonical_product_id)
            .group_by(CatalogSeller.id, CatalogSeller.name)
            .order_by(func.count(CatalogOffer.id).desc())
            .limit(100)
        )
        if category_id:
            sellers_stmt = sellers_stmt.where(CatalogCanonicalProduct.category_id == category_id)
        sellers_rows = (await self.session.execute(sellers_stmt)).all()
        return {
            "price": {"min": min_price, "max": max_price},
            "brands": brands,
            "stores": await self.list_stores(active_only=True),
            "sellers": [{"id": row.uuid, "name": row.name, "offers_count": row.offers_count} for row in sellers_rows],
            "total_products": count,
        }

    async def price_history(self, product_id: int, days: int) -> list[dict]:
        stmt = text(
            """
            select date_trunc('day', ph.captured_at) as day,
                   min(ph.price_amount) as min_price,
                   max(ph.price_amount) as max_price
            from catalog_price_history ph
            join catalog_offers o on o.id = ph.offer_id
            where o.canonical_product_id = :product_id
              and ph.captured_at >= now() - make_interval(days => :days)
            group by 1
            order by 1 asc
            """
        )
        rows = (await self.session.execute(stmt, {"product_id": product_id, "days": days})).all()
        return [{"date": r.day.date().isoformat(), "min_price": r.min_price, "max_price": r.max_price} for r in rows]
