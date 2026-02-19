from __future__ import annotations

import asyncio

from sqlalchemy import text

from shared.db.session import AsyncSessionLocal


async def main(limit: int = 1000) -> None:
    async with AsyncSessionLocal() as session:
        await session.execute(
            text(
                """
                with target as (
                    select id
                    from catalog_store_products
                    where title_clean is null
                    order by id
                    limit :limit
                )
                update catalog_store_products sp
                set title_clean = lower(sp.title_raw)
                from target
                where sp.id = target.id
                """
            ),
            {"limit": limit},
        )
        await session.commit()


if __name__ == "__main__":
    asyncio.run(main())
