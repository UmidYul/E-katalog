from services.worker.app.platform.services.normalization import build_canonical_title


def test_pipeline_groups_same_device_across_store_titles() -> None:
    raw_titles = [
        "Apple iPhone 17 Pro Max 12/256GB Cosmic Orange",
        "apple iphone 17 pro max 256gb cosmic orange",
        "Apple iPhone 17 Pro Max 12256GB Cosmic Orange",
    ]
    canonical_titles = {build_canonical_title(t) for t in raw_titles}
    assert len(canonical_titles) == 1


def test_pipeline_merges_different_color_variants() -> None:
    raw_titles = [
        "Apple iPhone 17 Pro Max 12/256GB Cosmic Orange",
        "Apple iPhone 17 Pro Max 12/256GB Deep Blue",
    ]
    canonical_titles = {build_canonical_title(t) for t in raw_titles}
    assert len(canonical_titles) == 1


def test_offer_upsert_identity_is_stable_by_store_and_url() -> None:
    # Emulates idempotent upsert key in legacy scraper layer: (shop_id, link).
    offers: dict[tuple[int, str], dict] = {}
    key = (1, "https://shop.example/p/iphone-17-pro-max-256gb-cosmic-orange")
    offers[key] = {"price": 20880000}
    offers[key] = {"price": 20500000}
    assert len(offers) == 1
    assert offers[key]["price"] == 20500000
