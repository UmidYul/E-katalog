from services.worker.app.platform.services.normalization import (
    _reset_normalization_rules_cache,
    build_canonical_title,
    detect_brand,
    get_normalization_rules,
    enrich_specs_from_title,
    normalize_specs,
    normalize_title,
)
from shared.config.settings import settings


def test_normalize_title_strips_noise_chars() -> None:
    assert normalize_title(" Apple   iPhone 17 Pro!!! ") == "apple iphone 17 pro"


def test_build_canonical_title_merges_memory_notation_for_iphone() -> None:
    a = "Apple iPhone 17 Pro Max 12/256GB Cosmic Orange"
    b = "apple iphone 17 pro max 256gb cosmic orange"
    c = "Apple iPhone 17 Pro Max 12256GB Cosmic Orange"
    assert build_canonical_title(a) == build_canonical_title(b) == build_canonical_title(c)


def test_build_canonical_title_ignores_color() -> None:
    blue = build_canonical_title("Apple iPhone 17 Pro 12/256GB Deep Blue")
    orange = build_canonical_title("Apple iPhone 17 Pro 12/256GB Cosmic Orange")
    assert blue == orange == "apple iphone17pro 256gb"


def test_enrich_specs_from_title_extracts_model_storage_color() -> None:
    specs = enrich_specs_from_title("Apple iPhone 17 Pro Max 12/256GB Deep Blue")
    assert specs["model"] == "iphone 17 pro max"
    assert specs["storage_gb"] == "256"
    assert specs["color"] == "deep blue"


def test_normalization_rules_config_override(tmp_path) -> None:
    rules_path = tmp_path / "rules.yaml"
    rules_path.write_text(
        """
brand_aliases:
  acme: ["acmephone"]
spec_key_aliases:
  "battery capacity": "battery_mah"
placeholder_spec_values:
  - "unknown"
  - "n/a"
""".strip(),
        encoding="utf-8",
    )

    old_enabled = settings.normalization_rules_enabled
    old_path = settings.normalization_rules_path
    old_reload = settings.normalization_rules_reload_seconds
    try:
        settings.normalization_rules_enabled = True
        settings.normalization_rules_path = str(rules_path)
        settings.normalization_rules_reload_seconds = 1
        _reset_normalization_rules_cache()
        loaded = get_normalization_rules(force_reload=True)
        assert "acme" in loaded["brand_aliases"]
        assert detect_brand("AcmePhone Ultra 12/256GB") == "acme"
        specs = normalize_specs({"battery capacity": "5000"})
        assert specs.get("battery_mah") == "5000"
    finally:
        settings.normalization_rules_enabled = old_enabled
        settings.normalization_rules_path = old_path
        settings.normalization_rules_reload_seconds = old_reload
        _reset_normalization_rules_cache()
