from __future__ import annotations

import re

REQUIRED_BY_DEVICE: dict[str, list[str]] = {
    "smartphone": ["cpu", "ram_gb", "storage_gb", "battery_mah", "camera_mp", "display_inches"],
    "laptop": ["cpu", "ram_gb", "storage_gb", "display_inches"],
}


def normalize_product_specs(
    title: str,
    raw_specs: dict[str, str],
    category_hint: str | None = None,
    extra_text: str | None = None,
) -> dict[str, str]:
    specs: dict[str, str] = {}
    source_text = f"{title} {extra_text or ''}".strip()
    title_l = source_text.lower()
    hint_l = (category_hint or "").lower()

    def set_if_missing(key: str, value: str | None) -> None:
        if value and key not in specs:
            specs[key] = value

    for k, v in raw_specs.items():
        if not k or not v:
            continue
        key = _map_key(k)
        if key:
            specs[key] = str(v)

    # Normalize packed memory values that may come from raw characteristics, e.g. "8+4/128".
    packed_memory = specs.get("ram_gb")
    if packed_memory:
        ram_gb, virtual_ram_gb, storage_gb = _extract_memory(str(packed_memory))
        if ram_gb:
            specs["ram_gb"] = ram_gb
        if virtual_ram_gb:
            specs["virtual_ram_gb"] = virtual_ram_gb
        if storage_gb and "storage_gb" not in specs:
            specs["storage_gb"] = storage_gb

    # Category/device hint.
    if any(x in hint_l for x in ["smartfon", "smartfon", "phone", "telefon", "смартфон"]) or any(
        x in title_l for x in ["smartphone", "смартфон", "iphone", "redmi", "samsung galaxy", "honor", "poco"]
    ):
        specs["device_type"] = "smartphone"
    elif any(x in hint_l for x in ["noutbuk", "laptop", "ноутбук"]) or any(
        x in title_l for x in ["ноутбук", "laptop", "macbook", "thinkpad", "zenbook", "vivobook", "tuf"]
    ):
        specs["device_type"] = "laptop"

    # Common extractors from title.
    display_inches = _extract_display_inches(source_text)
    set_if_missing("display_inches", display_inches)
    refresh_hz = _extract_refresh_hz(source_text)
    set_if_missing("refresh_rate_hz", refresh_hz)

    # Memory patterns.
    ram_gb, virtual_ram_gb, storage_gb = _extract_memory(source_text)
    set_if_missing("ram_gb", ram_gb)
    set_if_missing("virtual_ram_gb", virtual_ram_gb)
    set_if_missing("storage_gb", storage_gb)

    cpu = _extract_cpu(source_text)
    set_if_missing("cpu", cpu)
    gpu = _extract_gpu(source_text)
    set_if_missing("gpu", gpu)

    battery = _extract_battery(source_text)
    set_if_missing("battery_mah", battery)
    camera = _extract_camera(source_text)
    set_if_missing("camera_mp", camera)

    if "5g" in title_l:
        set_if_missing("network", "5G")
    elif "4g" in title_l:
        set_if_missing("network", "4G")

    return specs


def needs_ai_enrichment(specs: dict[str, str]) -> bool:
    device = specs.get("device_type")
    if device not in {"smartphone", "laptop"}:
        return False

    if device == "smartphone":
        core = ["ram_gb", "storage_gb", "cpu", "battery_mah", "camera_mp", "display_inches"]
    else:
        core = ["ram_gb", "storage_gb", "cpu", "display_inches"]

    present = sum(1 for key in core if specs.get(key))
    return present < max(2, len(core) // 2)


def missing_required_fields(specs: dict[str, str]) -> list[str]:
    device = specs.get("device_type")
    required = REQUIRED_BY_DEVICE.get(device or "", [])
    return [key for key in required if not specs.get(key)]


def _map_key(key: str) -> str | None:
    k = key.lower().strip()
    if any(x in k for x in ["rang", "цвет", "color"]):
        return "color"
    if any(x in k for x in ["protsessor", "процессор", "processor", "cpu", "chipset"]):
        return "cpu"
    if any(x in k for x in ["videokarta", "видеокарта", "gpu", "graphics", "rtx", "gtx"]):
        return "gpu"
    if any(x in k for x in ["xotira", "память", "ram", "оператив"]):
        return "ram_gb"
    if any(x in k for x in ["ssd", "накоп", "storage", "rom"]):
        return "storage_gb"
    if any(x in k for x in ["ekran", "дисплей", "display", "screen"]):
        return "display_inches"
    if any(x in k for x in ["kamera", "камера", "camera"]):
        return "camera_mp"
    if any(x in k for x in ["batareya", "battery", "аккум"]):
        return "battery_mah"
    return None


def _extract_display_inches(title: str) -> str | None:
    m = re.search(r"(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:\"|''|inch|дюйм)", title, flags=re.IGNORECASE)
    if not m:
        return None
    return m.group(1).replace(",", ".")


def _extract_refresh_hz(title: str) -> str | None:
    m = re.search(r"(\d{2,3})\s*hz", title, flags=re.IGNORECASE)
    return m.group(1) if m else None


def _extract_memory(title: str) -> tuple[str | None, str | None, str | None]:
    # 8+4/128GB
    m = re.search(r"(\d{1,3})\s*\+\s*(\d{1,3})\s*/\s*(\d{1,4})\s*(?:gb|гб)", title, flags=re.IGNORECASE)
    if m:
        return m.group(1), m.group(2), m.group(3)

    # 8/256GB
    m = re.search(r"(\d{1,3})\s*/\s*(\d{1,4})\s*(?:gb|гб)", title, flags=re.IGNORECASE)
    if m:
        return m.group(1), None, m.group(2)

    # 8GB + 256GB
    m = re.search(r"(\d{1,3})\s*(?:gb|гб)\s*\+\s*(\d{1,4})\s*(?:gb|гб)", title, flags=re.IGNORECASE)
    if m:
        return m.group(1), None, m.group(2)

    # RAM 16GB ... SSD 512GB
    ram = None
    storage = None
    slash_pairs = re.findall(r"(\d{1,3})\s*/\s*(\d{2,4})", title, flags=re.IGNORECASE)
    if slash_pairs:
        return slash_pairs[0][0], None, slash_pairs[0][1]

    m_ram = re.search(r"(\d{1,3})\s*(?:gb|гб)\s*(?:ddr\d|ram)", title, flags=re.IGNORECASE)
    if not m_ram:
        m_ram = re.search(r"(?:ddr\d|ram)\s*(\d{1,3})\s*(?:gb|гб)", title, flags=re.IGNORECASE)
    if m_ram:
        ram = m_ram.group(1)
    m_ssd = re.search(r"(\d{2,4})\s*(?:gb|гб)\s*(?:ssd|rom|накоп)", title, flags=re.IGNORECASE)
    if not m_ssd:
        m_ssd = re.search(r"(?:ssd|rom|накоп)\s*(\d{2,4})\s*(?:gb|гб)", title, flags=re.IGNORECASE)
    if m_ssd:
        storage = m_ssd.group(1)
    return ram, None, storage


def _extract_cpu(title: str) -> str | None:
    patterns = [
        r"(Snapdragon\s*\d+[A-Za-z+]*)",
        r"(Dimensity\s*\d+[A-Za-z+]*)",
        r"(Helio\s*[A-Z]?\d+[A-Za-z+]*)",
        r"(Exynos\s*\d+[A-Za-z+]*)",
        r"(Tensor\s*[A-Za-z0-9+]*)",
        r"(Intel\s*Core\s*i[3579][-\s]?\d+[A-Za-z]*)",
        r"(Ryzen\s*[3579]\s*\d+[A-Za-z]*)",
        r"(N\d{3,5})",
    ]
    for p in patterns:
        m = re.search(p, title, flags=re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def _extract_gpu(title: str) -> str | None:
    patterns = [
        r"(RTX\s*\d{3,4})",
        r"(GTX\s*\d{3,4})",
        r"(RX\s*\d{3,4}[A-Za-z]*)",
    ]
    for p in patterns:
        m = re.search(p, title, flags=re.IGNORECASE)
        if m:
            return m.group(1).upper()
    return None


def _extract_battery(title: str) -> str | None:
    m = re.search(r"(\d{3,5})\s*(?:mah|mAh|м[аa]ч)", title, flags=re.IGNORECASE)
    return m.group(1) if m else None


def _extract_camera(title: str) -> str | None:
    m = re.search(r"(\d{2,3})\s*mp", title, flags=re.IGNORECASE)
    return m.group(1) if m else None
