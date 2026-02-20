from __future__ import annotations

import random
from collections import defaultdict

from app.platform.services.canonical_matching import (
    CanonicalMatchingEngine,
    MatchDecision,
    OfferRecord,
    evaluate_predictions,
    extract_attributes,
)


NOISE_WORDS = (
    "guarantee",
    "delivery",
    "promo",
    "discount",
    "trade-in",
    "sale",
)


def _stylize_token(token: str, rnd: random.Random) -> str:
    mode = rnd.choice(("lower", "upper", "title"))
    if mode == "upper":
        return token.upper()
    if mode == "title":
        return token.title()
    return token.lower()


def _perturb_title(base_title: str, rnd: random.Random) -> str:
    title = base_title
    if rnd.random() < 0.25:
        title = title.replace("iPhone", "iphon")
    if rnd.random() < 0.2:
        title = title.replace("Apple", "Aple")
    if rnd.random() < 0.3:
        title = title.replace("GB", "Gb")
    if rnd.random() < 0.2:
        title = title.replace("Gb", "\u0433\u0431")

    tokens = title.split()
    if rnd.random() < 0.55:
        rnd.shuffle(tokens)
    tokens = [_stylize_token(token, rnd) for token in tokens]
    separator = rnd.choice((" ", "  ", " - ", "-"))
    result = separator.join(tokens)
    if rnd.random() < 0.7:
        result = f"{result} {rnd.choice(NOISE_WORDS)}"
    return result


def _build_group(
    *,
    offer_prefix: str,
    expected_canonical_id: str,
    base_titles: list[str],
    count: int,
    rnd: random.Random,
) -> list[OfferRecord]:
    rows: list[OfferRecord] = []
    for idx in range(count):
        base = base_titles[idx % len(base_titles)]
        title = base if idx < len(base_titles) else _perturb_title(base, rnd)
        rows.append(
            OfferRecord(
                offer_id=f"{offer_prefix}_{idx:04d}",
                title=title,
                expected_canonical_id=expected_canonical_id,
            )
        )
    return rows


def _stress_dataset(seed: int = 11) -> list[OfferRecord]:
    rnd = random.Random(seed)
    groups = (
        (
            "g_pro128",
            "apple|iphone15pro|128",
            [
                "Apple iPhone 15 Pro 128GB Blue",
                "iPhone 15 Pro 128 gb (blue)",
                "IPHONE15PRO 128",
                "Apple 15 Pro 128GB",
                "iPhone 15Pro 128 GB",
                "iphone 15 pro 128gb blue titanium",
                "\u0410\u0439\u0444\u043e\u043d 15 \u043f\u0440\u043e 128\u0433\u0431 \u0441\u0438\u043d\u0438\u0439",
                "\u042d\u043f\u043f\u043b \u0430\u0439\u0444\u043e\u043d 15 \u043f\u0440\u043e 128 \u0433\u0431",
            ],
            44,
        ),
        (
            "g_pro256",
            "apple|iphone15pro|256",
            [
                "Apple iPhone 15 Pro 256GB Blue",
                "iPhone15 Pro 256 gb blue",
                "APPLE IPHONE 15 PRO 256GB",
                "\u0410\u0439\u0444\u043e\u043d 15 \u043f\u0440\u043e 256\u0433\u0431",
            ],
            18,
        ),
        (
            "g_base128",
            "apple|iphone15|128",
            [
                "Apple iPhone 15 128GB Blue",
                "iPhone 15 128 gb",
                "APPLE IPHONE15 128GB",
                "\u0410\u0439\u0444\u043e\u043d 15 128\u0433\u0431",
            ],
            12,
        ),
        (
            "g_plus128",
            "apple|iphone15plus|128",
            [
                "Apple iPhone 15 Plus 128GB Blue",
                "iPhone15 Plus 128 gb blue",
                "APPLE IPHONE 15 PLUS 128GB",
                "\u0410\u0439\u0444\u043e\u043d 15 \u043f\u043b\u044e\u0441 128\u0433\u0431",
            ],
            12,
        ),
        (
            "g_promax128",
            "apple|iphone15promax|128",
            [
                "Apple iPhone 15 Pro Max 128GB Blue",
                "iPhone15 ProMax 128 gb",
                "APPLE IPHONE 15 PRO MAX 128GB",
                "\u0410\u0439\u0444\u043e\u043d 15 \u043f\u0440\u043e \u043c\u0430\u043a\u0441 128\u0433\u0431",
            ],
            12,
        ),
        (
            "g_pro_unknown",
            "apple|iphone15pro|unknown",
            [
                "Apple iPhone 15 Pro Blue",
                "iPhone15 Pro blue delivery",
                "\u0410\u0439\u0444\u043e\u043d 15 \u043f\u0440\u043e \u0441\u0438\u043d\u0438\u0439",
                "Apple 15 Pro guarantee",
            ],
            10,
        ),
    )

    rows: list[OfferRecord] = []
    for offer_prefix, expected, base_titles, count in groups:
        rows.extend(
            _build_group(
                offer_prefix=offer_prefix,
                expected_canonical_id=expected,
                base_titles=base_titles,
                count=count,
                rnd=rnd,
            )
        )
    rnd.shuffle(rows)
    return rows


def _collect_invariant_violations(offers: list[OfferRecord], decisions: list[MatchDecision], engine: CanonicalMatchingEngine) -> list[str]:
    cluster_to_offers: dict[str, list[OfferRecord]] = defaultdict(list)
    expected_to_clusters: dict[str, set[str]] = defaultdict(set)
    for offer, decision in zip(offers, decisions, strict=True):
        cluster_to_offers[decision.canonical_id].append(offer)
        expected_to_clusters[offer.expected_canonical_id].add(decision.canonical_id)

    violations: list[str] = []

    for canonical_id, cluster in cluster_to_offers.items():
        attrs = [extract_attributes(item.title) for item in cluster]
        models = {item.model for item in attrs if item.model != "unknown"}
        storages = {item.storage for item in attrs if item.storage != "unknown"}
        variants = {item.variant for item in attrs if item.variant != "unknown"}

        if len(storages) > 1:
            violations.append(f"{canonical_id}: mixed storages {sorted(storages)}")
        if "128" in storages and "256" in storages:
            violations.append(f"{canonical_id}: contains 128GB and 256GB")
        if len(models) > 1:
            violations.append(f"{canonical_id}: mixed models {sorted(models)}")
        if "pro" in variants and "promax" in variants:
            violations.append(f"{canonical_id}: pro and promax mixed")

        canonical = engine.canonicals.get(canonical_id)
        if canonical is None:
            violations.append(f"{canonical_id}: canonical object missing")
        else:
            expected_offer_ids = sorted(item.offer_id for item in cluster)
            actual_offer_ids = sorted(canonical.source_offers)
            if expected_offer_ids != actual_offer_ids:
                violations.append(f"{canonical_id}: source_offers mismatch")

    for expected_id, clusters in expected_to_clusters.items():
        if len(clusters) > 1:
            violations.append(f"{expected_id}: split into {len(clusters)} canonicals")

    return violations


def test_canonicalization_stress_suite() -> None:
    offers = _stress_dataset()
    assert len(offers) >= 100

    engine = CanonicalMatchingEngine()
    decisions = [
        engine.canonicalize(
            offer_id=offer.offer_id,
            title=offer.title,
            expected_canonical_id=offer.expected_canonical_id,
        )
        for offer in offers
    ]

    violations = _collect_invariant_violations(offers, decisions, engine)
    metrics = evaluate_predictions(offers, decisions)

    total_items = len(offers)
    canonical_count = len({item.canonical_id for item in decisions})
    avg_offers_per_canonical = total_items / max(canonical_count, 1)
    grouping_errors = len(violations)

    assert not violations, f"invariant violations: {violations}"
    assert grouping_errors == 0
    assert metrics.precision >= 0.97
    assert metrics.recall >= 0.97
    assert total_items >= 100
    assert canonical_count >= 4
    assert avg_offers_per_canonical > 1


def test_randomized_variations_do_not_break_canonicalization() -> None:
    rnd = random.Random(77)
    base_titles = (
        ("apple|iphone15|128", "Apple iPhone 15 128GB Blue"),
        ("apple|iphone15plus|128", "Apple iPhone 15 Plus 128GB Blue"),
        ("apple|iphone15pro|128", "Apple iPhone 15 Pro 128GB Blue"),
        ("apple|iphone15promax|128", "Apple iPhone 15 Pro Max 128GB Blue"),
    )

    for expected_id, base_title in base_titles:
        engine = CanonicalMatchingEngine()
        anchor = engine.canonicalize(offer_id=f"anchor_{expected_id}", title=base_title, expected_canonical_id=expected_id)
        hits = 0
        total = 40
        for idx in range(total):
            variant = _perturb_title(base_title, rnd)
            decision = engine.canonicalize(
                offer_id=f"{expected_id}_{idx:04d}",
                title=variant,
                expected_canonical_id=expected_id,
            )
            if decision.canonical_id == anchor.canonical_id:
                hits += 1
        assert hits / total >= 0.95


def test_cross_brand_offers_do_not_merge() -> None:
    rnd = random.Random(101)
    offers: list[OfferRecord] = []
    apple = [
        "Apple iPhone 15 Pro 128GB Blue",
        "iPhone15 Pro 128 gb",
        "Айфон 15 про 128гб",
    ]
    samsung = [
        "Samsung Galaxy A54 128GB Blue",
        "Samsung A54 128 gb",
        "Самсунг A54 128гб",
    ]
    for idx in range(30):
        offers.append(
            OfferRecord(
                offer_id=f"apple_{idx:03d}",
                title=_perturb_title(apple[idx % len(apple)], rnd),
                expected_canonical_id="apple|iphone15pro|128",
            )
        )
        offers.append(
            OfferRecord(
                offer_id=f"samsung_{idx:03d}",
                title=_perturb_title(samsung[idx % len(samsung)], rnd),
                expected_canonical_id="samsung|a54|128",
            )
        )

    engine = CanonicalMatchingEngine()
    decisions = [engine.canonicalize(offer_id=item.offer_id, title=item.title, expected_canonical_id=item.expected_canonical_id) for item in offers]

    cluster_brands: dict[str, set[str]] = defaultdict(set)
    for offer, decision in zip(offers, decisions, strict=True):
        attrs = extract_attributes(offer.title)
        cluster_brands[decision.canonical_id].add(attrs.brand)

    for brands in cluster_brands.values():
        assert brands in ({"apple"}, {"samsung"}, {"unknown"})

    apple_clusters = {decision.canonical_id for offer, decision in zip(offers, decisions, strict=True) if offer.expected_canonical_id == "apple|iphone15pro|128"}
    samsung_clusters = {decision.canonical_id for offer, decision in zip(offers, decisions, strict=True) if offer.expected_canonical_id == "samsung|a54|128"}
    assert apple_clusters.isdisjoint(samsung_clusters)


def test_ambiguous_storage_event_is_flagged_for_review() -> None:
    offers = [
        OfferRecord("s1", "Apple iPhone 15 Pro 128GB Blue", "apple|iphone15pro|128"),
        OfferRecord("s2", "Apple iPhone 15 Pro 256GB Blue", "apple|iphone15pro|256"),
        OfferRecord("s3", "Apple iPhone 15 Pro Blue", "apple|iphone15pro|unknown"),
    ]
    engine = CanonicalMatchingEngine()
    decisions = [engine.canonicalize(offer_id=item.offer_id, title=item.title, expected_canonical_id=item.expected_canonical_id) for item in offers]
    last_decision = decisions[-1]
    last_event = engine.audit_log[-1]

    assert last_decision.requires_review is True
    assert "ambiguous_storage" in last_event.flags
