from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import text

from shared.config.settings import settings
from shared.db.session import AsyncSessionLocal


def _parse_iso(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _parse_hash_list(value: Any) -> list[str]:
    raw = str(value or "").strip()
    if not raw:
        return []
    return [item for item in raw.split(",") if item]


def _parse_json(value: Any, fallback: dict | list) -> dict | list:
    raw = str(value or "").strip()
    if not raw:
        return fallback
    try:
        decoded = json.loads(raw)
        if isinstance(decoded, type(fallback)):
            return decoded
    except json.JSONDecodeError:
        pass
    return fallback


@dataclass
class BackfillStats:
    users_total: int = 0
    users_upserted: int = 0
    sessions_total: int = 0
    sessions_upserted: int = 0
    session_tokens_total: int = 0
    session_tokens_upserted: int = 0
    oauth_links_total: int = 0
    oauth_links_upserted: int = 0


async def _upsert_user(session, payload: dict[str, str]) -> int:
    full_name = str(payload.get("full_name") or "").strip()
    display_name = str(payload.get("display_name") or "").strip() or full_name
    notification_preferences = _parse_json(payload.get("notification_preferences"), {})
    row = (
        await session.execute(
            text(
                """
                insert into auth_users (
                    uuid,
                    email,
                    full_name,
                    display_name,
                    role,
                    password_hash,
                    is_active,
                    phone,
                    city,
                    telegram,
                    about,
                    notification_preferences,
                    twofa_enabled,
                    twofa_secret,
                    twofa_recovery_codes_hash,
                    twofa_pending_secret,
                    twofa_pending_recovery_codes_hash,
                    auth_provider,
                    created_at,
                    updated_at,
                    last_seen_at
                )
                values (
                    :uuid,
                    :email,
                    :full_name,
                    :display_name,
                    :role,
                    :password_hash,
                    :is_active,
                    :phone,
                    :city,
                    :telegram,
                    :about,
                    cast(:notification_preferences as jsonb),
                    :twofa_enabled,
                    :twofa_secret,
                    cast(:twofa_recovery_codes_hash as jsonb),
                    :twofa_pending_secret,
                    cast(:twofa_pending_recovery_codes_hash as jsonb),
                    :auth_provider,
                    coalesce(:created_at, now()),
                    coalesce(:updated_at, now()),
                    :last_seen_at
                )
                on conflict (email) do update
                  set uuid = excluded.uuid,
                      full_name = excluded.full_name,
                      display_name = excluded.display_name,
                      role = excluded.role,
                      password_hash = excluded.password_hash,
                      is_active = excluded.is_active,
                      phone = excluded.phone,
                      city = excluded.city,
                      telegram = excluded.telegram,
                      about = excluded.about,
                      notification_preferences = excluded.notification_preferences,
                      twofa_enabled = excluded.twofa_enabled,
                      twofa_secret = excluded.twofa_secret,
                      twofa_recovery_codes_hash = excluded.twofa_recovery_codes_hash,
                      twofa_pending_secret = excluded.twofa_pending_secret,
                      twofa_pending_recovery_codes_hash = excluded.twofa_pending_recovery_codes_hash,
                      auth_provider = excluded.auth_provider,
                      updated_at = coalesce(excluded.updated_at, now()),
                      last_seen_at = excluded.last_seen_at
                returning id
                """
            ),
            {
                "uuid": str(payload.get("uuid") or "").strip(),
                "email": str(payload.get("email") or "").strip().lower(),
                "full_name": full_name,
                "display_name": display_name,
                "role": str(payload.get("role") or "user").strip().lower() or "user",
                "password_hash": str(payload.get("password_hash") or "").strip(),
                "is_active": str(payload.get("is_active", "true")).strip().lower() != "false",
                "phone": str(payload.get("phone") or "").strip(),
                "city": str(payload.get("city") or "").strip(),
                "telegram": str(payload.get("telegram") or "").strip(),
                "about": str(payload.get("about") or "").strip(),
                "notification_preferences": json.dumps(notification_preferences, ensure_ascii=False),
                "twofa_enabled": str(payload.get("twofa_enabled", "0")).strip() == "1",
                "twofa_secret": str(payload.get("twofa_secret") or "").strip() or None,
                "twofa_recovery_codes_hash": json.dumps(_parse_hash_list(payload.get("twofa_recovery_codes_hash"))),
                "twofa_pending_secret": str(payload.get("twofa_pending_secret") or "").strip() or None,
                "twofa_pending_recovery_codes_hash": json.dumps(
                    _parse_hash_list(payload.get("twofa_pending_recovery_codes_hash"))
                ),
                "auth_provider": str(payload.get("auth_provider") or "").strip() or None,
                "created_at": _parse_iso(payload.get("created_at")),
                "updated_at": _parse_iso(payload.get("updated_at")),
                "last_seen_at": _parse_iso(payload.get("last_seen_at")),
            },
        )
    ).mappings().first()
    if not row or row.get("id") is None:
        raise RuntimeError("failed to upsert auth user")
    return int(row["id"])


async def _upsert_session(session, *, db_user_id: int, session_payload: dict[str, str], session_id: str) -> None:
    await session.execute(
        text(
            """
            insert into auth_sessions (
                id,
                user_id,
                device,
                ip_address,
                location,
                created_at,
                last_seen_at,
                revoked_at
            )
            values (
                :id,
                :user_id,
                :device,
                :ip_address,
                :location,
                coalesce(:created_at, now()),
                coalesce(:last_seen_at, now()),
                :revoked_at
            )
            on conflict (id) do update
              set user_id = excluded.user_id,
                  device = excluded.device,
                  ip_address = excluded.ip_address,
                  location = excluded.location,
                  last_seen_at = excluded.last_seen_at
            """
        ),
        {
            "id": session_id,
            "user_id": db_user_id,
            "device": str(session_payload.get("device") or "unknown device"),
            "ip_address": str(session_payload.get("ip_address") or "unknown"),
            "location": str(session_payload.get("location") or "unknown"),
            "created_at": _parse_iso(session_payload.get("created_at")),
            "last_seen_at": _parse_iso(session_payload.get("last_seen_at") or session_payload.get("created_at")),
            "revoked_at": None,
        },
    )


async def _upsert_session_token(
    session,
    *,
    db_user_id: int,
    session_id: str,
    token: str,
    token_type: str,
    ttl_seconds: int,
) -> None:
    effective_ttl = max(1, int(ttl_seconds))
    expires_at = datetime.now(UTC) + timedelta(seconds=effective_ttl)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    await session.execute(
        text(
            """
            insert into auth_session_tokens (
                session_id,
                user_id,
                token_hash,
                token_type,
                expires_at
            )
            values (
                :session_id,
                :user_id,
                :token_hash,
                :token_type,
                :expires_at
            )
            on conflict (token_hash) do update
              set session_id = excluded.session_id,
                  user_id = excluded.user_id,
                  token_type = excluded.token_type,
                  expires_at = excluded.expires_at,
                  revoked_at = null
            """
        ),
        {
            "session_id": session_id,
            "user_id": db_user_id,
            "token_hash": token_hash,
            "token_type": token_type,
            "expires_at": expires_at,
        },
    )


async def _run_backfill(*, dry_run: bool) -> BackfillStats:
    stats = BackfillStats()
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    redis_to_db_user_ids: dict[int, int] = {}

    async with AsyncSessionLocal() as session:
        async for key in redis.scan_iter(match="auth:user:*"):
            if key.count(":") != 2:
                continue
            if await redis.type(key) != "hash":
                continue
            payload = await redis.hgetall(key)
            if not payload:
                continue
            redis_id_raw = payload.get("id")
            if redis_id_raw is None:
                continue
            try:
                redis_internal_id = int(redis_id_raw)
            except ValueError:
                continue

            stats.users_total += 1
            db_user_id = await _upsert_user(session, payload)
            redis_to_db_user_ids[redis_internal_id] = db_user_id
            stats.users_upserted += 1

        async for key in redis.scan_iter(match="auth:session:*"):
            if key.count(":") != 2:
                continue
            if await redis.type(key) != "hash":
                continue
            session_payload = await redis.hgetall(key)
            if not session_payload:
                continue

            session_id = str(session_payload.get("id") or key.split(":")[-1]).strip()
            if not session_id:
                continue
            user_id_raw = session_payload.get("user_id")
            try:
                redis_user_id = int(str(user_id_raw))
            except (TypeError, ValueError):
                continue
            db_user_id = redis_to_db_user_ids.get(redis_user_id)
            if db_user_id is None:
                continue

            stats.sessions_total += 1
            await _upsert_session(session, db_user_id=db_user_id, session_payload=session_payload, session_id=session_id)
            stats.sessions_upserted += 1

            for token_type in ("access", "refresh"):
                token_set_key = f"auth:session:{session_id}:{token_type}_tokens"
                tokens = await redis.smembers(token_set_key)
                for token in tokens:
                    token_key = f"auth:{token_type}:{token}"
                    ttl = await redis.ttl(token_key)
                    fallback_ttl = 900 if token_type == "access" else 60 * 60 * 24 * 30
                    effective_ttl = int(ttl) if isinstance(ttl, int) and ttl > 0 else fallback_ttl
                    stats.session_tokens_total += 1
                    await _upsert_session_token(
                        session,
                        db_user_id=db_user_id,
                        session_id=session_id,
                        token=token,
                        token_type=token_type,
                        ttl_seconds=effective_ttl,
                    )
                    stats.session_tokens_upserted += 1

        async for oauth_key in redis.scan_iter(match="auth:oauth:*:*"):
            parts = oauth_key.split(":")
            if len(parts) != 4:
                continue
            _, _, provider, provider_user_id = parts
            if not provider or not provider_user_id:
                continue
            mapped_user_id_raw = await redis.get(oauth_key)
            try:
                mapped_redis_user_id = int(str(mapped_user_id_raw))
            except (TypeError, ValueError):
                continue
            db_user_id = redis_to_db_user_ids.get(mapped_redis_user_id)
            if db_user_id is None:
                continue

            stats.oauth_links_total += 1
            await session.execute(
                text(
                    """
                    insert into auth_oauth_identities (
                        user_id,
                        provider,
                        provider_user_id
                    )
                    values (
                        :user_id,
                        :provider,
                        :provider_user_id
                    )
                    on conflict (provider, provider_user_id) do update
                      set user_id = excluded.user_id,
                          updated_at = now()
                    """
                ),
                {
                    "user_id": db_user_id,
                    "provider": provider,
                    "provider_user_id": provider_user_id,
                },
            )
            stats.oauth_links_upserted += 1

        if dry_run:
            await session.rollback()
        else:
            await session.commit()

    if hasattr(redis, "aclose"):
        await redis.aclose()
    else:
        await redis.close()

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill auth data from Redis into Postgres auth_* tables.")
    parser.add_argument("--dry-run", action="store_true", help="Run without commit.")
    args = parser.parse_args()

    stats = asyncio.run(_run_backfill(dry_run=bool(args.dry_run)))
    print(
        json.dumps(
            {
                "dry_run": bool(args.dry_run),
                "users_total": stats.users_total,
                "users_upserted": stats.users_upserted,
                "sessions_total": stats.sessions_total,
                "sessions_upserted": stats.sessions_upserted,
                "session_tokens_total": stats.session_tokens_total,
                "session_tokens_upserted": stats.session_tokens_upserted,
                "oauth_links_total": stats.oauth_links_total,
                "oauth_links_upserted": stats.oauth_links_upserted,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()

