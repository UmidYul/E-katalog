from __future__ import annotations

from app.core.config import settings
from app.parsers.example_store import ExampleStoreParser


class TexnomartParser(ExampleStoreParser):
    shop_name = "Texnomart UZ"
    shop_url = str(settings.texnomart_base_url)
