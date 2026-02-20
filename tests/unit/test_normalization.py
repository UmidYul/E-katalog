from services.worker.app.platform.services.normalization import (
    build_canonical_title,
    enrich_specs_from_title,
    normalize_title,
)


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
