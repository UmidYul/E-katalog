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


def test_canonical_key_from_marketplace_style_title() -> None:
    key = canonical_key(extract_attributes("Smartfon Apple iPhone 13 128GB (nanoSim+eSim), Midnight"))
    assert key == "apple|iphone13|128"


def test_canonical_key_samsung_s_series_ultra() -> None:
    key_a = canonical_key(extract_attributes("grand store buy samsung galaxy s25 ultra 12/256 gb titanium jetblack"))
    key_b = canonical_key(extract_attributes("smartphone samsung galaxy s25 ultra (12/256) titanium jetblack"))
    assert key_a == key_b == "samsung|s25ultra|256"


def test_canonical_key_samsung_note_series() -> None:
    key = canonical_key(extract_attributes("Samsung Galaxy Note 20 Ultra 12/256GB"))
    assert key == "samsung|note20ultra|256"


def test_canonical_key_samsung_fold_flip_series() -> None:
    fold_key = canonical_key(extract_attributes("Samsung Galaxy Z Fold6 12/512GB"))
    flip_key = canonical_key(extract_attributes("Samsung Galaxy Z Flip5 8/256GB"))
    assert fold_key == "samsung|zfold6|512"
    assert flip_key == "samsung|zflip5|256"


def test_canonical_key_samsung_a_m_tab_series() -> None:
    a_key = canonical_key(extract_attributes("Samsung Galaxy A55 8/256GB"))
    m_key = canonical_key(extract_attributes("Samsung Galaxy M35 8/256GB"))
    tab_key = canonical_key(extract_attributes("Samsung Galaxy Tab S9 Ultra 12/256GB"))
    assert a_key == "samsung|a55|256"
    assert m_key == "samsung|m35|256"
    assert tab_key == "samsung|tabs9ultra|256"


def test_canonical_key_samsung_handles_cyrillic_model_letter() -> None:
    key = canonical_key(extract_attributes("PLATINUM STORE - Купить Samsung Galaxy А56 5G 8/128 ГБ Awesome Lightgray"))
    assert key == "samsung|a56|128"


def test_canonical_key_samsung_handles_sm_internal_model_code() -> None:
    key = canonical_key(extract_attributes("Смартфон Samsung SM-А075F A07 (4/128) black"))
    assert key == "samsung|a07|128"


def test_candidate_blocking_reduces_scan_scope() -> None:
    engine = CanonicalMatchingEngine()
    for idx in range(20):
        engine.process_offer(OfferRecord(f"s{idx}", f"Samsung Galaxy A5{idx % 10} 8/256GB Black", "samsung"))
    engine.process_offer(OfferRecord("a1", "Apple iPhone 13 128GB Midnight", "apple"))
    total_canonicals = len(engine.canonicals)

    decision = engine.process_offer(OfferRecord("a2", "Apple iPhone 13 128GB Black", "apple"))
    assert decision.match_type == "exact"
    assert engine.last_candidate_count > 0
    assert engine.last_candidate_count < total_canonicals
