from __future__ import annotations

from app.core.config import settings
from app.parsers.example_store import ExampleStoreParser
from app.utils.variants import extract_variants_from_network_payloads


class TexnomartParser(ExampleStoreParser):
    shop_name = "Texnomart UZ"
    shop_url = str(settings.texnomart_base_url)

    def _extract_store_specific_variants(
        self,
        *,
        network_payloads: list[str],
        price,
        old_price,
        availability,
        images,
        specs,
        product_url: str,
    ) -> list:
        return extract_variants_from_network_payloads(
            network_payloads,
            default_price=price,
            default_old_price=old_price,
            default_availability=availability,
            default_images=images,
            default_specs=specs,
            product_url=product_url,
            store_hint="texnomart",
            max_variants=30,
        )
