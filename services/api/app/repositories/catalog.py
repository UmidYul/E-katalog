from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from datetime import datetime
from decimal import Decimal
from typing import Literal
from urllib.parse import unquote
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

_SPEC_RUNTIME_KEY_ALIASES: dict[str, str] = {
    "sim_type_card": "sim_count",
    "sim_type": "sim_count",
    "type_sim": "sim_count",
    "sim": "sim_count",
    "network": "network_standard",
    "network_type": "network_standard",
    "headphone_output": "headphone_connector",
    "headphone_jack": "headphone_connector",
    "headset_jack": "headphone_connector",
    "wireless_interfaces": "wireless_interfaces",
    "charging_port": "charging_connector",
    "charging_socket": "charging_connector",
    "charging_type": "charging_connector",
    "code": "code",
    "article": "code",
    "sku": "code",
    "\u0442\u0438\u043f_sim_\u043a\u0430\u0440\u0442\u044b": "sim_count",
    "\u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e_sim_\u043a\u0430\u0440\u0442": "sim_count",
    "\u0432\u044b\u0445\u043e\u0434_\u043d\u0430_\u043d\u0430\u0443\u0448\u043d\u0438\u043a\u0438": "headphone_connector",
    "\u0440\u0430\u0437\u044a\u0435\u043c_\u0434\u043b\u044f_\u043d\u0430\u0443\u0448\u043d\u0438\u043a\u043e\u0432": "headphone_connector",
    "\u0431\u0435\u0441\u043f\u0440\u043e\u0432\u043e\u0434\u043d\u044b\u0435_\u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u044b": "wireless_interfaces",
    "\u0433\u0435\u043e\u043f\u043e\u0437\u0438\u0446\u0438\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435": "gps",
    "\u0432\u0435\u0440\u0441\u0438\u044f_\u043e\u0441_\u043d\u0430_\u043d\u0430\u0447\u0430\u043b\u043e_\u043f\u0440\u043e\u0434\u0430\u0436": "os",
    "\u043a\u043e\u0434": "code",
}

_HIDDEN_SPEC_KEYS: set[str] = {"code", "\u043a\u043e\u0434"}
_MEMORY_SPEC_KEYS: set[str] = {"ram_gb", "storage_gb"}

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

_LOW_QUALITY_IMAGE_HINTS: tuple[str, ...] = (
    "banner",
    "poster",
    "promo",
    "advert",
    "logo",
    "watermark",
    "placeholder",
    "preview",
    "thumbnail",
    "thumb",
)
_WEAK_QUALITY_IMAGE_HINTS: tuple[str, ...] = (
    "moderation",
)
_POSTER_IMAGE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?<!\w)frame(?!\w)", re.IGNORECASE),
    re.compile(r"(?<!\w)photo\s+\d{4}(?!\d)", re.IGNORECASE),
)
_IMAGE_URL_EXTENSIONS: tuple[str, ...] = (
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".avif",
    ".bmp",
    ".heic",
    ".heif",
)

_TITLE_NOISE_TOKENS: set[str] = {
    "РєСѓРїРёС‚СЊ",
    "С†РµРЅР°",
    "С†РµРЅС‹",
    "СЃРјР°СЂС‚С„РѕРЅ",
    "СЃРјР°СЂС‚С„РѕРЅС‹",
    "С‚РµР»РµС„РѕРЅ",
    "С‚РµР»РµС„РѕРЅС‹",
    "РјР°РіР°Р·РёРЅ",
    "РјР°РіР°Р·РёРЅРµ",
    "РґРѕСЃС‚Р°РІРєР°",
    "СЂР°СЃСЃСЂРѕС‡РєР°",
    "РѕСЂРёРіРёРЅР°Р»",
    "РѕСЂРёРіРёРЅР°Р»СЊРЅС‹Р№",
    "РѕС„РёС†РёР°Р»СЊРЅС‹Р№",
    "official",
    "store",
    "shop",
    "new",
    "РЅРѕРІРёРЅРєР°",
}

_MEMORY_VALUES: tuple[str, ...] = ("64", "128", "256", "512", "1024")
_LIKELY_RAM_VALUES: set[str] = {"2", "3", "4", "6", "8", "10", "12", "16", "18", "24"}
_GB_PATTERN = r"(?:gb|\u0433\u0431)"
_VARIANT_LABELS: dict[str, str] = {
    "pro max": "Pro Max",
    "promax": "Pro Max",
    "pro": "Pro",
    "plus": "Plus",
    "mini": "Mini",
    "max": "Max",
    "air": "Air",
    "se": "SE",
    "e": "E",
    "ultra": "Ultra",
    "lite": "Lite",
    "fe": "FE",
}


def _normalize_title_source_for_display(raw_title: str, brand_name: str | None = None) -> str:
    title = str(raw_title or "").strip().replace("\u00a0", " ")
    if not title:
        return ""

    brand_hint = str(brand_name or "").strip().lower()
    brand_tokens = {brand_hint} if brand_hint else set()
    brand_tokens.update({"apple", "iphone", "samsung", "galaxy"})

    for separator in (" - ", " вЂ” ", " вЂ“ ", ": "):
        if separator not in title:
            continue
        left, right = title.split(separator, 1)
        left_lower = left.lower()
        right_lower = right.lower()
        has_brand_on_right = any(token in right_lower for token in brand_tokens if token)
        has_brand_on_left = any(token in left_lower for token in brand_tokens if token)
        if has_brand_on_right and not has_brand_on_left:
            title = right.strip()
            break

    lowered = title.lower().replace("С‘", "Рµ")
    lowered = lowered.replace("\u0451", "\u0435")
    lowered = re.sub(r"\bРіР±\b", "gb", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\b(\d{1,2})\s*/\s*(\d{2,4})\s*(?:gb|РіР±)\b", r"\1/\2gb", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\b(" + "|".join(_MEMORY_VALUES) + r")\s*(?:gb|РіР±)\b", r"\1gb", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\b(?:\u0433\u0431)\b", "gb", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\b(\d{1,2})\s*/\s*(\d{2,4})\s*gb\b", r"\1/\2gb", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\b(" + "|".join(_MEMORY_VALUES) + r")\s*gb\b", r"\1gb", lowered, flags=re.IGNORECASE)
    lowered = lowered.replace("+", " plus ")
    lowered = re.sub(r"([a-zР°-СЏ])(\d)", r"\1 \2", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"(\d)([a-zР°-СЏ])", r"\1 \2", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"[^a-zР°-СЏ0-9/\s-]", " ", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


def _extract_memory_from_specs(specs: dict | None) -> tuple[str | None, str | None]:
    if not isinstance(specs, dict):
        return None, None

    def parse_value(value: object, *, allow_storage_only: bool) -> str | None:
        if value is None:
            return None
        text_value = str(value).lower().replace("РіР±", "gb")
        text_value = text_value.replace("\u0433\u0431", "gb")
        pair_match = re.search(r"\b(\d{1,2})\s*/\s*(\d{2,4})\b", text_value)
        if pair_match:
            left = pair_match.group(1)
            right = pair_match.group(2)
            if allow_storage_only and right in _MEMORY_VALUES:
                return right
            if not allow_storage_only:
                try:
                    left_int = int(left)
                except ValueError:
                    left_int = 0
                if 2 <= left_int <= 24:
                    return left
        if allow_storage_only:
            storage_match = re.search(r"\b(" + "|".join(_MEMORY_VALUES) + r")\b", text_value)
            if storage_match:
                return storage_match.group(1)
            return None
        ram_match = re.search(r"\b(\d{1,2})\b", text_value)
        if not ram_match:
            return None
        ram_value = int(ram_match.group(1))
        if 2 <= ram_value <= 24:
            return str(ram_value)
        return None

    def classify_key(raw_key: object) -> str:
        key = str(raw_key or "").strip().lower()
        key = key.replace("\u0451", "\u0435")
        key = key.replace("_", " ").replace("-", " ")
        key = re.sub(r"\s+", " ", key).strip()
        compact = key.replace(" ", "")

        if "ram" in key or ("\u043e\u043f\u0435\u0440\u0430\u0442\u0438\u0432" in key and "\u043f\u0430\u043c\u044f\u0442" in key):
            return "ram"
        if ("\u0432\u0441\u0442\u0440\u043e\u0435\u043d" in key and "\u043f\u0430\u043c\u044f\u0442" in key) or ("\u043f\u043e\u0441\u0442\u043e\u044f\u043d" in key and "\u043f\u0430\u043c\u044f\u0442" in key):
            return "storage"
        if key in {"memory", "\u043f\u0430\u043c\u044f\u0442\u044c", "memory config", "\u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u044f \u043f\u0430\u043c\u044f\u0442\u0438"}:
            return "both"
        if "ram" in key or ("РѕРїРµСЂР°С‚РёРІ" in key and "РїР°РјСЏС‚" in key):
            return "ram"
        if (
            "storage" in key
            or "built in memory" in key
            or "builtinmemory" in compact
            or ("РІСЃС‚СЂРѕРµРЅ" in key and "РїР°РјСЏС‚" in key)
            or ("РїРѕСЃС‚РѕСЏРЅ" in key and "РїР°РјСЏС‚" in key)
        ):
            return "storage"
        if key in {"memory", "РїР°РјСЏС‚СЊ", "memory config", "РєРѕРЅС„РёРіСѓСЂР°С†РёСЏ РїР°РјСЏС‚Рё"}:
            return "both"
        return "unknown"

    storage = None
    ram = None
    for key, value in specs.items():
        kind = classify_key(key)
        if kind in {"storage", "both"} and not storage:
            storage = parse_value(value, allow_storage_only=True)
        if kind in {"ram", "both"} and not ram:
            ram = parse_value(value, allow_storage_only=False)
        if ram and storage:
            break

    return ram, storage


def _extract_memory_from_text(text: str) -> tuple[str | None, str | None]:
    compact = str(text or "")
    compact = re.sub(r"\b(?:\u0433\u0431|РіР±)\b", "gb", compact, flags=re.IGNORECASE)
    pair_match = re.search(
        r"\b(\d{1,2})\s*/\s*(" + "|".join(_MEMORY_VALUES) + r")\s*gb\b",
        compact,
        flags=re.IGNORECASE,
    )
    if pair_match:
        ram = pair_match.group(1)
        storage = pair_match.group(2)
        try:
            ram_int = int(ram)
        except ValueError:
            ram_int = 0
        if 2 <= ram_int <= 24:
            return ram, storage

    spaced_pair_match = re.search(
        r"\b(\d{1,2})\s+(" + "|".join(_MEMORY_VALUES) + r")\s*gb\b",
        compact,
        flags=re.IGNORECASE,
    )
    if spaced_pair_match:
        ram = spaced_pair_match.group(1)
        storage = spaced_pair_match.group(2)
        if ram in _LIKELY_RAM_VALUES:
            return ram, storage

    storage_match = re.search(
        r"\b(" + "|".join(_MEMORY_VALUES) + r")\s*gb\b",
        compact,
        flags=re.IGNORECASE,
    )
    storage = storage_match.group(1) if storage_match else None
    return None, storage


def _extract_esim(text: str, specs: dict | None) -> bool:
    normalized = str(text or "").lower()
    if "esim" in normalized or "e sim" in normalized:
        return True
    if not isinstance(specs, dict):
        return False
    for key, value in specs.items():
        key_norm = str(key).strip().lower()
        value_norm = str(value or "").strip().lower()
        if "esim" in key_norm and value_norm not in {"", "false", "0", "no"}:
            return True
        if key_norm in {"sim", "sim_type", "sim_type_card", "type_sim", "С‚РёРї sim-РєР°СЂС‚С‹"} and "esim" in value_norm:
            return True
    return False


def _detect_brand(raw_title: str, brand_name: str | None) -> str:
    hint = str(brand_name or "").strip().lower()
    if "apple" in hint:
        return "apple"
    if "samsung" in hint:
        return "samsung"
    title = str(raw_title or "").lower()
    if "iphone" in title or "apple" in title:
        return "apple"
    if "samsung" in title or "galaxy" in title:
        return "samsung"
    return hint or "unknown"


def _normalize_brand_label(brand_name: str | None, normalized_title: str) -> str | None:
    canonical: dict[str, str] = {
        "apple": "Apple",
        "samsung": "Samsung",
        "xiaomi": "Xiaomi",
        "huawei": "Huawei",
        "honor": "Honor",
        "google": "Google",
        "oneplus": "OnePlus",
        "oppo": "OPPO",
        "vivo": "Vivo",
        "realme": "realme",
        "motorola": "Motorola",
        "nokia": "Nokia",
        "sony": "Sony",
        "infinix": "Infinix",
        "tecno": "TECNO",
        "nothing": "Nothing",
        "poco": "POCO",
        "asus": "ASUS",
    }
    hint = str(brand_name or "").strip()
    if hint:
        return canonical.get(hint.lower(), hint.title())
    first_match = re.match(r"^\s*([a-z0-9]+)", normalized_title, flags=re.IGNORECASE)
    if not first_match:
        return None
    first_token = str(first_match.group(1) or "").strip().lower()
    if not first_token or first_token in _TITLE_NOISE_TOKENS:
        return None
    return canonical.get(first_token, first_token.title())


def _extract_apple_model(text: str) -> str | None:
    match = re.search(
        r"\biphone\s*(\d{1,2})?\s*(pro\s*max|promax|pro|max|plus|mini|air|se|e)?\b",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return "iPhone" if "iphone" in text else None

    number = match.group(1)
    variant_raw = (match.group(2) or "").strip().lower()
    variant = _VARIANT_LABELS.get(variant_raw, _VARIANT_LABELS.get(variant_raw.replace(" ", ""), ""))

    parts = ["iPhone"]
    if number:
        parts.append(number)
    if variant:
        parts.append(variant)
    return " ".join(parts).strip()


def _extract_samsung_model(text: str) -> str | None:
    z_match = re.search(
        r"\b(?:galaxy\s*)?z\s*(fold|flip)\s*(\d{1,2})(?:\s*(fe))?\b",
        text,
        flags=re.IGNORECASE,
    )
    if z_match:
        family = z_match.group(1).capitalize()
        generation = z_match.group(2)
        suffix = _VARIANT_LABELS.get((z_match.group(3) or "").strip().lower(), "")
        return f"Galaxy Z {family} {generation}{f' {suffix}' if suffix else ''}".strip()

    note_match = re.search(
        r"\b(?:galaxy\s*)?note\s*(\d{1,2})(?:\s*(ultra|plus|fe|lite))?\b",
        text,
        flags=re.IGNORECASE,
    )
    if note_match:
        generation = note_match.group(1)
        suffix = _VARIANT_LABELS.get((note_match.group(2) or "").strip().lower(), "")
        return f"Galaxy Note {generation}{f' {suffix}' if suffix else ''}".strip()

    line_match = re.search(
        r"\b(?:galaxy\s*)?(s|a|m|f)\s*(\d{1,3})(?:\s*(ultra|plus|fe|lite))?\b",
        text,
        flags=re.IGNORECASE,
    )
    if line_match:
        family = line_match.group(1).upper()
        generation = line_match.group(2)
        suffix = _VARIANT_LABELS.get((line_match.group(3) or "").strip().lower(), "")
        return f"Galaxy {family}{generation}{f' {suffix}' if suffix else ''}".strip()

    return "Galaxy" if "galaxy" in text else None


def _title_case_fallback_tokens(tokens: list[str]) -> str:
    formatted: list[str] = []
    for token in tokens:
        if token.lower() == "esim":
            formatted.append("eSIM")
        elif re.fullmatch(r"\d+g", token, flags=re.IGNORECASE):
            formatted.append(token[:-1] + "G")
        elif re.fullmatch(r"\d+gb", token, flags=re.IGNORECASE):
            formatted.append(token[:-2] + "GB")
        elif re.fullmatch(r"\d+/\d+gb", token, flags=re.IGNORECASE):
            left, right = token[:-2].split("/", 1)
            formatted.append(f"{left}/{right}GB")
        else:
            compact_variant = token.lower().replace(" ", "")
            if compact_variant in _VARIANT_LABELS:
                formatted.append(_VARIANT_LABELS[compact_variant])
            else:
                formatted.append(token.capitalize())
    return " ".join(formatted).strip()


_GENERIC_MODEL_DROP_TOKENS: set[str] = {
    "buy",
    "kupit",
    "купить",
    "price",
    "цена",
    "цены",
    "phone",
    "smartphone",
    "mobile",
    "new",
    "global",
    "version",
    "оригинал",
    "official",
    "store",
    "shop",
    "dual",
    "sim",
    "nano",
}


def _extract_generic_model(text: str, *, brand_label: str | None = None) -> str | None:
    cleaned = str(text or "").lower()
    if brand_label:
        brand_tokens = [token for token in re.split(r"\s+", brand_label.lower().strip()) if token]
        for token in brand_tokens:
            cleaned = re.sub(rf"^\s*{re.escape(token)}\b\s*", "", cleaned, flags=re.IGNORECASE)

    cleaned = re.sub(r"\b([a-z])\s+(\d{1,3})\b", r"\1\2", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(\d{1,2})\s+(" + "|".join(_MEMORY_VALUES) + r")\s*gb\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b\d{1,2}\s*/\s*\d{2,4}\s*gb\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b\d{2,4}\s*gb\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(?:e\s*sim|esim)\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(?:dual\s*sim|nano\s*sim|sim)\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[^a-z0-9/\s-]", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if not cleaned:
        return None

    tokens = [
        token
        for token in cleaned.split()
        if token
        and token not in _TITLE_NOISE_TOKENS
        and token not in _GENERIC_MODEL_DROP_TOKENS
    ]
    if not tokens:
        return None
    return _title_case_fallback_tokens(tokens[:8])


def format_product_title(raw_title: str, *, brand_name: str | None = None, specs: dict | None = None) -> str:
    normalized = _normalize_title_source_for_display(raw_title, brand_name=brand_name)
    if not normalized:
        return str(raw_title or "").strip()

    brand = _detect_brand(normalized, brand_name)
    if brand == "apple":
        brand_label = "Apple"
        model_label = _extract_apple_model(normalized)
    elif brand == "samsung":
        brand_label = "Samsung"
        model_label = _extract_samsung_model(normalized)
    else:
        brand_label = _normalize_brand_label(brand_name, normalized)
        model_label = _extract_generic_model(normalized, brand_label=brand_label)

    if brand in {"apple", "samsung"} and not model_label:
        model_label = _extract_generic_model(normalized, brand_label=brand_label)

    ram_specs, storage_specs = _extract_memory_from_specs(specs)
    ram_title, storage_title = _extract_memory_from_text(normalized)
    ram = ram_specs or ram_title
    storage = storage_title or storage_specs
    esim = _extract_esim(normalized, specs)

    memory_label = None
    if ram and storage:
        memory_label = f"{ram}/{storage}GB"
    elif storage:
        memory_label = f"{storage}GB"
    elif ram:
        memory_label = f"{ram}GB RAM"

    parts: list[str] = []
    if brand_label:
        parts.append(brand_label)
    if model_label:
        parts.append(model_label)
    if memory_label:
        parts.append(memory_label)
    if esim:
        parts.append("eSIM")

    if parts:
        # Avoid duplicate "Apple iPhone" or "Samsung Galaxy" when model already starts with the brand.
        joined = " ".join(parts)
        joined = re.sub(r"\b(Apple)\s+Apple\b", r"\1", joined, flags=re.IGNORECASE)
        joined = re.sub(r"\b(Samsung)\s+Samsung\b", r"\1", joined, flags=re.IGNORECASE)
        joined = re.sub(r"\s+", " ", joined).strip()
        return joined

    fallback_tokens = [
        token
        for token in normalized.split()
        if token not in _TITLE_NOISE_TOKENS and token not in {"apple", "iphone", "samsung", "galaxy"}
    ]
    if not fallback_tokens:
        return str(raw_title or "").strip()
    return _title_case_fallback_tokens(fallback_tokens[:8])


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
    canonical = _SPEC_KEY_ALIASES.get(snake, snake)
    return _SPEC_RUNTIME_KEY_ALIASES.get(canonical, canonical)


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


def _parse_first_float(value: str) -> float | None:
    match = re.search(r"-?\d+(?:[.,]\d+)?", str(value))
    if not match:
        return None
    token = match.group(0).replace(",", ".")
    try:
        return float(token)
    except ValueError:
        return None


def _token_count(value: str) -> int:
    return len([token for token in re.split(r"[,/|+]", value) if token.strip()])


def _normalize_usb_type_c(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    if re.search(r"(?:usb\s*(?:type)?\s*-?\s*c|type\s*-?\s*c)", cleaned, flags=re.IGNORECASE):
        return "USB Type-C"
    return cleaned


def _normalize_device_type(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    lowered = cleaned.lower()
    if lowered in {"smartphone", "\u0441\u043c\u0430\u0440\u0442\u0444\u043e\u043d"}:
        return "Smartphone"
    return cleaned


def _normalize_sim_value(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    lowered = cleaned.lower()
    has_nano_sim = bool(re.search(r"nano\s*-?\s*sim|nanosim", lowered))
    has_esim = bool(re.search(r"\be\s*-?\s*sim\b|\besim\b", lowered))
    has_dual_sim = bool(re.search(r"dual\s*sim|2\s*sim|2\s*\u0441\u0438\u043c|\u0434\u0432\u0435\s*sim", lowered))
    if has_nano_sim and has_esim:
        return "Nano-SIM + eSIM"
    if has_dual_sim:
        return "Dual SIM"
    if has_nano_sim:
        return "Nano-SIM"
    if has_esim:
        return "eSIM"
    return cleaned


def _normalize_network_standard_value(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    lowered = cleaned.lower()
    ordered: list[tuple[str, str]] = [
        (r"\b2g\b", "2G"),
        (r"\b3g\b", "3G"),
        (r"\b4g\b", "4G"),
        (r"\blte\b", "LTE"),
        (r"\b5g\b", "5G"),
        (r"\b6g\b", "6G"),
    ]
    values = [label for pattern, label in ordered if re.search(pattern, lowered, flags=re.IGNORECASE)]
    if not values:
        return cleaned
    return ", ".join(values)


def _normalize_wifi_standard_value(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    lowered = cleaned.lower()
    wifi_generation_match = re.search(r"wi[\s-]?fi\s*([4-7])", lowered, flags=re.IGNORECASE)
    wifi_generation = f"Wi-Fi {wifi_generation_match.group(1)}" if wifi_generation_match else None

    order = ["a", "b", "g", "n", "ac", "ax", "be"]
    allowed = set(order)

    tokens: set[str] = set()
    for match in re.finditer(r"802\.11\s*([a-z0-9/\s,.-]+)", lowered, flags=re.IGNORECASE):
        chunk = str(match.group(1) or "").lower()
        for token in re.split(r"[/,\s.-]+", chunk):
            current = token.strip().lower()
            if current in allowed:
                tokens.add(current)
    for match in re.finditer(r"802\.11([a-z]{1,2})", lowered, flags=re.IGNORECASE):
        token = str(match.group(1) or "").lower()
        if token in allowed:
            tokens.add(token)
    ordered_tokens = [token for token in order if token in tokens]

    if wifi_generation and ordered_tokens:
        return f"{wifi_generation} 802.11 {'/'.join(ordered_tokens)}"
    if wifi_generation:
        return wifi_generation
    if ordered_tokens:
        return f"802.11 {'/'.join(ordered_tokens)}"
    return cleaned


def _normalize_power_value(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    match = re.search(r"(\d{1,4}(?:[.,]\d+)?)\s*(?:w|\u0432\u0442)", cleaned, flags=re.IGNORECASE)
    if not match:
        return cleaned
    token = str(match.group(1) or "").replace(",", ".")
    return f"{token} \u0412\u0442" if token else cleaned


def _normalize_spec_value_for_key(key: str, value: str) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return None

    if key in {"charging_connector", "headphone_connector"}:
        cleaned = _normalize_usb_type_c(cleaned)
    elif key == "device_type":
        cleaned = _normalize_device_type(cleaned)
    elif key in {"sim_count", "sim_type"}:
        cleaned = _normalize_sim_value(cleaned)
    elif key in {"network_standard", "network"}:
        cleaned = _normalize_network_standard_value(cleaned)
    elif key == "wifi_standard":
        cleaned = _normalize_wifi_standard_value(cleaned)
    elif key == "charging_power_w":
        cleaned = _normalize_power_value(cleaned)

    if key in _MEMORY_SPEC_KEYS:
        numeric = _parse_first_float(cleaned)
        if numeric is not None and numeric <= 0:
            return None
    return cleaned


def _normalize_spec_entries(key: str, value: str) -> list[tuple[str, str]]:
    if key != "charging_connector":
        normalized_value = _normalize_spec_value_for_key(key, value)
        return [(key, normalized_value)] if normalized_value else []

    cleaned = re.sub(r"\s+", " ", value).strip()
    lowered = cleaned.lower()
    entries: list[tuple[str, str]] = []

    if re.search(r"(\d{1,4}(?:[.,]\d+)?)\s*(?:w|\u0432\u0442)", cleaned, flags=re.IGNORECASE):
        normalized_power = _normalize_spec_value_for_key("charging_power_w", cleaned)
        if normalized_power:
            entries.append(("charging_power_w", normalized_power))

    if re.search(r"\u0431\u0435\u0441\u043f\u0440\u043e\u0432\u043e\u0434|wireless|qi|magsafe", lowered, flags=re.IGNORECASE):
        entries.append(("charging_features", "\u0411\u0435\u0441\u043f\u0440\u043e\u0432\u043e\u0434\u043d\u0430\u044f \u0437\u0430\u0440\u044f\u0434\u043a\u0430"))

    normalized_connector = _normalize_spec_value_for_key("charging_connector", cleaned)
    if normalized_connector and normalized_connector == "USB Type-C":
        entries.append(("charging_connector", normalized_connector))
    elif not entries and normalized_connector:
        entries.append(("charging_connector", normalized_connector))

    unique: dict[str, str] = {}
    for entry_key, entry_value in entries:
        composite = f"{entry_key}:{entry_value}"
        unique[composite] = entry_value
    return [(item_key.split(":", 1)[0], item_value) for item_key, item_value in unique.items()]


def _pick_preferred_spec_value(key: str, current: str | None, candidate: str) -> str:
    if not current:
        return candidate
    if _is_placeholder_spec_value(current) and not _is_placeholder_spec_value(candidate):
        return candidate
    if _is_placeholder_spec_value(candidate):
        return current

    if key in _MEMORY_SPEC_KEYS:
        current_numeric = _parse_first_float(current)
        candidate_numeric = _parse_first_float(candidate)
        if current_numeric is not None and candidate_numeric is not None:
            if current_numeric <= 0 < candidate_numeric:
                return candidate
            if candidate_numeric <= 0 < current_numeric:
                return current

    if key in {"network_standard", "wifi_standard", "sim_count"}:
        current_tokens = _token_count(current)
        candidate_tokens = _token_count(candidate)
        if candidate_tokens > current_tokens:
            return candidate
        if current_tokens > candidate_tokens:
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
            if not key or key in _HIDDEN_SPEC_KEYS:
                continue
            base_value = _normalize_spec_value(raw_value)
            if not base_value:
                continue
            for entry_key, entry_value in _normalize_spec_entries(key, base_value):
                normalized_key = _normalize_spec_key(entry_key)
                if not normalized_key or normalized_key in _HIDDEN_SPEC_KEYS:
                    continue
                normalized_value = _normalize_spec_value_for_key(normalized_key, entry_value)
                if not normalized_value:
                    continue
                merged[normalized_key] = _pick_preferred_spec_value(
                    normalized_key,
                    merged.get(normalized_key),
                    normalized_value,
                )

    if not merged.get("charging_connector") and merged.get("headphone_connector") == "USB Type-C":
        merged["charging_connector"] = "USB Type-C"
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


def _contains_image_hint(normalized_text: str, token: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(token)}(?!\w)", normalized_text, flags=re.IGNORECASE) is not None


def _has_known_image_extension(url: str) -> bool:
    normalized = unquote(str(url or "")).strip().lower()
    if not normalized:
        return False
    base = normalized.split("?", 1)[0].split("#", 1)[0]
    return any(base.endswith(extension) for extension in _IMAGE_URL_EXTENSIONS)


def _looks_like_poster_image(url: str) -> bool:
    normalized = _normalize_color_text(unquote(str(url or "")))
    if not normalized:
        return True
    return any(pattern.search(normalized) is not None for pattern in _POSTER_IMAGE_PATTERNS)


def _image_quality_penalty(url: str) -> int:
    normalized = _normalize_color_text(unquote(str(url or "")))
    if not normalized:
        return 200

    penalty = 0
    if any(_contains_image_hint(normalized, token) for token in _LOW_QUALITY_IMAGE_HINTS):
        penalty += 55
    if any(_contains_image_hint(normalized, token) for token in _WEAK_QUALITY_IMAGE_HINTS):
        penalty += 15
    if _looks_like_poster_image(url):
        penalty += 50
    if not _has_known_image_extension(url):
        penalty += 25
    return penalty


def _looks_like_low_quality_image(url: str) -> bool:
    return _image_quality_penalty(url) >= 50


def _extract_image_color_hint(url: str, *, source_title: str | None = None, source_color: str | None = None) -> str | None:
    for candidate in (source_color, source_title, unquote(url)):
        color_name = _extract_official_color_name(str(candidate or ""))
        if color_name:
            return color_name
    return None


def _resolve_gallery_target_color(
    preferred_color: str | None,
    *,
    source_rows: list[tuple[str | None, str | None]],
) -> str | None:
    preferred = _extract_official_color_name(preferred_color) or _format_color_label(preferred_color)

    counts: dict[str, int] = {}
    labels: dict[str, str] = {}
    total_votes = 0
    for source_color, source_title in source_rows:
        vote = _extract_official_color_name(source_color) or _extract_official_color_name(source_title)
        if not vote:
            continue
        key = vote.lower()
        counts[key] = counts.get(key, 0) + 1
        labels.setdefault(key, vote)
        total_votes += 1

    if total_votes == 0:
        return preferred

    top_key, top_count = max(counts.items(), key=lambda item: item[1])
    top_share = top_count / total_votes
    top_label = labels[top_key]

    if preferred:
        preferred_key = preferred.lower()
        preferred_share = counts.get(preferred_key, 0) / total_votes
        if preferred_share >= 0.25:
            return preferred
        # Override preferred color only when the alternative has a clear, stable majority.
        # Example: 2/4 votes is too weak (likely mixed variants), 3/4 is strong enough.
        if top_count >= 3 and top_share >= 0.60:
            return top_label
        return None

    if top_count >= 2 and top_share >= 0.55:
        return top_label
    return None


def _build_gallery_images(
    candidates: list[dict[str, object]],
    *,
    target_color: str | None,
    limit: int = 24,
) -> list[str]:
    prepared: list[dict[str, object]] = []
    target_key = str(target_color or "").strip().lower() or None

    for candidate in candidates:
        url = str(candidate.get("url") or "").strip()
        if not url:
            continue
        raw_source_priority = candidate.get("source_priority")
        source_priority = int(raw_source_priority) if raw_source_priority is not None else 99
        raw_order = candidate.get("order")
        order = int(raw_order) if raw_order is not None else 0
        source_title = str(candidate.get("source_title") or "").strip() or None
        source_color = str(candidate.get("source_color") or "").strip() or None

        color_hint = _extract_image_color_hint(url, source_title=source_title, source_color=source_color)
        color_key = str(color_hint or "").strip().lower() or None
        quality_penalty = _image_quality_penalty(url)
        low_quality = quality_penalty >= 50

        score = 100 - (source_priority * 10) - quality_penalty
        if quality_penalty == 0:
            score += 10
        if target_key and color_key:
            if color_key == target_key:
                score += 35
            else:
                score -= 30

        prepared.append(
            {
                "url": url,
                "order": order,
                "score": score,
                "source_priority": source_priority,
                "color_key": color_key,
                "has_extension": _has_known_image_extension(url),
                "low_quality": low_quality,
            }
        )

    if any(bool(item.get("has_extension")) for item in prepared):
        prepared = [item for item in prepared if bool(item.get("has_extension"))]

    if any(not bool(item.get("low_quality")) for item in prepared):
        prepared = [item for item in prepared if not bool(item.get("low_quality"))]

    if target_key and any(str(item.get("color_key") or "") == target_key for item in prepared):
        prepared = [
            item
            for item in prepared
            if item.get("color_key") is None or str(item.get("color_key")) == target_key
        ]

    prepared.sort(
        key=lambda item: (
            -int(item["score"]),
            int(bool(item.get("low_quality"))),
            int(item["source_priority"]),
            int(item["order"]),
        )
    )

    return [str(item["url"]) for item in prepared[: max(1, min(limit, 50))]]


def _needs_catalog_image_fallback(url: str | None) -> bool:
    value = str(url or "").strip()
    if not value:
        return True
    if not _has_known_image_extension(value):
        return True
    return _looks_like_low_quality_image(value)


def _select_catalog_card_image(
    primary_image: str | None,
    *,
    fallback_candidates: list[dict[str, object]] | None = None,
    target_color: str | None = None,
) -> str | None:
    prepared: list[dict[str, object]] = []
    seen_urls: set[str] = set()
    order = 0

    def push(
        value: object,
        *,
        source_priority: int,
        source_title: str | None = None,
        source_color: str | None = None,
    ) -> None:
        nonlocal order
        url = str(value or "").strip()
        if not url or url in seen_urls:
            return
        seen_urls.add(url)
        prepared.append(
            {
                "url": url,
                "source_priority": source_priority,
                "source_title": source_title,
                "source_color": source_color,
                "order": order,
            }
        )
        order += 1

    if fallback_candidates:
        for candidate in fallback_candidates:
            push(
                candidate.get("url"),
                source_priority=int(candidate.get("source_priority") or 1),
                source_title=str(candidate.get("source_title") or "").strip() or None,
                source_color=str(candidate.get("source_color") or "").strip() or None,
            )

    push(primary_image, source_priority=2)
    if not prepared:
        return None

    resolved = _build_gallery_images(prepared, target_color=target_color, limit=1)
    if resolved:
        return resolved[0]
    return str(primary_image or "").strip() or None


def _clamp_01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _trust_band(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.55:
        return "medium"
    return "low"


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

        seed_row = (
            await self.session.execute(
                select(
                    CatalogCanonicalProduct.normalized_title,
                    CatalogCanonicalProduct.specs,
                    CatalogCanonicalProduct.category_id,
                    CatalogCanonicalProduct.brand_id,
                ).where(CatalogCanonicalProduct.id == product_id)
            )
        ).one_or_none()
        if seed_row is None:
            return None

        seed_specs = seed_row.specs if isinstance(seed_row.specs, dict) else {}
        seed_model_signature = _extract_model_signature(str(seed_row.normalized_title or ""))
        seed_ram_specs, seed_storage_specs = _extract_memory_from_specs(seed_specs)
        seed_ram_title, seed_storage_title = _extract_memory_from_text(str(seed_row.normalized_title or ""))
        seed_ram = seed_ram_specs or seed_ram_title
        seed_storage = seed_storage_title or seed_storage_specs
        seed_esim = _extract_esim(str(seed_row.normalized_title or ""), seed_specs)

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
                    cp.normalized_title,
                    cp.specs,
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
                group by cp.id, cp.normalized_title, cp.specs, seed.normalized_title
            )
            select id, normalized_title, specs, sim, offers_count
            from ranked
            where sim >= :min_similarity
            order by sim desc, offers_count desc, id asc
            limit 20
            """
        )
        candidates = (
            await self.session.execute(
                best_candidate_stmt,
                {"product_id": product_id, "min_similarity": 0.30},
            )
        ).mappings().all()
        if not candidates:
            return None

        for candidate in candidates:
            candidate_title = str(candidate.get("normalized_title") or "")
            candidate_specs = candidate.get("specs") if isinstance(candidate.get("specs"), dict) else {}
            candidate_model_signature = _extract_model_signature(candidate_title)
            candidate_ram_specs, candidate_storage_specs = _extract_memory_from_specs(candidate_specs)
            candidate_ram_title, candidate_storage_title = _extract_memory_from_text(candidate_title)
            candidate_ram = candidate_ram_specs or candidate_ram_title
            candidate_storage = candidate_storage_title or candidate_storage_specs
            candidate_esim = _extract_esim(candidate_title, candidate_specs)

            if seed_model_signature:
                if not candidate_model_signature or candidate_model_signature != seed_model_signature:
                    continue
            if seed_storage:
                if not candidate_storage or candidate_storage != seed_storage:
                    continue
            if seed_ram:
                if not candidate_ram or candidate_ram != seed_ram:
                    continue
            if seed_esim and not candidate_esim:
                continue

            candidate_id = candidate.get("id")
            if candidate_id is not None:
                return int(candidate_id)

        return None

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
                    CatalogCanonicalProduct.ai_short_description,
                    CatalogCanonicalProduct.ai_whats_new,
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
                   or id in (
                        select o.store_product_id
                        from catalog_offers o
                        where o.canonical_product_id = :product_id
                          and o.is_valid = true
                   )
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

        preferred_color = _extract_official_color_name(str(specs.get("color") or "")) or _format_color_label(str(specs.get("color") or ""))

        gallery_stmt = text(
            """
            select
                image_url,
                case
                    when jsonb_typeof(metadata->'images') = 'array' then metadata->'images'
                    else '[]'::jsonb
                end as images,
                coalesce(title_clean, title_raw) as source_title,
                coalesce(
                    metadata->>'color',
                    case
                        when jsonb_typeof(metadata->'specifications') = 'object' then metadata->'specifications'->>'color'
                        else null
                    end,
                    case
                        when jsonb_typeof(metadata->'specs') = 'object' then metadata->'specs'->>'color'
                        else null
                    end
                ) as source_color
            from catalog_store_products
            where canonical_product_id = :product_id
               or id in (
                    select o.store_product_id
                    from catalog_offers o
                    where o.canonical_product_id = :product_id
                      and o.is_valid = true
               )
            order by last_seen_at desc, id desc
            limit 250
            """
        )
        gallery_rows = (await self.session.execute(gallery_stmt, {"product_id": product_id})).all()
        target_color = _resolve_gallery_target_color(
            preferred_color,
            source_rows=[
                (
                    str(gallery_row.source_color or "").strip() or None,
                    str(gallery_row.source_title or "").strip() or None,
                )
                for gallery_row in gallery_rows
            ],
        )
        gallery_candidates: list[dict[str, object]] = []
        seen_images: set[str] = set()
        order_counter = 0

        def push_gallery(
            url: object,
            *,
            source_priority: int,
            source_title: str | None = None,
            source_color: str | None = None,
        ) -> None:
            nonlocal order_counter
            value = str(url or "").strip()
            if not value:
                return
            if value in seen_images:
                return
            seen_images.add(value)
            gallery_candidates.append(
                {
                    "url": value,
                    "source_priority": source_priority,
                    "source_title": source_title,
                    "source_color": source_color,
                    "order": order_counter,
                }
            )
            order_counter += 1

        for gallery_row in gallery_rows:
            source_title = str(gallery_row.source_title or "").strip() or None
            source_color = str(gallery_row.source_color or "").strip() or None
            raw_images = gallery_row.images if hasattr(gallery_row, "images") else None
            if isinstance(raw_images, list):
                for image in raw_images:
                    push_gallery(
                        image,
                        source_priority=0,
                        source_title=source_title,
                        source_color=source_color,
                    )
            push_gallery(
                gallery_row.image_url,
                source_priority=1,
                source_title=source_title,
                source_color=source_color,
            )
        push_gallery(
            row.main_image,
            source_priority=2,
            source_title=str(row.normalized_title or "").strip() or None,
            source_color=str(specs.get("color") or "").strip() or None,
        )
        gallery_images = _build_gallery_images(
            gallery_candidates,
            target_color=target_color,
            limit=24,
        )
        if gallery_images and all(_looks_like_low_quality_image(url) for url in gallery_images[: min(8, len(gallery_images))]):
            seed_model_signature = _extract_model_signature(str(row.normalized_title or ""))
            similar_gallery_stmt = text(
                """
                with seed as (
                    select normalized_title, category_id, brand_id
                    from catalog_canonical_products
                    where id = :product_id
                ),
                candidates as (
                    select
                        cp.id,
                        cp.normalized_title,
                        similarity(lower(cp.normalized_title), lower(seed.normalized_title)) as sim
                    from seed
                    join catalog_canonical_products cp
                      on cp.id <> :product_id
                     and cp.is_active = true
                     and cp.category_id = seed.category_id
                     and (seed.brand_id is null or cp.brand_id is not distinct from seed.brand_id)
                    where similarity(lower(cp.normalized_title), lower(seed.normalized_title)) >= :min_similarity
                    order by sim desc, cp.id asc
                    limit :candidate_limit
                )
                select
                    case
                        when jsonb_typeof(sp.metadata->'images') = 'array' then sp.metadata->'images'
                        else '[]'::jsonb
                    end as images,
                    sp.image_url,
                    coalesce(sp.title_clean, sp.title_raw, c.normalized_title) as source_title,
                    c.normalized_title as candidate_title,
                    coalesce(
                        sp.metadata->>'color',
                        case
                            when jsonb_typeof(sp.metadata->'specifications') = 'object' then sp.metadata->'specifications'->>'color'
                            else null
                        end,
                        case
                            when jsonb_typeof(sp.metadata->'specs') = 'object' then sp.metadata->'specs'->>'color'
                            else null
                        end
                    ) as source_color,
                    c.sim
                from candidates c
                join catalog_store_products sp
                  on sp.canonical_product_id = c.id
                order by c.sim desc, sp.last_seen_at desc, sp.id desc
                limit :image_limit
                """
            )
            similar_rows = (
                await self.session.execute(
                    similar_gallery_stmt,
                    {
                        "product_id": int(row.id),
                        "min_similarity": 0.40,
                        "candidate_limit": 20,
                        "image_limit": 250,
                    },
                )
            ).all()
            similar_candidates: list[dict[str, object]] = []
            similar_seen: set[str] = set()
            similar_order = 0
            for similar_row in similar_rows:
                candidate_title = str(similar_row.candidate_title or "")
                if seed_model_signature:
                    candidate_signature = _extract_model_signature(candidate_title)
                    if not candidate_signature or candidate_signature != seed_model_signature:
                        continue

                source_title = str(similar_row.source_title or "").strip() or None
                source_color = str(similar_row.source_color or "").strip() or None
                raw_images = similar_row.images if hasattr(similar_row, "images") else None
                if isinstance(raw_images, list):
                    for image in raw_images:
                        value = str(image or "").strip()
                        if not value or value in similar_seen:
                            continue
                        similar_seen.add(value)
                        similar_candidates.append(
                            {
                                "url": value,
                                "source_priority": 0,
                                "source_title": source_title,
                                "source_color": source_color,
                                "order": similar_order,
                            }
                        )
                        similar_order += 1

                row_image = str(similar_row.image_url or "").strip()
                if row_image and row_image not in similar_seen:
                    similar_seen.add(row_image)
                    similar_candidates.append(
                        {
                            "url": row_image,
                            "source_priority": 1,
                            "source_title": source_title,
                            "source_color": source_color,
                            "order": similar_order,
                        }
                    )
                    similar_order += 1

            alternative_gallery = _build_gallery_images(
                similar_candidates,
                target_color=target_color,
                limit=24,
            )
            if alternative_gallery:
                gallery_images = alternative_gallery

        resolved_main_image = gallery_images[0] if gallery_images else row.main_image
        whats_new = row.ai_whats_new if isinstance(row.ai_whats_new, list) else []
        whats_new = [str(item).strip() for item in whats_new if str(item).strip()]

        return {
            "id": row.uuid,
            "legacy_id": row.id,
            "title": format_product_title(
                row.normalized_title,
                brand_name=row.brand_name,
                specs=specs,
            ),
            "category": row.category_name,
            "brand": row.brand_name,
            "main_image": resolved_main_image,
            "gallery_images": gallery_images,
            "short_description": row.ai_short_description,
            "whats_new": whats_new,
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
                CatalogOffer.trust_score,
                CatalogOffer.trust_freshness,
                CatalogOffer.trust_seller_rating,
                CatalogOffer.trust_price_anomaly,
                CatalogOffer.trust_stock_consistency,
                CatalogStore.trust_score.label("store_trust_score"),
                CatalogSeller.rating.label("seller_rating"),
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
            "best_value": CatalogOffer.trust_score.desc().nulls_last(),
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
                    "_best_value_score": 0.0,
                }
            bucket = by_store[row.store_id]
            link_key = str(row.link or row.offer_uuid)
            if link_key in bucket["_seen_links"]:
                continue
            if len(bucket["offers"]) >= max_offers_per_store:
                continue

            bucket["_seen_links"].add(link_key)
            freshness_score: float | None = float(row.trust_freshness) if row.trust_freshness is not None else None
            seller_score: float | None = float(row.trust_seller_rating) if row.trust_seller_rating is not None else None
            price_score: float | None = float(row.trust_price_anomaly) if row.trust_price_anomaly is not None else None
            stock_score: float | None = float(row.trust_stock_consistency) if row.trust_stock_consistency is not None else None
            trust_score: float | None = float(row.trust_score) if row.trust_score is not None else None

            if freshness_score is None and row.scraped_at is not None:
                age_hours = max(0.0, (datetime.now(row.scraped_at.tzinfo) - row.scraped_at).total_seconds() / 3600.0)
                freshness_score = _clamp_01(1.0 - (age_hours / 72.0))
            if seller_score is None:
                if row.seller_rating is not None:
                    seller_score = _clamp_01(float(row.seller_rating) / 5.0)
                elif row.store_trust_score is not None:
                    seller_score = _clamp_01(float(row.store_trust_score))
                else:
                    seller_score = 0.55
            if price_score is None:
                price_score = 0.65
            if stock_score is None:
                stock_score = 0.9 if row.in_stock else 0.35
            if trust_score is None:
                trust_score = _clamp_01(
                    0.35 * float(freshness_score)
                    + 0.25 * float(seller_score)
                    + 0.25 * float(price_score)
                    + 0.15 * float(stock_score)
                )
            best_value_score = _clamp_01(0.8 * trust_score + 0.2 * (1.0 if row.in_stock else 0.0))

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
                "trust_score": trust_score,
                "trust_freshness": freshness_score,
                "trust_seller_rating": seller_score,
                "trust_price_anomaly": price_score,
                "trust_stock_consistency": stock_score,
                "trust_band": _trust_band(trust_score),
                "best_value_score": best_value_score,
                "link": row.link,
            }
            bucket["offers"].append(offer_payload)
            bucket["offers_count"] += 1
            if bucket["minimal_price"] is None or offer_payload["price_amount"] < bucket["minimal_price"]:
                bucket["minimal_price"] = offer_payload["price_amount"]
            if offer_payload["best_value_score"] > bucket["_best_value_score"]:
                bucket["_best_value_score"] = offer_payload["best_value_score"]

        result = []
        for item in by_store.values():
            item.pop("_seen_links", None)
            for offer in item["offers"]:
                if sort == "best_value":
                    item["offers"].sort(
                        key=lambda value: (
                            -(float(value.get("best_value_score") or 0.0)),
                            float(value.get("price_amount") or 0.0),
                        )
                    )
            result.append(item)

        if sort == "best_value":
            result.sort(
                key=lambda item: (
                    -(float(item.get("_best_value_score") or 0.0)),
                    item["minimal_price"] if item["minimal_price"] is not None else 10**18,
                ),
            )
        elif sort == "delivery":
            def _store_min_delivery_days(store_item: dict) -> int:
                days = [int(offer["delivery_days"]) for offer in store_item["offers"] if offer.get("delivery_days") is not None]
                return min(days) if days else 999

            result.sort(key=_store_min_delivery_days)
        elif sort == "seller_rating":
            result.sort(key=lambda item: item["offers_count"], reverse=True)
        else:
            result.sort(
                key=lambda item: (item["minimal_price"] if item["minimal_price"] is not None else 10**18),
            )
        for item in result:
            item.pop("_best_value_score", None)
        return result

    async def _load_store_specs_for_products(self, product_ids: list[int]) -> dict[int, dict[str, str]]:
        if not product_ids:
            return {}
        unique_ids = sorted({int(product_id) for product_id in product_ids})
        if not unique_ids:
            return {}
        rows = (
            await self.session.execute(
                text(
                    """
                    with ranked_specs as (
                        select
                            canonical_product_id,
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
                            row_number() over (
                                partition by canonical_product_id
                                order by
                                    case
                                        when jsonb_typeof(metadata->'specifications') = 'object' then (select count(*) from jsonb_each(metadata->'specifications'))
                                        when jsonb_typeof(metadata->'specs') = 'object' then (select count(*) from jsonb_each(metadata->'specs'))
                                        else 0
                                    end desc,
                                    last_seen_at desc,
                                    id desc
                            ) as row_rank
                        from catalog_store_products
                        where canonical_product_id = any(cast(:product_ids as bigint[]))
                    )
                    select
                        canonical_product_id,
                        specs
                    from ranked_specs
                    where row_rank <= 8
                      and specs <> '{}'::jsonb
                    order by canonical_product_id asc, row_rank asc
                    """
                ),
                {"product_ids": unique_ids},
            )
        ).all()

        by_product: dict[int, dict[str, str]] = {}
        for row in rows:
            product_id = int(row.canonical_product_id)
            specs = row.specs if isinstance(row.specs, dict) else {}
            if not specs:
                continue
            merged = _merge_specs_maps(by_product.get(product_id), specs)
            if merged:
                by_product[product_id] = merged
        return by_product

    async def _load_store_image_candidates_for_products(
        self,
        product_ids: list[int],
        *,
        per_product_limit: int = 8,
    ) -> dict[int, list[dict[str, object]]]:
        if not product_ids:
            return {}
        unique_ids = sorted({int(product_id) for product_id in product_ids if int(product_id) > 0})
        if not unique_ids:
            return {}

        rows = (
            await self.session.execute(
                text(
                    """
                    with ranked_images as (
                        select
                            canonical_product_id,
                            image_url,
                            case
                                when jsonb_typeof(metadata->'images') = 'array' then metadata->'images'
                                else '[]'::jsonb
                            end as images,
                            coalesce(title_clean, title_raw) as source_title,
                            coalesce(
                                metadata->>'color',
                                case
                                    when jsonb_typeof(metadata->'specifications') = 'object' then metadata->'specifications'->>'color'
                                    else null
                                end,
                                case
                                    when jsonb_typeof(metadata->'specs') = 'object' then metadata->'specs'->>'color'
                                    else null
                                end
                            ) as source_color,
                            row_number() over (
                                partition by canonical_product_id
                                order by last_seen_at desc nulls last, id desc
                            ) as row_rank
                        from catalog_store_products
                        where canonical_product_id = any(cast(:product_ids as bigint[]))
                    )
                    select
                        canonical_product_id,
                        image_url,
                        images,
                        source_title,
                        source_color
                    from ranked_images
                    where row_rank <= :per_product_limit
                    order by canonical_product_id asc, row_rank asc
                    """
                ),
                {
                    "product_ids": unique_ids,
                    "per_product_limit": max(1, min(int(per_product_limit), 12)),
                },
            )
        ).all()

        by_product: dict[int, list[dict[str, object]]] = {}
        seen_urls: dict[int, set[str]] = {}

        for row in rows:
            product_id = int(row.canonical_product_id)
            source_title = str(row.source_title or "").strip() or None
            source_color = str(row.source_color or "").strip() or None

            bucket = by_product.setdefault(product_id, [])
            seen_bucket = seen_urls.setdefault(product_id, set())

            def append_candidate(value: object, *, source_priority: int) -> None:
                url = str(value or "").strip()
                if not url or url in seen_bucket:
                    return
                seen_bucket.add(url)
                bucket.append(
                    {
                        "url": url,
                        "source_priority": source_priority,
                        "source_title": source_title,
                        "source_color": source_color,
                    }
                )

            raw_images = row.images if isinstance(row.images, list) else []
            for image in raw_images:
                append_candidate(image, source_priority=0)
            append_candidate(row.image_url, source_priority=1)

        return by_product

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
        flat = [offer for group in offers_by_store for offer in group["offers"]]
        if sort == "best_value":
            flat.sort(
                key=lambda value: (
                    -(float(value.get("best_value_score") or 0.0)),
                    float(value.get("price_amount") or 0.0),
                )
            )
        return flat

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
                CatalogCanonicalProduct.created_at,
                CatalogCanonicalProduct.specs,
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
        if decoded and decoded.get("sort") and decoded.get("sort") != sort:
            decoded = None
        if decoded:
            last_id = int(decoded["last_id"])
            if sort == "price_asc":
                last_price = Decimal(decoded["last_price"]) if "last_price" in decoded else None
                stmt = stmt.where(
                    (CatalogProductSearch.min_price > last_price)
                    | ((CatalogProductSearch.min_price == last_price) & (CatalogCanonicalProduct.id > last_id))
                )
            elif sort == "price_desc":
                last_price = Decimal(decoded["last_price"]) if "last_price" in decoded else None
                stmt = stmt.where(
                    (CatalogProductSearch.min_price < last_price)
                    | ((CatalogProductSearch.min_price == last_price) & (CatalogCanonicalProduct.id > last_id))
                )
            elif sort == "popular":
                last_store_count = int(decoded.get("last_store_count", 0))
                stmt = stmt.where(
                    or_(
                        CatalogProductSearch.store_count < last_store_count,
                        and_(
                            CatalogProductSearch.store_count == last_store_count,
                            CatalogCanonicalProduct.id > last_id,
                        ),
                    )
                )
            elif sort == "newest":
                last_created_at_raw = decoded.get("last_created_at")
                last_created_at = None
                if isinstance(last_created_at_raw, str):
                    try:
                        last_created_at = datetime.fromisoformat(last_created_at_raw)
                    except ValueError:
                        last_created_at = None
                if last_created_at is not None:
                    stmt = stmt.where(
                        or_(
                            CatalogCanonicalProduct.created_at < last_created_at,
                            and_(
                                CatalogCanonicalProduct.created_at == last_created_at,
                                CatalogCanonicalProduct.id > last_id,
                            ),
                        )
                    )
                else:
                    stmt = stmt.where(CatalogCanonicalProduct.id > last_id)
            elif sort == "relevance":
                last_rank_raw = decoded.get("last_rank")
                try:
                    last_rank = float(last_rank_raw)
                except (TypeError, ValueError):
                    last_rank = None
                if last_rank is not None:
                    stmt = stmt.where(
                        or_(
                            rank_expr < last_rank,
                            and_(
                                rank_expr == last_rank,
                                CatalogCanonicalProduct.id > last_id,
                            ),
                        )
                    )
                else:
                    stmt = stmt.where(CatalogCanonicalProduct.id > last_id)
            else:
                stmt = stmt.where(CatalogCanonicalProduct.id > last_id)

        rows = (await self.session.execute(stmt.limit(limit + 1))).all()
        has_next = len(rows) > limit
        rows = rows[:limit]
        product_ids = [int(row.id) for row in rows]
        fallback_specs_map = await self._load_store_specs_for_products(product_ids)
        fallback_image_ids = [int(row.id) for row in rows if _needs_catalog_image_fallback(str(row.main_image or ""))]
        fallback_images_map = await self._load_store_image_candidates_for_products(fallback_image_ids)

        items: list[dict[str, object]] = []
        for r in rows:
            product_id = int(r.id)
            merged_specs = _merge_specs_maps(
                r.specs if isinstance(r.specs, dict) else {},
                fallback_specs_map.get(product_id),
            )
            preferred_color = _extract_official_color_name(str(merged_specs.get("color") or "")) or _format_color_label(
                str(merged_specs.get("color") or "")
            )
            image_url = _select_catalog_card_image(
                r.main_image,
                fallback_candidates=fallback_images_map.get(product_id),
                target_color=preferred_color,
            )

            items.append(
                {
                    "id": r.product_uuid,
                    "normalized_title": format_product_title(
                        r.normalized_title,
                        brand_name=r.brand_name,
                        specs=merged_specs,
                    ),
                    "image_url": image_url,
                    "brand": {"id": r.brand_uuid, "name": r.brand_name} if r.brand_id else None,
                    "category": {"id": r.category_uuid, "name": r.category_name},
                    "min_price": float(r.min_price) if r.min_price is not None else None,
                    "max_price": float(r.max_price) if r.max_price is not None else None,
                    "store_count": r.store_count,
                    "score": float(r.rank or 0),
                }
            )

        next_cursor = None
        if has_next and rows:
            last = rows[-1]
            payload = {"last_id": last.id, "sort": sort}
            if sort in {"price_asc", "price_desc"}:
                payload["last_price"] = str(last.min_price or "0")
            elif sort == "popular":
                payload["last_store_count"] = int(last.store_count or 0)
            elif sort == "newest" and last.created_at is not None:
                payload["last_created_at"] = last.created_at.isoformat()
            elif sort == "relevance":
                payload["last_rank"] = float(last.rank or 0)
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
            select(
                CatalogBrand.id,
                CatalogBrand.uuid,
                CatalogBrand.name,
                func.count(func.distinct(CatalogCanonicalProduct.id)).label("products_count"),
            )
            .join(
                CatalogCanonicalProduct,
                and_(
                    CatalogCanonicalProduct.brand_id == CatalogBrand.id,
                    CatalogCanonicalProduct.is_active.is_(True),
                ),
            )
            .join(
                CatalogProductSearch,
                and_(
                    CatalogProductSearch.product_id == CatalogCanonicalProduct.id,
                    CatalogProductSearch.store_count > 0,
                ),
            )
            .group_by(CatalogBrand.id, CatalogBrand.name)
            .order_by(func.count(func.distinct(CatalogCanonicalProduct.id)).desc(), CatalogBrand.name.asc())
            .limit(limit)
        )
        if q:
            stmt = stmt.where(CatalogBrand.name.ilike(f"%{q}%"))
        if category_id:
            stmt = stmt.where(CatalogCanonicalProduct.category_id == category_id)
        rows = (await self.session.execute(stmt)).all()
        return [{"id": r.uuid, "name": r.name, "products_count": int(r.products_count or 0)} for r in rows]

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
