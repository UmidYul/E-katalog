from services.api.app.repositories.catalog import _build_gallery_images, _resolve_gallery_target_color


def test_gallery_selection_prefers_target_color_and_skips_conflict() -> None:
    images = _build_gallery_images(
        [
            {"url": "https://cdn.example.com/iphone_17_pro_max_deep_blue.webp", "source_priority": 0, "order": 0},
            {"url": "https://cdn.example.com/iphone_17_pro_max_white.webp", "source_priority": 0, "order": 1},
            {"url": "https://cdn.example.com/iphone_17_pro_max_front.webp", "source_priority": 1, "order": 2},
        ],
        target_color="Deep Blue",
        limit=10,
    )
    assert images
    assert images[0] == "https://cdn.example.com/iphone_17_pro_max_deep_blue.webp"
    assert "https://cdn.example.com/iphone_17_pro_max_white.webp" not in images


def test_gallery_selection_deprioritizes_moderation_poster() -> None:
    images = _build_gallery_images(
        [
            {"url": "https://s3.fortifai.uz/shop/moderation/partner-1/photo_2026-01-01.jpg", "source_priority": 0, "order": 0},
            {"url": "https://cdn.example.com/iphone_17_pro_max_back.webp", "source_priority": 1, "order": 1},
        ],
        target_color=None,
        limit=10,
    )
    assert images
    assert images[0] == "https://cdn.example.com/iphone_17_pro_max_back.webp"


def test_gallery_selection_skips_non_image_frame_entries() -> None:
    images = _build_gallery_images(
        [
            {"url": "https://s3.fortifai.uz/shop/moderation/partner-1/1761983477-Frame", "source_priority": 0, "order": 0},
            {"url": "https://s3.fortifai.uz/shop/moderation/partner-1/1761983477-Frame 155260694.jpg", "source_priority": 0, "order": 1},
            {"url": "https://s3.fortifai.uz/shop/moderation/partner-1/1761983477-d3a6a2l2lln52upubqb0.jpg", "source_priority": 0, "order": 1},
        ],
        target_color=None,
        limit=10,
    )
    assert images
    assert images[0].endswith(".jpg")
    assert all("Frame" not in image for image in images)


def test_gallery_selection_keeps_non_matching_color_when_no_match_exists() -> None:
    images = _build_gallery_images(
        [
            {"url": "https://cdn.example.com/iphone_17_pro_max_white.webp", "source_priority": 0, "order": 0},
            {"url": "https://cdn.example.com/iphone_17_pro_max_silver.webp", "source_priority": 0, "order": 1},
        ],
        target_color="Deep Blue",
        limit=10,
    )
    assert len(images) == 2


def test_resolve_gallery_target_color_drops_unreliable_preferred_color() -> None:
    target = _resolve_gallery_target_color(
        "Red",
        source_rows=[
            ("Deep Blue", "iphone 17 pro max deep blue"),
            ("Silver", "iphone 17 pro max silver"),
            ("Cosmic Orange", "iphone 17 pro max cosmic orange"),
            ("Deep Blue", "iphone 17 pro max deep blue"),
        ],
    )
    assert target is None


def test_resolve_gallery_target_color_switches_to_confident_majority() -> None:
    target = _resolve_gallery_target_color(
        "Red",
        source_rows=[
            ("Deep Blue", "iphone 17 pro max deep blue"),
            ("Deep Blue", "iphone 17 pro max deep blue"),
            ("Deep Blue", "iphone 17 pro max deep blue"),
            ("Silver", "iphone 17 pro max silver"),
        ],
    )
    assert target == "Deep Blue"
