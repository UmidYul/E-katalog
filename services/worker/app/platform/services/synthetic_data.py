from __future__ import annotations

import random

from app.platform.services.canonical_matching import OfferRecord


IPHONE_PATTERNS = [
    "Apple iPhone 13 128GB Midnight",
    "Iphone13 128 gb black",
    "Apple IPHONE13 128 Midnight",
    "iPhone 13 (128Gb) - Black",
    "Apple 13 128GB",
    "Apple iPhone13 128GB Midnight",
    "APPLE iPhone 13 128 gb midnight",
    "iphone13 128gb midnight",
    "Apple iPhone 13 128 Gb Midnight",
    "Smartphone Apple iPhone 13 128GB Midnight",
]

SAMSUNG_PATTERNS = [
    "Samsung Galaxy A54 256GB Awesome Graphite",
    "Samsung A54 256 gb black",
    "Galaxy A54 256GB",
    "SAMSUNG GALAXY A54 (256Gb)",
    "Samsung A54 256GB graphite",
    "Smartphone Samsung Galaxy A54 256GB",
    "Samsung Galaxy A54 256 Gb",
    "GalaxyA54 256gb black",
    "Samsung A54 (256GB)",
    "Samsung Galaxy A54 8/256GB Black",
]

EDGE_PATTERNS = {
    "apple|iphone13|256": [
        "Apple iPhone 13 256GB Midnight",
        "iphone13 256 gb black",
        "Apple IPHONE 13 (256Gb)",
        "iPhone 13 256GB",
        "Apple 13 256GB",
    ],
    "apple|iphone13pro|128": [
        "Apple iPhone 13 Pro 128GB Graphite",
        "iphone13 pro 128 gb",
        "Apple IPHONE13PRO 128GB",
        "iPhone 13 Pro (128Gb)",
        "Apple 13 Pro 128GB",
    ],
    "apple|iphone12|128": [
        "Apple iPhone 12 128GB Black",
        "iphone12 128 gb",
        "Apple IPHONE12 128GB",
        "iPhone 12 (128Gb)",
        "Apple 12 128GB",
    ],
    "samsung|a54|128": [
        "Samsung Galaxy A54 128GB Black",
        "Samsung A54 128 gb",
        "Galaxy A54 128GB",
        "SAMSUNG A54 (128Gb)",
        "Samsung A54 8/128GB",
    ],
}


def _records_from_patterns(prefix: str, patterns: list[str], expected: str, count: int, rnd: random.Random) -> list[OfferRecord]:
    items: list[OfferRecord] = []
    for idx in range(count):
        title = patterns[idx % len(patterns)]
        if idx % 7 == 0:
            title = f"{title} !!!"
        if idx % 9 == 0:
            title = title.replace("  ", " ")
        if idx % 11 == 0:
            title = title.replace("GB", " Gb")
        if idx % 13 == 0:
            title = title.replace("A54", "A 54")
        if idx % 17 == 0:
            title = title.replace("iPhone", "IPhone")
        items.append(OfferRecord(offer_id=f"{prefix}_{idx:04d}", title=title, expected_canonical_id=expected))
    rnd.shuffle(items)
    return items


def generate_synthetic_offers(seed: int = 42) -> list[OfferRecord]:
    rnd = random.Random(seed)
    dataset: list[OfferRecord] = []
    dataset.extend(_records_from_patterns("ip13_128", IPHONE_PATTERNS, "apple|iphone13|128", 100, rnd))
    dataset.extend(_records_from_patterns("a54_256", SAMSUNG_PATTERNS, "samsung|a54|256", 100, rnd))
    for expected, patterns in EDGE_PATTERNS.items():
        dataset.extend(_records_from_patterns(expected.replace("|", "_"), patterns, expected, 5, rnd))
    rnd.shuffle(dataset)
    return dataset


def generate_scaled_offers(size: int, seed: int = 42) -> list[OfferRecord]:
    base = generate_synthetic_offers(seed=seed)
    if size <= len(base):
        return base[:size]

    rnd = random.Random(seed)
    expanded: list[OfferRecord] = []
    for idx in range(size):
        src = base[idx % len(base)]
        title = src.title
        if idx % 19 == 0:
            title = f"{title} new"
        expanded.append(
            OfferRecord(
                offer_id=f"scaled_{idx:06d}",
                title=title,
                expected_canonical_id=src.expected_canonical_id,
            )
        )
    rnd.shuffle(expanded)
    return expanded
