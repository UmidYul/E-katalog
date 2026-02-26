from services.worker.app.platform.services.canonical_matching import build_fuzzy_threshold_pr_curve
from services.worker.app.platform.services.synthetic_data import generate_synthetic_offers


def test_build_fuzzy_threshold_pr_curve_returns_recommendation() -> None:
    offers = generate_synthetic_offers(seed=7)[:80]
    report = build_fuzzy_threshold_pr_curve(offers, thresholds=[0.9, 0.93, 0.96])

    recommended = report.get("recommended_threshold")
    points = report.get("points")

    assert recommended in {0.9, 0.93, 0.96}
    assert isinstance(points, list)
    assert len(points) == 3
