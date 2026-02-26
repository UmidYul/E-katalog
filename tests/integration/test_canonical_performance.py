from services.worker.app.platform.services.canonical_matching import benchmark_engine
from services.worker.app.platform.services.synthetic_data import generate_scaled_offers


def test_performance_1000_offers() -> None:
    metrics = benchmark_engine(generate_scaled_offers(1000))
    assert metrics["offers"] == 1000.0
    assert metrics["processing_time_sec"] > 0
    assert metrics["peak_memory_mb"] > 0


def test_performance_10k_offers() -> None:
    metrics = benchmark_engine(generate_scaled_offers(10_000))
    assert metrics["offers"] == 10000.0
    assert metrics["processing_time_sec"] > 0
    assert metrics["peak_memory_mb"] > 0
