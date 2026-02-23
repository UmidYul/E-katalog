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


def test_pipeline_groups_samsung_s25_ultra_with_store_noise() -> None:
    raw_titles = [
        "grand store - купить samsung galaxy s25 ultra 12/256 гб titanium jetblack",
        "смартфон samsung galaxy s25 ultra (12/256) titanium jetblack",
        "Samsung Galaxy S25 Ultra 12/256GB Titanium JetBlack",
    ]
    canonical_titles = {build_canonical_title(t) for t in raw_titles}
    assert canonical_titles == {"samsung s25ultra 256gb"}


def test_offer_upsert_identity_is_stable_by_store_and_url() -> None:
    # Emulates idempotent upsert key in legacy scraper layer: (shop_id, link).
    offers: dict[tuple[int, str], dict] = {}
    key = (1, "https://shop.example/p/iphone-17-pro-max-256gb-cosmic-orange")
    offers[key] = {"price": 20880000}
    offers[key] = {"price": 20500000}
    assert len(offers) == 1
    assert offers[key]["price"] == 20500000


def test_pipeline_groups_samsung_a_series_with_cyrillic_model_letter() -> None:
    raw_titles = [
        "PLATINUM STORE - Купить Samsung Galaxy А56 5G 8/128 ГБ Awesome Lightgray",
        "Samsung Galaxy A56 8/128GB Awesome Lightgray",
    ]
    canonical_titles = {build_canonical_title(t) for t in raw_titles}
    assert canonical_titles == {"samsung a56 128gb"}
