from types import SimpleNamespace

from services.worker.app.platform.services.dedupe import _pair_score, _spec_overlap_score, _structural_key


def _product(title: str, specs: dict, embedding: list[float] | None = None):
    return SimpleNamespace(
        normalized_title=title,
        specs=specs,
        embedding=embedding,
    )


def test_spec_overlap_score_handles_partial_overlap() -> None:
    a = {"color": "deep blue", "storage_gb": "256", "model": "iphone 17 pro"}
    b = {"color": "deep blue", "storage_gb": "512", "model": "iphone 17 pro"}
    score = _spec_overlap_score(a, b)
    assert 0 < score < 1


def test_pair_score_prefers_exact_title_and_specs() -> None:
    left = _product("apple iphone 17 pro 256gb deep blue", {"color": "deep blue", "storage_gb": "256"}, [0.1, 0.2, 0.3])
    right = _product("apple iphone 17 pro 256gb deep blue", {"color": "deep blue", "storage_gb": "256"}, [0.1, 0.2, 0.3])
    score, reason = _pair_score(left, right)
    assert score >= 0.95
    assert reason in {"same_normalized_title_and_specs", "title_specs_embedding"}


def test_structural_key_falls_back_without_color() -> None:
    product = SimpleNamespace(
        normalized_title="xiaomi redmi note 13 pro 512gb",
        specs={"storage_gb": "512"},
        brand_id=None,
    )
    key = _structural_key(product)
    assert key == "xiaomi|note13pro|512"
