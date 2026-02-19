import re


def normalize_title(raw_title: str) -> str:
    text = raw_title.lower().strip()
    text = re.sub(r"[^\w\s\-+/]", " ", text)
    text = re.sub(r"\s+", " ", text)
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


def normalize_seller_name(raw_name: str | None, fallback: str) -> str:
    source = raw_name or fallback
    source = source.strip() or fallback
    source = re.sub(r"\s+", " ", source)
    return source
