from services.worker.app.platform.services.canonical_matching import CanonicalMatchingEngine
from services.worker.app.platform.services.synthetic_data import generate_synthetic_offers


def test_full_pipeline_creates_1_canonical_for_iphone13() -> None:
    offers = [item for item in generate_synthetic_offers() if item.expected_canonical_id == "apple|iphone13|128"]
    engine = CanonicalMatchingEngine()
    decisions = engine.process_batch(offers)

    unique_canonicals = {decision.canonical_id for decision in decisions}
    assert len(unique_canonicals) == 1


def test_pipeline_does_not_merge_iphone13_and_iphone12() -> None:
    offers = [
        item
        for item in generate_synthetic_offers()
        if item.expected_canonical_id in {"apple|iphone13|128", "apple|iphone12|128"}
    ]
    engine = CanonicalMatchingEngine()
    decisions = engine.process_batch(offers)

    clusters: dict[str, set[str]] = {}
    for offer, decision in zip(offers, decisions, strict=True):
        clusters.setdefault(offer.expected_canonical_id, set()).add(decision.canonical_id)

    assert len(clusters["apple|iphone13|128"]) == 1
    assert len(clusters["apple|iphone12|128"]) == 1
    assert clusters["apple|iphone13|128"] != clusters["apple|iphone12|128"]


def test_repeated_import_is_idempotent() -> None:
    offers = generate_synthetic_offers()
    engine = CanonicalMatchingEngine()

    first = engine.process_batch(offers)
    canonical_count_after_first = len(engine.canonicals)

    second = engine.process_batch(offers)
    canonical_count_after_second = len(engine.canonicals)

    assert canonical_count_after_first == canonical_count_after_second
    assert len({row.canonical_id for row in first}) == len({row.canonical_id for row in second})
