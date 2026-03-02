from services.worker.app.platform.services.canonical_matching import (
    CanonicalMatchingEngine,
    build_fuzzy_threshold_pr_curve,
    cluster_offer_titles_graph,
    summarize_canonical_decisions,
)
from services.worker.app.platform.services.synthetic_data import generate_synthetic_offers


def test_build_fuzzy_threshold_pr_curve_includes_pr_auc() -> None:
    offers = generate_synthetic_offers(seed=17)[:80]
    report = build_fuzzy_threshold_pr_curve(offers, thresholds=[0.9, 0.93, 0.96])

    assert "pr_auc" in report
    assert 0.0 <= float(report["pr_auc"]) <= 1.0


def test_cluster_offer_titles_graph_builds_components() -> None:
    offers = generate_synthetic_offers(seed=5)[:40]
    result = cluster_offer_titles_graph(offers, fuzzy_threshold=0.93, embedding_threshold=0.9)

    assert result["node_count"] == len(offers)
    assert isinstance(result["clusters"], list)
    assert result["backend"] in {"networkx", "union_find"}
    assert len(result["clusters"]) >= 2


def test_summarize_canonical_decisions_counts_rows() -> None:
    offers = generate_synthetic_offers(seed=11)[:60]
    engine = CanonicalMatchingEngine()
    decisions = engine.process_batch(offers)
    summary = summarize_canonical_decisions(offers, decisions)

    assert summary["rows"] == len(offers)
    assert summary["backend"] in {"pandas", "python"}
    assert isinstance(summary["match_type_counts"], dict)
    assert "new" in summary["match_type_counts"] or "exact" in summary["match_type_counts"]
