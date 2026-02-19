import asyncio

from sqlalchemy import text

from app.core.logging import configure_logging, logger
from app.db.base import Base
from app.db.models import *  # noqa: F401,F403
from app.db.session import engine


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))
        await conn.run_sync(Base.metadata.create_all)
    logger.info("database_initialized")


if __name__ == "__main__":
    configure_logging()
    asyncio.run(init_db())
