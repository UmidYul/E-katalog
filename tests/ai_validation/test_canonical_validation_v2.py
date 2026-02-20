from app.platform.services.canonical_matching import CanonicalMatchingEngine, evaluate_predictions
from app.platform.services.synthetic_data import generate_synthetic_offers


def test_ai_validation_metrics() -> None:
    offers = generate_synthetic_offers()
    engine = CanonicalMatchingEngine()
    decisions = engine.process_batch(offers)

    metrics = evaluate_predictions(offers, decisions)

    assert metrics.precision >= 0.97
    assert metrics.recall >= 0.97
    assert metrics.false_merge_rate <= 0.03
    assert metrics.false_split_rate <= 0.03
    assert sum(metrics.confidence_distribution.values()) == len(offers)
