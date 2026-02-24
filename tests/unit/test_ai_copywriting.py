from services.worker.app.platform.services.ai_copywriting import (
    _COPY_MODE_CURRENT,
    _COPY_MODE_PREVIOUS,
    _merge_copy_specs,
    build_copy_source_hash,
    build_fallback_copy,
    normalize_copy_payload,
    parse_copywriting_response,
)


def test_parse_copywriting_response_accepts_valid_json() -> None:
    payload = parse_copywriting_response(
        '{"short_description":"text","whats_new":["one","two"],"mode":"current_improvements","compare_confidence":0.5}'
    )
    assert payload is not None
    assert payload["short_description"] == "text"
    assert payload["mode"] == _COPY_MODE_CURRENT


def test_low_confidence_previous_mode_switches_to_current_improvements() -> None:
    result = normalize_copy_payload(
        {
            "short_description": "Описание модели.",
            "whats_new": ["Новый пункт 1", "Новый пункт 2"],
            "mode": _COPY_MODE_PREVIOUS,
            "compare_confidence": 0.25,
        },
        fallback_short_description="Fallback description",
        fallback_whats_new=["Fallback 1", "Fallback 2"],
        min_compare_confidence=0.70,
    )
    assert result["mode"] == _COPY_MODE_CURRENT
    assert result["compare_confidence"] == 0.0
    assert result["whats_new"] == ["Fallback 1", "Fallback 2"]


def test_build_fallback_copy_produces_non_empty_fields() -> None:
    short_description, whats_new = build_fallback_copy(
        title="Apple iPhone 17 Pro 256GB",
        category_name="Смартфоны",
        brand_name="Apple",
        specs={"processor": "A19 Pro", "storage_gb": "256", "battery_mah": "4500"},
    )
    assert short_description
    assert len(whats_new) >= 2


def test_copy_source_hash_is_stable_for_same_content() -> None:
    first = {
        "title": "iphone",
        "brand": "apple",
        "specs": {"storage_gb": "256", "processor": "A19"},
        "description_samples": ["a", "b"],
    }
    second = {
        "description_samples": ["a", "b"],
        "specs": {"processor": "A19", "storage_gb": "256"},
        "brand": "apple",
        "title": "iphone",
    }
    assert build_copy_source_hash(first) == build_copy_source_hash(second)


def test_merge_copy_specs_prefers_non_zero_ram_value() -> None:
    merged = _merge_copy_specs(
        {"storage_gb": "256", "ram_gb": "0"},
        {"ram_gb": "12 \u0413\u0411", "storage_gb": "256"},
    )
    assert merged.get("ram_gb") == "12 \u0413\u0411"
    assert merged.get("storage_gb") == "256"


def test_build_fallback_copy_skips_zero_ram_in_text() -> None:
    short_description, whats_new = build_fallback_copy(
        title="Apple iPhone 17 Pro Max 256GB",
        category_name="\u0421\u043c\u0430\u0440\u0442\u0444\u043e\u043d\u044b",
        brand_name="Apple",
        specs={"storage_gb": "256", "ram_gb": "0"},
    )
    combined = f"{short_description} {' '.join(whats_new)}"
    assert "ram_gb: 0" not in combined
    assert "\u041e\u043f\u0435\u0440\u0430\u0442\u0438\u0432\u043d\u0430\u044f \u043f\u0430\u043c\u044f\u0442\u044c: 0" not in combined
