from app.platform.services.canonical_matching import (
    CanonicalMatchingEngine,
    OfferRecord,
    canonical_key,
    extract_attributes,
)


def test_extractor_parses_storage_correctly() -> None:
    attrs = extract_attributes("Apple iPhone 13 (128Gb) - Black")
    assert attrs.storage == "128"


def test_canonical_key_consistency() -> None:
    a = canonical_key(extract_attributes("Apple iPhone 13 128GB Midnight"))
    b = canonical_key(extract_attributes("Iphone13 128 gb black"))
    c = canonical_key(extract_attributes("Apple 13 128GB"))
    assert a == b == c == "apple|iphone13|128"


def test_exact_match() -> None:
    engine = CanonicalMatchingEngine()
    first = OfferRecord("o1", "Apple iPhone 13 128GB Midnight", "apple|iphone13|128")
    second = OfferRecord("o2", "Iphone13 128 gb black", "apple|iphone13|128")

    first_decision = engine.process_offer(first)
    second_decision = engine.process_offer(second)

    assert first_decision.canonical_id == second_decision.canonical_id
    assert second_decision.match_type == "exact"
    assert second_decision.confidence_score == 1.0


def test_no_color_affects_canonical() -> None:
    key_black = canonical_key(extract_attributes("Apple iPhone 13 128GB Black"))
    key_midnight = canonical_key(extract_attributes("Apple iPhone 13 128GB Midnight"))
    assert key_black == key_midnight == "apple|iphone13|128"


def test_canonical_key_from_alifshop_style_title() -> None:
    key = canonical_key(extract_attributes("Смартфон Apple iPhone 13 128 ГБ (nanoSim+eSim), Midnight"))
    assert key == "apple|iphone13|128"
