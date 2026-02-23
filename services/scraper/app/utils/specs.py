from __future__ import annotations

import re

REQUIRED_BY_DEVICE: dict[str, list[str]] = {
    "smartphone": ["cpu", "ram_gb", "storage_gb", "battery_mah", "camera_mp", "display_inches"],
    "laptop": ["cpu", "ram_gb", "storage_gb", "display_inches"],
}


_RU_SMARTPHONE = "\u0441\u043c\u0430\u0440\u0442\u0444\u043e\u043d"
_RU_LAPTOP = "\u043d\u043e\u0443\u0442\u0431\u0443\u043a"
_RU_GB = "\u0433\u0431"
_RU_WEIGHT = "\u0432\u0435\u0441"
_RU_SIZE = "\u0433\u0430\u0431\u0430\u0440\u0438\u0442"


def _normalize_raw_key(key: str) -> str:
    cleaned = key.lower().replace("\u00a0", " ").strip()
    return re.sub(r"\s+", " ", cleaned)


def _normalize_spec_value(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


def _fallback_key(key: str) -> str | None:
    cleaned = _normalize_raw_key(key)
    normalized = re.sub(r"[^\w]+", "_", cleaned, flags=re.IGNORECASE)
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized or None


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
        value = _normalize_spec_value(str(v))
        if not value:
            continue
        canonical_key = _map_key(k)
        if canonical_key:
            specs[canonical_key] = value
            continue
        fallback = _fallback_key(k)
        if fallback:
            specs.setdefault(fallback, value)

    packed_memory = specs.get("ram_gb")
    if packed_memory:
        ram_gb, virtual_ram_gb, storage_gb = _extract_memory(str(packed_memory))
        if ram_gb:
            specs["ram_gb"] = ram_gb
        if virtual_ram_gb:
            specs["virtual_ram_gb"] = virtual_ram_gb
        if storage_gb and "storage_gb" not in specs:
            specs["storage_gb"] = storage_gb

    if any(x in hint_l for x in ["smartphone", "phone", "telefon", _RU_SMARTPHONE]) or any(
        x in title_l for x in ["smartphone", _RU_SMARTPHONE, "iphone", "redmi", "samsung galaxy", "honor", "poco"]
    ):
        specs["device_type"] = "smartphone"
    elif any(x in hint_l for x in ["laptop", "notebook", _RU_LAPTOP]) or any(
        x in title_l for x in [_RU_LAPTOP, "laptop", "macbook", "thinkpad", "zenbook", "vivobook", "tuf"]
    ):
        specs["device_type"] = "laptop"

    set_if_missing("display_inches", _extract_display_inches(source_text))
    set_if_missing("refresh_rate_hz", _extract_refresh_hz(source_text))

    ram_gb, virtual_ram_gb, storage_gb = _extract_memory(source_text)
    set_if_missing("ram_gb", ram_gb)
    set_if_missing("virtual_ram_gb", virtual_ram_gb)
    set_if_missing("storage_gb", storage_gb)

    set_if_missing("cpu", _extract_cpu(source_text))
    set_if_missing("gpu", _extract_gpu(source_text))
    set_if_missing("battery_mah", _extract_battery(source_text))
    set_if_missing("camera_mp", _extract_camera(source_text))
    set_if_missing("cpu_frequency_mhz", _extract_cpu_frequency_mhz(source_text))
    set_if_missing("charging_power_w", _extract_charging_power_w(source_text))
    set_if_missing("sim_count", _extract_sim_count(source_text))

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
    k = _normalize_raw_key(key)

    if any(x in k for x in ["color", "rang", "\u0446\u0432\u0435\u0442"]):
        return "color"
    if any(x in k for x in ["geoposition", "geolocation", "gps", "navigation", "\u043d\u0430\u0432\u0438\u0433\u0430\u0446"]):
        return "gps"
    if any(x in k for x in ["wi-fi", "wifi", "wi fi"]):
        return "wifi_standard"
    if "bluetooth" in k:
        return "bluetooth_standard"
    if any(x in k for x in ["operating system", "ios", "android", "\u043e\u043f\u0435\u0440\u0430\u0446\u0438\u043e\u043d"]):
        return "os"
    if any(x in k for x in ["cpu frequency", "processor frequency", "clock", "\u0447\u0430\u0441\u0442\u043e\u0442\u0430 \u043f\u0440\u043e\u0446\u0435\u0441\u0441"]):
        return "cpu_frequency_mhz"
    if any(x in k for x in ["refresh rate", "\u0447\u0430\u0441\u0442\u043e\u0442\u0430 \u0440\u0430\u0437\u0432\u0435\u0440\u0442", "hz"]):
        return "refresh_rate_hz"
    if any(x in k for x in ["resolution", "\u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d"]):
        return "screen_resolution"
    if any(x in k for x in ["network standard", "mobile network", "\u0441\u0442\u0430\u043d\u0434\u0430\u0440\u0442 \u0441\u0432\u044f\u0437\u0438", "lte", "5g", "4g"]):
        return "network_standard"
    if any(x in k for x in ["sim", "\u0441\u0438\u043c"]) and any(x in k for x in ["count", "number", "\u043a\u043e\u043b\u0438\u0447"]):
        return "sim_count"
    if any(x in k for x in ["charging connector", "connector", "usb", "lightning", "type c", "type-c", "\u0440\u0430\u0437\u044a\u0435\u043c", "\u0437\u0430\u0440\u044f\u0434\u043a"]):
        return "charging_connector"
    if any(x in k for x in ["dimensions", "size", _RU_SIZE, "\u0440\u0430\u0437\u043c\u0435\u0440"]):
        return "dimensions_mm"
    if any(x in k for x in ["weight", _RU_WEIGHT]):
        return "weight_g"
    if any(x in k for x in ["display matrix", "matrix type", "\u0442\u0438\u043f \u043c\u0430\u0442\u0440\u0438\u0446", "panel"]):
        return "display_matrix_type"
    if any(x in k for x in ["charging power", "\u043c\u043e\u0449\u043d\u043e\u0441\u0442\u044c \u0437\u0430\u0440\u044f\u0434", "power adapter"]):
        return "charging_power_w"
    if any(x in k for x in ["charging features", "fast charge", "wireless charge", "\u0444\u0443\u043d\u043a\u0446\u0438\u0438 \u0437\u0430\u0440\u044f\u0434"]):
        return "charging_features"
    if any(x in k for x in ["unlock", "face id", "fingerprint", "\u0440\u0430\u0437\u0431\u043b\u043e\u043a"]):
        return "unlock_type"
    if any(x in k for x in ["body material", "\u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u043a\u043e\u0440\u043f\u0443\u0441"]):
        return "body_material"
    if any(x in k for x in ["frame material", "\u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u0440\u0430\u043c\u043a"]):
        return "frame_material"
    if any(x in k for x in ["camera count", "\u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u043a\u0430\u043c\u0435\u0440"]):
        return "camera_count"
    if any(x in k for x in ["main camera features", "camera features", "\u0445\u0430\u0440\u0430\u043a\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043a\u0438 \u043e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u043a\u0430\u043c\u0435\u0440\u044b"]):
        return "camera_features"
    if any(x in k for x in ["main camera", "rear camera", "\u043e\u0441\u043d\u043e\u0432\u043d\u0430\u044f \u043a\u0430\u043c\u0435\u0440\u0430"]):
        return "main_camera_mp"
    if any(x in k for x in ["front camera", "selfie camera", "\u0444\u0440\u043e\u043d\u0442\u0430\u043b\u044c\u043d\u0430\u044f \u043a\u0430\u043c\u0435\u0440\u0430"]):
        return "front_camera_mp"

    if any(x in k for x in ["protsessor", "processor", "cpu", "chipset", "\u043f\u0440\u043e\u0446\u0435\u0441\u0441\u043e\u0440"]):
        return "cpu"
    if any(x in k for x in ["videokarta", "gpu", "graphics", "rtx", "gtx", "\u0432\u0438\u0434\u0435\u043e\u043a\u0430\u0440\u0442\u0430"]):
        return "gpu"
    if any(x in k for x in ["xotira", "ram", "\u043e\u043f\u0435\u0440\u0430\u0442\u0438\u0432", "\u043f\u0430\u043c\u044f\u0442\u044c"]):
        return "ram_gb"
    if any(x in k for x in ["ssd", "storage", "rom", "\u043d\u0430\u043a\u043e\u043f", "built in memory", "\u0432\u0441\u0442\u0440\u043e\u0435\u043d\u043d\u0430\u044f \u043f\u0430\u043c\u044f\u0442\u044c"]):
        return "storage_gb"
    if any(x in k for x in ["ekran", "display", "screen", "\u0434\u0438\u0441\u043f\u043b\u0435\u0439"]):
        return "display_inches"
    if any(x in k for x in ["kamera", "camera", "\u043a\u0430\u043c\u0435\u0440\u0430"]):
        return "camera_mp"
    if any(x in k for x in ["batareya", "battery", "\u0430\u043a\u043a\u0443\u043c"]):
        return "battery_mah"

    return None


def _extract_display_inches(title: str) -> str | None:
    m = re.search(r"(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:\"|''|inch|\u0434\u044e\u0439\u043c)", title, flags=re.IGNORECASE)
    if not m:
        return None
    return m.group(1).replace(",", ".")


def _extract_refresh_hz(title: str) -> str | None:
    m = re.search(r"(\d{2,3})\s*hz", title, flags=re.IGNORECASE)
    return m.group(1) if m else None


def _extract_memory(title: str) -> tuple[str | None, str | None, str | None]:
    gb_unit = rf"(?:gb|{_RU_GB})"

    m = re.search(rf"(\d{{1,3}})\s*\+\s*(\d{{1,3}})\s*/\s*(\d{{1,4}})\s*{gb_unit}", title, flags=re.IGNORECASE)
    if m:
        return m.group(1), m.group(2), m.group(3)

    m = re.search(rf"(\d{{1,3}})\s*/\s*(\d{{1,4}})\s*{gb_unit}", title, flags=re.IGNORECASE)
    if m:
        return m.group(1), None, m.group(2)

    m = re.search(rf"(\d{{1,3}})\s*{gb_unit}\s*\+\s*(\d{{1,4}})\s*{gb_unit}", title, flags=re.IGNORECASE)
    if m:
        return m.group(1), None, m.group(2)

    slash_pairs = re.findall(r"(\d{1,3})\s*/\s*(\d{2,4})", title, flags=re.IGNORECASE)
    if slash_pairs:
        return slash_pairs[0][0], None, slash_pairs[0][1]

    ram = None
    storage = None
    m_ram = re.search(rf"(\d{{1,3}})\s*{gb_unit}\s*(?:ddr\d|ram)", title, flags=re.IGNORECASE)
    if not m_ram:
        m_ram = re.search(rf"(?:ddr\d|ram)\s*(\d{{1,3}})\s*{gb_unit}", title, flags=re.IGNORECASE)
    if m_ram:
        ram = m_ram.group(1)

    m_ssd = re.search(rf"(\d{{2,4}})\s*{gb_unit}\s*(?:ssd|rom)", title, flags=re.IGNORECASE)
    if not m_ssd:
        m_ssd = re.search(rf"(?:ssd|rom)\s*(\d{{2,4}})\s*{gb_unit}", title, flags=re.IGNORECASE)
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
    for pattern in patterns:
        match = re.search(pattern, title, flags=re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def _extract_gpu(title: str) -> str | None:
    patterns = [
        r"(RTX\s*\d{3,4})",
        r"(GTX\s*\d{3,4})",
        r"(RX\s*\d{3,4}[A-Za-z]*)",
    ]
    for pattern in patterns:
        match = re.search(pattern, title, flags=re.IGNORECASE)
        if match:
            return match.group(1).upper()
    return None


def _extract_battery(title: str) -> str | None:
    m = re.search(r"(\d{3,5})\s*(?:mah|mAh|\u043c\u0430\u0447)", title, flags=re.IGNORECASE)
    return m.group(1) if m else None


def _extract_camera(title: str) -> str | None:
    m = re.search(r"(\d{2,3})\s*mp", title, flags=re.IGNORECASE)
    return m.group(1) if m else None


def _extract_cpu_frequency_mhz(title: str) -> str | None:
    ghz = re.search(r"(\d(?:[.,]\d{1,2})?)\s*ghz", title, flags=re.IGNORECASE)
    if ghz:
        value = float(ghz.group(1).replace(",", "."))
        return str(int(round(value * 1000)))
    mhz = re.search(r"(\d{3,4})\s*mhz", title, flags=re.IGNORECASE)
    if mhz:
        return mhz.group(1)
    return None


def _extract_charging_power_w(title: str) -> str | None:
    matches = re.findall(r"(\d{1,3})\s*(?:w|\u0432\u0442)\b", title, flags=re.IGNORECASE)
    if not matches:
        return None
    return str(max(int(match) for match in matches))


def _extract_sim_count(title: str) -> str | None:
    if re.search(r"\bdual\s*sim\b", title, flags=re.IGNORECASE):
        return "2"
    count_match = re.search(r"(\d)\s*sim", title, flags=re.IGNORECASE)
    if count_match:
        return count_match.group(1)
    return None
