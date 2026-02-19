import re


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


def build_canonical_title(raw_title: str) -> str:
    text = normalize_title(raw_title)

    # Remove storefront noise that should not split canonical products.
    noise_patterns = [
        r"\bsmartfon\b",
        r"\bsmartphone\b",
        r"\bсмартф\w*\b",
        r"\bв\s+ташкенте\b",
        r"\btsena\b",
        r"\bcena\b",
        r"\bцена\b",
    ]
    for pattern in noise_patterns:
        text = re.sub(pattern, " ", text, flags=re.IGNORECASE)

    # Keep color as part of canonical identity, but normalize memory notation.
    text = _normalize_memory_notation(text)

    # Normalize tightly packed model tokens.
    text = re.sub(r"\biphone\s*(\d{1,2})\b", r"iphone \1", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs(\d{2})\+\b", r"s\1 plus", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs(\d{2})\s*(ultra|plus|fe)\b", r"s\1 \2", text, flags=re.IGNORECASE)

    # Smartphone titles are often inconsistent between stores: "12/256gb" vs "256gb".
    # For canonical grouping we keep model + storage + color and ignore leading RAM.
    if re.search(r"\b(iphone|galaxy|samsung|xiaomi|redmi|honor|oneplus|pixel|nothing)\b", text, flags=re.IGNORECASE):
        text = re.sub(r"\b\d{1,2}/(\d{2,4}gb)\b", r"\1", text, flags=re.IGNORECASE)

    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_specs(raw_specs: dict | None) -> dict:
    if not isinstance(raw_specs, dict):
        return {}
    normalized: dict[str, str] = {}
    for key, value in raw_specs.items():
        k = normalize_title(str(key)).replace("_", " ").strip()
        if not k:
            continue
        v = str(value).strip()
        if not v:
            continue
        normalized[k] = v
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
