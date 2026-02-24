from services.worker.app.tasks.normalize_tasks import _choose_preferred_image


def test_choose_preferred_image_avoids_moderation_poster() -> None:
    image = _choose_preferred_image(
        primary_image="https://s3.fortifai.uz/shop/moderation/partner-1/poster.jpg",
        metadata_images=["https://cdn.example.com/product/device_back.webp"],
        target_color=None,
    )
    assert image == "https://cdn.example.com/product/device_back.webp"


def test_choose_preferred_image_prefers_target_color() -> None:
    image = _choose_preferred_image(
        primary_image="https://cdn.example.com/iphone_17_pro_max_white.webp",
        metadata_images=[
            "https://cdn.example.com/iphone_17_pro_max_white.webp",
            "https://cdn.example.com/iphone_17_pro_max_cosmic_orange.webp",
        ],
        target_color="Cosmic Orange",
    )
    assert image == "https://cdn.example.com/iphone_17_pro_max_cosmic_orange.webp"


def test_choose_preferred_image_avoids_frame_without_extension() -> None:
    image = _choose_preferred_image(
        primary_image=None,
        metadata_images=[
            "https://s3.fortifai.uz/shop/moderation/partner-1344/1761983477-Frame",
            "https://s3.fortifai.uz/shop/moderation/partner-1344/1761983477-d3a6a2l2lln52upubqb0.jpg",
        ],
        target_color=None,
    )
    assert image == "https://s3.fortifai.uz/shop/moderation/partner-1344/1761983477-d3a6a2l2lln52upubqb0.jpg"
