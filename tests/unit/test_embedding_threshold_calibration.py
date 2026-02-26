from services.worker.app.platform.services.canonical_matching import calibrate_embedding_thresholds_by_brand
from services.worker.app.platform.services.synthetic_data import generate_synthetic_offers


def test_calibrate_embedding_thresholds_by_brand_returns_brand_recommendations() -> None:
    offers = generate_synthetic_offers(seed=11)
    report = calibrate_embedding_thresholds_by_brand(
        offers,
        high_thresholds=[0.9, 0.93],
        low_gap=0.04,
        min_samples_per_brand=10,
    )

    brands = report.get("brands")
    assert isinstance(brands, dict)
    assert "apple" in brands
    assert "samsung" in brands
