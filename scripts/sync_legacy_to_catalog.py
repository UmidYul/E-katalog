from __future__ import annotations

import asyncio

from shared.db.session import AsyncSessionLocal
from services.scraper.app.pipelines.catalog_sync import sync_legacy_to_catalog


async def main() -> None:
    async with AsyncSessionLocal() as session:
        await sync_legacy_to_catalog(session)
    print("legacy -> catalog sync completed")


if __name__ == "__main__":
    asyncio.run(main())
