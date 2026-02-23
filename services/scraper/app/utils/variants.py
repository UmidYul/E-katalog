from __future__ import annotations

import itertools
import json
import re
from decimal import Decimal, InvalidOperation

from app.parsers.base import ParsedVariant

_KNOWN_COLORS: tuple[str, ...] = (
    "black",
    "white",
    "silver",
    "gray",
    "grey",
    "graphite",
    "midnight",
    "blue",
    "deep blue",
    "mist blue",
    "cosmic orange",
    "orange",
    "green",
    "mint",
    "sage",
    "pink",
    "purple",
    "lavender",
    "red",
    "gold",
    "beige",
    "yellow",
)

_VALID_STORAGE_GB: set[int] = {16, 32, 64, 128, 256, 512, 1024, 2048}
_COLOR_NAME_HINTS: tuple[str, ...] = ("color", "colour", "цвет", "rang")
_STORAGE_NAME_HINTS: tuple[str, ...] = (
    "storage",
    "memory",
    "rom",
    "объем встроенной памяти",
    "встроенная память",
    "xotira",
)
_RAM_NAME_HINTS: tuple[str, ...] = (
    "ram",
    "оператив",
    "оперативная память",
)
_PRICE_KEYS: tuple[str, ...] = (
    "price",
    "sellprice",
    "minsellprice",
    "currentprice",
    "discountprice",
    "minprice",
)
_OLD_PRICE_KEYS: tuple[str, ...] = (
    "oldprice",
    "fullprice",
    "originalprice",
    "maxsellprice",
    "listprice",
)
_ID_KEYS: tuple[str, ...] = (
    "variation_id",
    "variationid",
    "variant_id",
    "variantid",
    "sku",
    "skuid",
    "offerid",
    "id",
)
_IMAGE_KEYS: tuple[str, ...] = (
    "image",
    "imageurl",
    "img",
    "photo",
    "photourl",
    "thumb",
    "thumbnail",
)
_IMAGE_LIST_KEYS: tuple[str, ...] = (
    "images",
    "photos",
    "gallery",
)
_ATTR_KEYS: tuple[str, ...] = (
    "attributes",
    "attributevalues",
    "variationattributes",
    "characteristics",
    "characteristicvalues",
    "specifications",
    "specs",
    "properties",
    "params",
    "options",
)


def _dedupe(values: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = value.strip()
        if not normalized:
            continue
        lowered = normalized.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        unique.append(normalized)
    return unique


def _sanitize_key_token(value: str) -> str:
    lowered = value.strip().lower()
    lowered = lowered.replace("'", "")
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    return lowered.strip("-")


def build_variant_key(color: str | None, storage: str | None, ram: str | None) -> str:
    parts: list[str] = []
    if color:
        token = _sanitize_key_token(color)
        if token:
            parts.append(f"c:{token}")
    if storage:
        token = _sanitize_key_token(storage)
        if token:
            parts.append(f"s:{token}")
    if ram:
        token = _sanitize_key_token(ram)
        if token:
            parts.append(f"r:{token}")
    if not parts:
        return "default"
    return "|".join(parts)


def _extract_storage_candidates(text: str) -> list[str]:
    values: list[str] = []
    for match in re.findall(r"(?<!\d)(\d{2,4})\s*(?:gb|\u0433\u0431)\b", text, flags=re.IGNORECASE):
        try:
            numeric = int(match)
        except ValueError:
            continue
        if numeric in _VALID_STORAGE_GB:
            values.append(str(numeric))
    for match in re.findall(r"(?<!\d)([1-2])\s*(?:tb|\u0442\u0431)\b", text, flags=re.IGNORECASE):
        try:
            numeric = int(match) * 1024
        except ValueError:
            continue
        if numeric in _VALID_STORAGE_GB:
            values.append(str(numeric))
    return _dedupe(values)


def _extract_ram_candidates(text: str) -> list[str]:
    values: list[str] = []
    patterns = (
        r"(?:ram|\u043e\u043f\u0435\u0440\u0430\u0442\u0438\u0432(?:\u043d\u0430\u044f)?\s+\u043f\u0430\u043c\u044f\u0442\u044c)\D{0,20}(\d{1,2})\s*(?:gb|\u0433\u0431)\b",
        r"(\d{1,2})\s*(?:gb|\u0433\u0431)\s*ram\b",
    )
    for pattern in patterns:
        for match in re.findall(pattern, text, flags=re.IGNORECASE):
            try:
                numeric = int(match)
            except ValueError:
                continue
            if 1 <= numeric <= 32:
                values.append(str(numeric))
    return _dedupe(values)


def _extract_color_candidates(text: str) -> list[str]:
    values: list[str] = []
    lowered = text.lower()
    for color in _KNOWN_COLORS:
        if re.search(rf"(?<!\w){re.escape(color)}(?!\w)", lowered):
            values.append(color.title())
    return _dedupe(values)


def _first_storage(specs: dict[str, str] | None) -> str | None:
    if not isinstance(specs, dict):
        return None
    for key in ("storage_gb", "storage", "built_in_memory", "memory"):
        value = specs.get(key)
        if not value:
            continue
        candidates = _extract_storage_candidates(str(value))
        if candidates:
            return candidates[0]
    return None


def _first_ram(specs: dict[str, str] | None) -> str | None:
    if not isinstance(specs, dict):
        return None
    for key in ("ram_gb", "ram"):
        value = specs.get(key)
        if not value:
            continue
        candidates = _extract_ram_candidates(f"{key} {value}")
        if candidates:
            return candidates[0]
    return None


def _first_color(specs: dict[str, str] | None) -> str | None:
    if not isinstance(specs, dict):
        return None
    for key in ("color",):
        value = specs.get(key)
        if not value:
            continue
        candidates = _extract_color_candidates(str(value))
        if candidates:
            return candidates[0]
        normalized = str(value).strip()
        if normalized:
            return normalized
    return None


def _merge_images(primary: list[str] | None, secondary: list[str] | None) -> list[str]:
    candidates = [*(primary or []), *(secondary or [])]
    unique: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        value = str(item or "").strip()
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        unique.append(value)
    return unique


def _to_decimal(value: object) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None
    text = str(value).strip()
    if not text:
        return None
    cleaned = "".join(ch for ch in text if ch.isdigit() or ch in {".", ","}).replace(",", ".")
    if not cleaned:
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _iter_objects(node: object):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _iter_objects(value)
        return
    if isinstance(node, list):
        for item in node:
            yield from _iter_objects(item)


def _extract_named_values(node: object) -> dict[str, str]:
    result: dict[str, str] = {}
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, (str, int, float, bool)):
                result[str(key)] = str(value)
        return result

    if not isinstance(node, list):
        return result

    for item in node:
        if not isinstance(item, dict):
            continue
        key = item.get("name") or item.get("title") or item.get("key") or item.get("attribute")
        raw_value = item.get("value")
        if raw_value is None:
            values = item.get("values")
            if isinstance(values, list):
                parts: list[str] = []
                for entry in values:
                    if isinstance(entry, dict):
                        candidate = entry.get("value") or entry.get("title") or entry.get("name")
                        if candidate is not None:
                            parts.append(str(candidate))
                    elif entry is not None:
                        parts.append(str(entry))
                if parts:
                    raw_value = ", ".join(parts)
            elif isinstance(values, dict):
                raw_value = values.get("value") or values.get("title") or values.get("name")
        if key is None or raw_value is None:
            continue
        result[str(key)] = str(raw_value)
    return result


def _is_color_name(name: str) -> bool:
    lowered = name.lower()
    return any(hint in lowered for hint in _COLOR_NAME_HINTS)


def _is_storage_name(name: str) -> bool:
    lowered = name.lower()
    return any(hint in lowered for hint in _STORAGE_NAME_HINTS)


def _is_ram_name(name: str) -> bool:
    lowered = name.lower()
    return any(hint in lowered for hint in _RAM_NAME_HINTS)


def _extract_direct_images(obj: dict) -> list[str]:
    images: list[str] = []
    lower_map = {str(key).lower(): value for key, value in obj.items()}

    def add(value: object) -> None:
        if value is None:
            return
        candidate = str(value).strip().replace("\\/", "/")
        if not candidate:
            return
        if not candidate.lower().startswith("http"):
            return
        images.append(candidate)

    for key in _IMAGE_KEYS:
        if key in lower_map:
            add(lower_map[key])

    for key in _IMAGE_LIST_KEYS:
        value = lower_map.get(key)
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    for dict_key in _IMAGE_KEYS:
                        nested = item.get(dict_key) or item.get(dict_key.capitalize())
                        add(nested)
                else:
                    add(item)
        elif isinstance(value, dict):
            for dict_key in _IMAGE_KEYS:
                add(value.get(dict_key) or value.get(dict_key.capitalize()))

    return _dedupe(images)


def _pick_value(obj: dict, keys: tuple[str, ...]) -> object | None:
    lower_map = {str(key).lower(): value for key, value in obj.items()}
    for key in keys:
        if key in lower_map:
            return lower_map[key]
    return None


def _extract_availability(obj: dict, default_availability: str) -> str:
    lower_map = {str(key).lower(): value for key, value in obj.items()}

    for key in ("instock", "isavailable", "available"):
        if key in lower_map:
            value = lower_map[key]
            if isinstance(value, bool):
                return "in_stock" if value else "out_of_stock"
            text = str(value).strip().lower()
            if text in {"true", "1", "yes", "available", "in_stock"}:
                return "in_stock"
            if text in {"false", "0", "no", "out_of_stock", "not_available"}:
                return "out_of_stock"

    quantity_value = lower_map.get("quantity") or lower_map.get("stock")
    if quantity_value is not None:
        qty = _to_decimal(quantity_value)
        if qty is not None:
            return "in_stock" if qty > 0 else "out_of_stock"

    stock_type = str(lower_map.get("stocktype") or "").lower()
    if stock_type:
        if any(token in stock_type for token in ("instock", "available", "in_stock", "in")):
            return "in_stock"
        if any(token in stock_type for token in ("out", "none", "unavailable")):
            return "out_of_stock"

    return default_availability


def _variant_key_with_fallback(color: str | None, storage: str | None, ram: str | None, external_id: object) -> str:
    key = build_variant_key(color, storage, ram)
    if key != "default":
        return key
    ext = _sanitize_key_token(str(external_id or ""))
    if ext:
        return f"ext:{ext[:120]}"
    return "default"


def _variant_from_object(
    obj: dict,
    *,
    default_price: Decimal,
    default_old_price: Decimal | None,
    default_availability: str,
    default_images: list[str],
    default_specs: dict[str, str],
    product_url: str,
) -> ParsedVariant | None:
    lower_map = {str(key).lower(): value for key, value in obj.items()}
    has_variant_hint = any(
        token in str(key).lower()
        for key in lower_map.keys()
        for token in ("variant", "variation", "attribute", "option")
    )

    named_values: dict[str, str] = {}
    for attr_key in _ATTR_KEYS:
        if attr_key in lower_map:
            named_values.update(_extract_named_values(lower_map[attr_key]))

    for key in ("color", "storage", "ram", "memory", "storage_gb", "ram_gb"):
        if key in lower_map and lower_map[key] is not None:
            named_values.setdefault(key, str(lower_map[key]))

    color: str | None = None
    storage: str | None = None
    ram: str | None = None

    for name, value in named_values.items():
        if color is None and _is_color_name(name):
            colors = _extract_color_candidates(value)
            if colors:
                color = colors[0]
            elif value.strip():
                color = value.strip()
        if storage is None and _is_storage_name(name):
            storages = _extract_storage_candidates(value)
            if storages:
                storage = storages[0]
        if ram is None and _is_ram_name(name):
            rams = _extract_ram_candidates(f"{name} {value}")
            if rams:
                ram = rams[0]

    if color is None:
        colors = _extract_color_candidates(" ".join(named_values.values()))
        if colors:
            color = colors[0]
    if storage is None:
        storages = _extract_storage_candidates(" ".join(named_values.values()))
        if storages:
            storage = storages[0]
    if ram is None:
        rams = _extract_ram_candidates(" ".join(named_values.values()))
        if rams:
            ram = rams[0]

    external_id = _pick_value(obj, _ID_KEYS)
    if color is None and storage is None and ram is None:
        if external_id is None:
            return None
        if not named_values and not has_variant_hint:
            return None

    price = _to_decimal(_pick_value(obj, _PRICE_KEYS)) or default_price
    old_price = _to_decimal(_pick_value(obj, _OLD_PRICE_KEYS)) or default_old_price
    availability = _extract_availability(obj, default_availability)

    images = _merge_images(_extract_direct_images(obj), default_images)
    specs = dict(default_specs)
    if color:
        specs["color"] = color
    if storage:
        specs.setdefault("storage_gb", storage)
    if ram:
        specs.setdefault("ram_gb", ram)

    return ParsedVariant(
        variant_key=_variant_key_with_fallback(color, storage, ram, external_id),
        price=price,
        old_price=old_price,
        availability=availability,
        color=color,
        storage=storage,
        ram=ram,
        images=images,
        specifications=specs,
        product_url=product_url,
    )


def extract_variants_from_network_payloads(
    payloads: list[str],
    *,
    default_price: Decimal,
    default_old_price: Decimal | None,
    default_availability: str,
    default_images: list[str] | None,
    default_specs: dict[str, str] | None,
    product_url: str,
    store_hint: str | None = None,
    max_variants: int = 24,
) -> list[ParsedVariant]:
    del store_hint

    variants_by_key: dict[str, ParsedVariant] = {}
    for payload in payloads[:80]:
        body = str(payload or "").strip()
        if len(body) < 2:
            continue
        if not (body.startswith("{") or body.startswith("[")):
            continue
        try:
            root = json.loads(body)
        except Exception:
            continue

        for obj in _iter_objects(root):
            if not isinstance(obj, dict):
                continue
            variant = _variant_from_object(
                obj,
                default_price=default_price,
                default_old_price=default_old_price,
                default_availability=default_availability,
                default_images=list(default_images or []),
                default_specs=dict(default_specs or {}),
                product_url=product_url,
            )
            if variant is None:
                continue

            existing = variants_by_key.get(variant.variant_key)
            if existing is None:
                variants_by_key[variant.variant_key] = variant
                if len(variants_by_key) >= max_variants:
                    break
                continue

            current_score = int(bool(existing.color)) + int(bool(existing.storage)) + int(bool(existing.ram)) + len(existing.images)
            next_score = int(bool(variant.color)) + int(bool(variant.storage)) + int(bool(variant.ram)) + len(variant.images)
            if next_score > current_score:
                variants_by_key[variant.variant_key] = variant

            if len(variants_by_key) >= max_variants:
                break
        if len(variants_by_key) >= max_variants:
            break

    return list(variants_by_key.values())[:max_variants]


def infer_variants(
    *,
    title: str,
    specs: dict[str, str] | None,
    source_text: str | None,
    price: Decimal,
    old_price: Decimal | None,
    availability: str,
    images: list[str] | None,
    product_url: str,
    max_variants: int = 18,
    color_image_map: dict[str, str] | None = None,
) -> list[ParsedVariant]:
    text = " ".join(part for part in [title, source_text or ""] if part).strip()
    colors = _extract_color_candidates(text)
    storages = _extract_storage_candidates(text)
    rams = _extract_ram_candidates(text)

    spec_color = _first_color(specs)
    spec_storage = _first_storage(specs)
    spec_ram = _first_ram(specs)

    if spec_color:
        colors = _dedupe([spec_color, *colors])
    if spec_storage:
        storages = _dedupe([spec_storage, *storages])
    if spec_ram:
        rams = _dedupe([spec_ram, *rams])

    color_axis: list[str | None] = colors or [None]
    storage_axis: list[str | None] = storages or [None]
    ram_axis: list[str | None] = rams or [None]

    matrix: list[tuple[str | None, str | None, str | None]] = list(itertools.product(color_axis, storage_axis, ram_axis))
    if len(matrix) > max_variants:
        matrix = matrix[:max_variants]

    variants: list[ParsedVariant] = []
    seen_keys: set[str] = set()
    for color, storage, ram in matrix:
        variant_key = build_variant_key(color, storage, ram)
        if variant_key in seen_keys:
            continue
        seen_keys.add(variant_key)

        variant_images = images or []
        if color and color_image_map:
            image = color_image_map.get(color.lower())
            if image:
                variant_images = _merge_images([image], variant_images)

        variant_specs = dict(specs or {})
        if color:
            variant_specs["color"] = color
        if storage:
            variant_specs.setdefault("storage_gb", storage)
        if ram:
            variant_specs.setdefault("ram_gb", ram)

        variants.append(
            ParsedVariant(
                variant_key=variant_key,
                price=price,
                old_price=old_price,
                availability=availability,
                color=color,
                storage=storage,
                ram=ram,
                images=variant_images,
                specifications=variant_specs,
                product_url=product_url,
            )
        )

    if variants:
        return variants

    return [
        ParsedVariant(
            variant_key="default",
            price=price,
            old_price=old_price,
            availability=availability,
            images=images or [],
            specifications=dict(specs or {}),
            product_url=product_url,
        )
    ]
