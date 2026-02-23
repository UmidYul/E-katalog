import re

from app.platform.services.canonical_matching import extract_attributes


_NOISE_PATTERNS: tuple[str, ...] = (
    r"\bsmartfon\b",
    r"\bsmartphone\b",
    r"\b\u0441\u043c\u0430\u0440\u0442\u0444\u043e\u043d\w*\b",
    r"\b\u0432\s+\u0442\u0430\u0448\u043a\u0435\u043d\u0442\u0435\b",
    r"\btsena\b",
    r"\bcena\b",
    r"\b\u0446\u0435\u043d\u0430\b",
)

_COLOR_PATTERNS: tuple[str, ...] = (
    r"\bdeep blue\b",
    r"\bcosmic orange\b",
    r"\bmist blue\b",
    r"\blavender\b",
    r"\bsilver\b",
    r"\bblack\b",
    r"\bwhite\b",
    r"\bblue\b",
    r"\bgreen\b",
    r"\bpink\b",
    r"\byellow\b",
    r"\bsage\b",
    r"\bmidnight\b",
    r"\bgraphite\b",
)

_SMARTPHONE_PATTERN = re.compile(
    r"\b(iphone|galaxy|samsung|xiaomi|redmi|honor|oneplus|pixel|nothing)\b",
    flags=re.IGNORECASE,
)

_BRAND_ALIASES: dict[str, tuple[str, ...]] = {
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
    "cpu_frequency": "cpu_frequency_mhz",
    "\u0447\u0430\u0441\u0442\u043e\u0442\u0430 \u043f\u0440\u043e\u0446\u0435\u0441\u0441\u043e\u0440\u0430": "cpu_frequency_mhz",
    "refresh rate": "refresh_rate_hz",
    "refresh rate hz": "refresh_rate_hz",
    "wifi": "wifi_standard",
    "wi fi": "wifi_standard",
    "bluetooth": "bluetooth_standard",
    "os": "os",
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
    text = normalize_title(raw_title)
    for pattern in _NOISE_PATTERNS:
        text = re.sub(pattern, " ", text, flags=re.IGNORECASE)

    text = _normalize_memory_notation(text)
    text = re.sub(r"\biphone\s*(\d{1,2})\b", r"iphone \1", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs(\d{2})\+\b", r"s\1 plus", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs(\d{2})\s*(ultra|plus|fe)\b", r"s\1 \2", text, flags=re.IGNORECASE)

    if _SMARTPHONE_PATTERN.search(text):
        text = re.sub(r"\b\d{1,2}/(\d{2,4}gb)\b", r"\1", text, flags=re.IGNORECASE)

    for pattern in _COLOR_PATTERNS:
        text = re.sub(pattern, " ", text, flags=re.IGNORECASE)

    return re.sub(r"\s+", " ", text).strip()


def build_canonical_title(raw_title: str) -> str:
    attrs = extract_attributes(_normalize_memory_notation(raw_title))
    if attrs.brand != "unknown" and attrs.model != "unknown" and attrs.storage != "unknown":
        return f"{attrs.brand} {attrs.model} {attrs.storage}gb"
    return _fallback_canonical_title(raw_title)


def _normalize_spec_key(raw_key: object) -> str:
    key = normalize_title(str(raw_key))
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
    return value.strip().lower() in _PLACEHOLDER_SPEC_VALUES


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

    colors = [
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
    ]
    for color in colors:
        if re.search(rf"\b{re.escape(color)}\b", title):
            set_if_missing("color", color)
            break

    return enriched


def normalize_seller_name(raw_name: str | None, fallback: str) -> str:
    source = raw_name or fallback
    source = source.strip() or fallback
    source = re.sub(r"\s+", " ", source)
    return source


def detect_brand(raw_title: str, specs: dict | None = None) -> str | None:
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

    for canonical, aliases in _BRAND_ALIASES.items():
        for alias in aliases:
            if re.search(rf"\b{re.escape(alias)}\b", haystack, flags=re.IGNORECASE):
                return canonical
    return None
