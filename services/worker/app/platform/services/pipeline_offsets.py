from __future__ import annotations

from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def ensure_offsets_table(session: AsyncSession) -> None:
    await session.execute(
        text(
            """
            create table if not exists catalog_pipeline_offsets (
              job_name text primary key,
              last_ts timestamptz,
              last_id bigint not null default 0,
              updated_at timestamptz not null default now()
            )
            """
        )
    )


async def get_offset(session: AsyncSession, job_name: str) -> tuple[datetime | None, int]:
    row = (
        await session.execute(
            text(
                """
                select last_ts, coalesce(last_id, 0) as last_id
                from catalog_pipeline_offsets
                where job_name = :job_name
                """
            ),
            {"job_name": job_name},
        )
    ).mappings().first()
    if not row:
        return None, 0
    return row["last_ts"], int(row["last_id"] or 0)


async def set_offset(session: AsyncSession, job_name: str, *, last_ts: datetime | None, last_id: int = 0) -> None:
    await session.execute(
        text(
            """
            insert into catalog_pipeline_offsets (job_name, last_ts, last_id, updated_at)
            values (:job_name, :last_ts, :last_id, now())
            on conflict (job_name) do update
            set last_ts = excluded.last_ts,
                last_id = excluded.last_id,
                updated_at = now()
            """
        ),
        {"job_name": job_name, "last_ts": last_ts, "last_id": int(last_id)},
    )
