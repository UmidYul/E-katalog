from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.logging import logger
from app.platform.services.canonical_matching import extract_attributes

try:
    import yaml
except Exception:  # noqa: BLE001
    yaml = None


_DEFAULT_NOISE_PATTERNS: tuple[str, ...] = (
    r"\bsmartfon\b",
    r"\bsmartphone\b",
    r"\bсмартфон\w*\b",
    r"\bв\s+ташкенте\b",
    r"\btsena\b",
    r"\bcena\b",
    r"\bцена\b",
)

_DEFAULT_COLORS: tuple[str, ...] = (
    "deep blue",
    "cosmic orange",
    "mist blue",
    "lavender",
    "silver",
    "black",
    "white",
    "blue",
    "green",
    "pink",
    "yellow",
    "sage",
    "midnight",
    "graphite",
)

_SMARTPHONE_PATTERN = re.compile(
    r"\b(iphone|galaxy|samsung|xiaomi|redmi|honor|oneplus|pixel|nothing)\b",
    flags=re.IGNORECASE,
)

_DEFAULT_BRAND_ALIASES: dict[str, tuple[str, ...]] = {
    "apple": ("apple", "iphone"),
    "samsung": ("samsung", "galaxy"),
    "xiaomi": ("xiaomi", "redmi", "poco"),
    "honor": ("honor",),
    "huawei": ("huawei",),
    "google": ("google", "pixel"),
    "oneplus": ("oneplus", "one plus"),
    "nothing": ("nothing",),
}

_SPEC_BRAND_KEYS: tuple[str, ...] = ("brand", "manufacturer", "vendor")

_DEFAULT_SPEC_KEY_ALIASES: dict[str, str] = {
    "storage": "storage_gb",
    "storage gb": "storage_gb",
    "built in memory": "storage_gb",
    "built_in_memory": "storage_gb",
    "встроенная память": "storage_gb",
    "ram": "ram_gb",
    "ram gb": "ram_gb",
    "оперативная память": "ram_gb",
    "battery": "battery_mah",
    "battery mah": "battery_mah",
    "емкость аккумулятора": "battery_mah",
    "camera": "camera_mp",
    "camera mp": "camera_mp",
    "main camera": "main_camera_mp",
    "front camera": "front_camera_mp",
    "display": "display_inches",
    "display inches": "display_inches",
    "screen inches": "display_inches",
    "диагональ экрана": "display_inches",
    "cpu frequency": "cpu_frequency_mhz",
    "cpu_frequency": "cpu_frequency_mhz",
    "частота процессора": "cpu_frequency_mhz",
    "refresh rate": "refresh_rate_hz",
    "refresh rate hz": "refresh_rate_hz",
    "wifi": "wifi_standard",
    "wi fi": "wifi_standard",
    "bluetooth": "bluetooth_standard",
    "os": "os",
    "operating system": "os",
    "операционная система": "os",
}

_DEFAULT_PLACEHOLDER_SPEC_VALUES: set[str] = {
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


_RULES_CACHE: dict[str, Any] | None = None
_RULES_CACHE_LOADED_AT: float = 0.0
_RULES_CACHE_MTIME: float | None = None
_RULES_CACHE_PATH: str | None = None


def _default_rules() -> dict[str, Any]:
    return {
        "noise_patterns": list(_DEFAULT_NOISE_PATTERNS),
        "colors": list(_DEFAULT_COLORS),
        "brand_aliases": {key: list(values) for key, values in _DEFAULT_BRAND_ALIASES.items()},
        "spec_key_aliases": dict(_DEFAULT_SPEC_KEY_ALIASES),
        "placeholder_spec_values": sorted(_DEFAULT_PLACEHOLDER_SPEC_VALUES),
    }


def _sanitize_rules(raw: dict[str, Any]) -> dict[str, Any]:
    defaults = _default_rules()
    merged = {
        "noise_patterns": list(defaults["noise_patterns"]),
        "colors": list(defaults["colors"]),
        "brand_aliases": dict(defaults["brand_aliases"]),
        "spec_key_aliases": dict(defaults["spec_key_aliases"]),
        "placeholder_spec_values": list(defaults["placeholder_spec_values"]),
    }
    if not isinstance(raw, dict):
        return merged

    noise_patterns = raw.get("noise_patterns")
    if isinstance(noise_patterns, list):
        merged["noise_patterns"] = [str(item).strip() for item in noise_patterns if str(item).strip()]

    colors = raw.get("colors")
    if isinstance(colors, list):
        merged["colors"] = [str(item).strip().lower() for item in colors if str(item).strip()]

    brand_aliases = raw.get("brand_aliases")
    if isinstance(brand_aliases, dict):
        normalized_aliases: dict[str, list[str]] = {}
        for canonical, aliases in brand_aliases.items():
            canonical_name = str(canonical).strip().lower()
            if not canonical_name:
                continue
            if not isinstance(aliases, list):
                continue
            normalized = [str(alias).strip().lower() for alias in aliases if str(alias).strip()]
            if normalized:
                normalized_aliases[canonical_name] = normalized
        if normalized_aliases:
            merged["brand_aliases"] = normalized_aliases

    spec_key_aliases = raw.get("spec_key_aliases")
    if isinstance(spec_key_aliases, dict):
        normalized_spec_aliases: dict[str, str] = {}
        for source_key, target_key in spec_key_aliases.items():
            source = str(source_key).strip().lower()
            target = str(target_key).strip()
            if not source or not target:
                continue
            normalized_spec_aliases[source] = target
        if normalized_spec_aliases:
            merged["spec_key_aliases"] = normalized_spec_aliases

    placeholder_values = raw.get("placeholder_spec_values")
    if isinstance(placeholder_values, list):
        merged["placeholder_spec_values"] = [
            str(item).strip().lower() for item in placeholder_values if str(item).strip()
        ]

    return merged


def _load_rules_from_path(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    text_value = path.read_text(encoding="utf-8")
    parsed: Any
    if suffix in {".yml", ".yaml"}:
        if yaml is None:
            raise RuntimeError("PyYAML is not installed")
        parsed = yaml.safe_load(text_value)
    else:
        parsed = json.loads(text_value)
    return _sanitize_rules(parsed if isinstance(parsed, dict) else {})


def _rules_path() -> Path:
    configured = str(settings.normalization_rules_path or "").strip()
    if not configured:
        configured = "services/worker/app/platform/services/normalization_rules.yaml"
    path = Path(configured)
    if path.is_absolute():
        return path
    return Path.cwd() / path


def _reset_normalization_rules_cache() -> None:
    global _RULES_CACHE, _RULES_CACHE_LOADED_AT, _RULES_CACHE_MTIME, _RULES_CACHE_PATH
    _RULES_CACHE = None
    _RULES_CACHE_LOADED_AT = 0.0
    _RULES_CACHE_MTIME = None
    _RULES_CACHE_PATH = None


def get_normalization_rules(*, force_reload: bool = False) -> dict[str, Any]:
    global _RULES_CACHE, _RULES_CACHE_LOADED_AT, _RULES_CACHE_MTIME, _RULES_CACHE_PATH

    default_rules = _default_rules()
    if not settings.normalization_rules_enabled:
        _RULES_CACHE = default_rules
        _RULES_CACHE_LOADED_AT = time.time()
        _RULES_CACHE_MTIME = None
        _RULES_CACHE_PATH = None
        return default_rules

    reload_seconds = max(1, int(settings.normalization_rules_reload_seconds))
    now_ts = time.time()
    path = _rules_path()
    path_text = str(path)

    if not force_reload and _RULES_CACHE is not None and (now_ts - _RULES_CACHE_LOADED_AT) < reload_seconds:
        return _RULES_CACHE

    mtime: float | None = None
    if path.exists():
        try:
            mtime = path.stat().st_mtime
        except OSError:
            mtime = None

    cache_valid = (
        not force_reload
        and _RULES_CACHE is not None
        and _RULES_CACHE_PATH == path_text
        and _RULES_CACHE_MTIME == mtime
    )
    if cache_valid:
        _RULES_CACHE_LOADED_AT = now_ts
        return _RULES_CACHE

    if not path.exists():
        _RULES_CACHE = default_rules
        _RULES_CACHE_LOADED_AT = now_ts
        _RULES_CACHE_MTIME = None
        _RULES_CACHE_PATH = path_text
        return _RULES_CACHE

    try:
        loaded = _load_rules_from_path(path)
        _RULES_CACHE = loaded
        _RULES_CACHE_LOADED_AT = now_ts
        _RULES_CACHE_MTIME = mtime
        _RULES_CACHE_PATH = path_text
        logger.info("normalization_rules_loaded", path=path_text, mtime=mtime)
        return loaded
    except Exception as exc:  # noqa: BLE001
        logger.warning("normalization_rules_load_failed", path=path_text, error=str(exc))
        _RULES_CACHE = default_rules
        _RULES_CACHE_LOADED_AT = now_ts
        _RULES_CACHE_MTIME = mtime
        _RULES_CACHE_PATH = path_text
        return _RULES_CACHE


def normalize_title(raw_title: str) -> str:
    text = raw_title.lower().strip()
    text = re.sub(r"[^\w\s\-+/]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _split_packed_memory_token(token: str) -> tuple[str, str] | None:
    for ram_len in (2, 1):
        if len(token) <= ram_len:
            continue
        ram = token[:ram_len]
        storage = token[ram_len:]
        if storage not in {"128", "256", "512", "1024"}:
            continue
        try:
            ram_value = int(ram)
        except ValueError:
            continue
        if 2 <= ram_value <= 24:
            return str(ram_value), storage
    return None


def _normalize_memory_notation(text: str) -> str:
    text = re.sub(r"\s*/\s*", "/", text)
    text = re.sub(r"(\d+)\s*gb\b", r"\1gb", text, flags=re.IGNORECASE)

    def replace_packed(match: re.Match[str]) -> str:
        token = match.group(1)
        parsed = _split_packed_memory_token(token)
        if not parsed:
            return match.group(0)
        ram, storage = parsed
        return f"{ram}/{storage}gb"

    text = re.sub(r"\b(\d{4,5})gb\b", replace_packed, text, flags=re.IGNORECASE)
    return text


def _fallback_canonical_title(raw_title: str) -> str:
    rules = get_normalization_rules()
    text = normalize_title(raw_title)
    for pattern in rules["noise_patterns"]:
        text = re.sub(str(pattern), " ", text, flags=re.IGNORECASE)

    text = _normalize_memory_notation(text)
    text = re.sub(r"\biphone\s*(\d{1,2})\b", r"iphone \1", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs(\d{2})\+\b", r"s\1 plus", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs(\d{2})\s*(ultra|plus|fe)\b", r"s\1 \2", text, flags=re.IGNORECASE)

    if _SMARTPHONE_PATTERN.search(text):
        text = re.sub(r"\b\d{1,2}/(\d{2,4}gb)\b", r"\1", text, flags=re.IGNORECASE)

    for color in rules["colors"]:
        text = re.sub(rf"\b{re.escape(str(color))}\b", " ", text, flags=re.IGNORECASE)

    return re.sub(r"\s+", " ", text).strip()


def build_canonical_title(raw_title: str) -> str:
    attrs = extract_attributes(_normalize_memory_notation(raw_title))
    if attrs.brand != "unknown" and attrs.model != "unknown" and attrs.storage != "unknown":
        return f"{attrs.brand} {attrs.model} {attrs.storage}gb"
    return _fallback_canonical_title(raw_title)


def _normalize_spec_key(raw_key: object) -> str:
    spec_key_aliases: dict[str, str] = get_normalization_rules()["spec_key_aliases"]
    key = normalize_title(str(raw_key))
    key = key.replace("_", " ").replace("-", " ").replace("/", " ")
    key = re.sub(r"\s+", " ", key).strip()
    if not key:
        return ""
    alias = spec_key_aliases.get(key, key)
    snake = re.sub(r"[^\w]+", "_", alias, flags=re.UNICODE).strip("_")
    if not snake:
        return ""
    return spec_key_aliases.get(snake, snake)


def _normalize_spec_value(raw_value: object) -> str | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, bool):
        return "yes" if raw_value else "no"
    if isinstance(raw_value, (int, float)):
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
    placeholders = {str(item).strip().lower() for item in get_normalization_rules()["placeholder_spec_values"]}
    return value.strip().lower() in placeholders


def _pick_spec_value(current: str | None, candidate: str) -> str:
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


def normalize_specs(raw_specs: dict | None) -> dict:
    if not isinstance(raw_specs, dict):
        return {}
    normalized: dict[str, str] = {}
    for key, value in raw_specs.items():
        k = _normalize_spec_key(key)
        if not k:
            continue
        v = _normalize_spec_value(value)
        if not v:
            continue
        normalized[k] = _pick_spec_value(normalized.get(k), v)
    return normalized


def enrich_specs_from_title(raw_title: str, specs: dict | None = None) -> dict:
    enriched = dict(specs or {})
    title = _normalize_memory_notation(normalize_title(raw_title))
    colors = get_normalization_rules()["colors"]

    def set_if_missing(key: str, value: str | None) -> None:
        if value and not enriched.get(key):
            enriched[key] = value

    model_match = re.search(
        r"\biphone\s*(\d{1,2}(?:\s*(?:pro\s*max|pro|max|plus|mini|e))?)\b",
        title,
        flags=re.IGNORECASE,
    )
    if model_match:
        model_suffix = re.sub(r"\s+", " ", model_match.group(1).strip())
        set_if_missing("model", f"iphone {model_suffix}")

    mem_match = re.search(r"\b(\d{1,2})/(\d{2,4})gb\b", title, flags=re.IGNORECASE)
    if mem_match:
        if "iphone" not in title:
            set_if_missing("ram_gb", mem_match.group(1))
        set_if_missing("storage_gb", mem_match.group(2))
    else:
        storage_match = re.search(r"\b(\d{2,4})gb\b", title, flags=re.IGNORECASE)
        if storage_match:
            set_if_missing("storage_gb", storage_match.group(1))

    for color in colors:
        if re.search(rf"\b{re.escape(str(color))}\b", title):
            set_if_missing("color", str(color))
            break

    return enriched


def normalize_seller_name(raw_name: str | None, fallback: str) -> str:
    source = raw_name or fallback
    source = source.strip() or fallback
    source = re.sub(r"\s+", " ", source)
    return source


def detect_brand(raw_title: str, specs: dict | None = None) -> str | None:
    brand_aliases: dict[str, list[str]] = get_normalization_rules()["brand_aliases"]
    values: list[str] = [normalize_title(raw_title)]
    if isinstance(specs, dict):
        for key in _SPEC_BRAND_KEYS:
            value = specs.get(key)
            if value is None:
                continue
            values.append(normalize_title(str(value)))

    haystack = " ".join(value for value in values if value).strip()
    if not haystack:
        return None

    for canonical, aliases in brand_aliases.items():
        for alias in aliases:
            if re.search(rf"\b{re.escape(alias)}\b", haystack, flags=re.IGNORECASE):
                return canonical
    return None

