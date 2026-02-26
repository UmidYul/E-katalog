from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import and_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db.models import (
    AuthEmailConfirmationToken,
    AuthOAuthIdentity,
    AuthPasswordResetToken,
    AuthSession,
    AuthSessionToken,
    AuthUser,
)


def hash_auth_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _parse_iso_datetime(value: Any) -> datetime | None:
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


def _parse_hash_csv(value: Any) -> list[str]:
    raw = str(value or "").strip()
    if not raw:
        return []
    return [item for item in raw.split(",") if item]


def _normalize_uuid(value: Any) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        return str(uuid4())
    try:
        return str(UUID(candidate))
    except ValueError:
        return str(uuid4())


def _format_auth_user_payload(user: AuthUser) -> dict[str, Any]:
    full_name = str(user.full_name or "").strip() or str(user.display_name or "").strip() or str(user.email or "").split("@")[0]
    return {
        "id": int(user.id),
        "uuid": str(user.uuid),
        "email": str(user.email or "").lower(),
        "full_name": full_name,
        "role": str(user.role or "user"),
        "password_hash": str(user.password_hash or ""),
        "twofa_enabled": bool(user.twofa_enabled),
        "twofa_secret": str(user.twofa_secret or ""),
        "twofa_recovery_codes_hash": ",".join(user.twofa_recovery_codes_hash or []),
        "twofa_pending_secret": str(user.twofa_pending_secret or ""),
        "twofa_pending_recovery_codes_hash": ",".join(user.twofa_pending_recovery_codes_hash or []),
        "email_confirmed": bool(user.email_confirmed),
        "email_confirmed_at": user.email_confirmed_at.astimezone(UTC).isoformat() if user.email_confirmed_at else "",
    }


def _format_session_payload(session_obj: AuthSession) -> dict[str, str]:
    created_at = session_obj.created_at.astimezone(UTC).isoformat() if session_obj.created_at else datetime.now(UTC).isoformat()
    last_seen_at = session_obj.last_seen_at.astimezone(UTC).isoformat() if session_obj.last_seen_at else created_at
    return {
        "id": str(session_obj.id),
        "user_id": str(session_obj.user_id),
        "device": str(session_obj.device or "unknown device"),
        "ip_address": str(session_obj.ip_address or "unknown"),
        "location": str(session_obj.location or "unknown"),
        "created_at": created_at,
        "last_seen_at": last_seen_at,
    }


async def pg_load_user_by_id(db: AsyncSession, user_id: int) -> dict[str, Any] | None:
    user = (
        await db.execute(
            select(AuthUser).where(AuthUser.id == user_id).limit(1)
        )
    ).scalars().first()
    if user is None:
        return None
    return _format_auth_user_payload(user)


async def pg_load_user_by_email(db: AsyncSession, email: str) -> dict[str, Any] | None:
    normalized = str(email or "").strip().lower()
    if not normalized:
        return None
    user = (
        await db.execute(
            select(AuthUser).where(AuthUser.email == normalized).limit(1)
        )
    ).scalars().first()
    if user is None:
        return None
    return _format_auth_user_payload(user)


async def pg_get_user_id_by_email(db: AsyncSession, email: str) -> int | None:
    normalized = str(email or "").strip().lower()
    if not normalized:
        return None
    row = (
        await db.execute(
            select(AuthUser.id).where(AuthUser.email == normalized).limit(1)
        )
    ).first()
    if not row:
        return None
    return int(row[0])


async def pg_upsert_user_from_redis_mapping(db: AsyncSession, payload: dict[str, str]) -> int:
    redis_id_raw = str(payload.get("id") or "").strip()
    redis_id = int(redis_id_raw) if redis_id_raw.isdigit() else None
    normalized_email = str(payload.get("email") or "").strip().lower()
    full_name = str(payload.get("full_name") or "").strip()
    display_name = str(payload.get("display_name") or "").strip() or full_name
    values: dict[str, Any] = {
        "uuid": _normalize_uuid(payload.get("uuid")),
        "email": normalized_email,
        "full_name": full_name,
        "display_name": display_name,
        "role": str(payload.get("role") or "user").strip().lower() or "user",
        "password_hash": str(payload.get("password_hash") or "").strip(),
        "is_active": str(payload.get("is_active", "true")).strip().lower() != "false",
        "phone": str(payload.get("phone") or "").strip(),
        "city": str(payload.get("city") or "").strip(),
        "telegram": str(payload.get("telegram") or "").strip(),
        "about": str(payload.get("about") or "").strip(),
        "notification_preferences": {},
        "twofa_enabled": str(payload.get("twofa_enabled", "0")).strip() == "1",
        "twofa_secret": str(payload.get("twofa_secret") or "").strip() or None,
        "twofa_recovery_codes_hash": _parse_hash_csv(payload.get("twofa_recovery_codes_hash")),
        "twofa_pending_secret": str(payload.get("twofa_pending_secret") or "").strip() or None,
        "twofa_pending_recovery_codes_hash": _parse_hash_csv(payload.get("twofa_pending_recovery_codes_hash")),
        "auth_provider": str(payload.get("auth_provider") or "").strip() or None,
        "email_confirmed": str(payload.get("email_confirmed", "0")).strip().lower() in {"1", "true", "yes"},
        "email_confirmed_at": _parse_iso_datetime(payload.get("email_confirmed_at")),
        "created_at": _parse_iso_datetime(payload.get("created_at")) or datetime.now(UTC),
        "updated_at": _parse_iso_datetime(payload.get("updated_at")) or datetime.now(UTC),
        "last_seen_at": _parse_iso_datetime(payload.get("last_seen_at")),
    }
    if redis_id is not None:
        values["id"] = redis_id

    insert_stmt = pg_insert(AuthUser).values(**values)
    update_fields = {
        "uuid": insert_stmt.excluded.uuid,
        "full_name": insert_stmt.excluded.full_name,
        "display_name": insert_stmt.excluded.display_name,
        "role": insert_stmt.excluded.role,
        "password_hash": insert_stmt.excluded.password_hash,
        "is_active": insert_stmt.excluded.is_active,
        "phone": insert_stmt.excluded.phone,
        "city": insert_stmt.excluded.city,
        "telegram": insert_stmt.excluded.telegram,
        "about": insert_stmt.excluded.about,
        "notification_preferences": insert_stmt.excluded.notification_preferences,
        "twofa_enabled": insert_stmt.excluded.twofa_enabled,
        "twofa_secret": insert_stmt.excluded.twofa_secret,
        "twofa_recovery_codes_hash": insert_stmt.excluded.twofa_recovery_codes_hash,
        "twofa_pending_secret": insert_stmt.excluded.twofa_pending_secret,
        "twofa_pending_recovery_codes_hash": insert_stmt.excluded.twofa_pending_recovery_codes_hash,
        "auth_provider": insert_stmt.excluded.auth_provider,
        "email_confirmed": insert_stmt.excluded.email_confirmed,
        "email_confirmed_at": insert_stmt.excluded.email_confirmed_at,
        "updated_at": insert_stmt.excluded.updated_at,
        "last_seen_at": insert_stmt.excluded.last_seen_at,
    }
    stmt = (
        insert_stmt.on_conflict_do_update(
            index_elements=[AuthUser.email],
            set_=update_fields,
        )
        .returning(AuthUser.id)
    )
    row = (await db.execute(stmt)).first()
    if row is None or row[0] is None:
        raise RuntimeError("failed to upsert auth user")
    return int(row[0])


def _coerce_user_field_updates(fields: dict[str, str]) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    for key, raw_value in fields.items():
        value = str(raw_value if raw_value is not None else "").strip()
        if key == "full_name":
            updates["full_name"] = value
        elif key == "display_name":
            updates["display_name"] = value
        elif key == "role":
            updates["role"] = value or "user"
        elif key == "password_hash":
            updates["password_hash"] = value
        elif key == "last_seen_at":
            updates["last_seen_at"] = _parse_iso_datetime(value) or datetime.now(UTC)
        elif key == "twofa_enabled":
            updates["twofa_enabled"] = value == "1"
        elif key == "twofa_secret":
            updates["twofa_secret"] = value or None
        elif key == "twofa_recovery_codes_hash":
            updates["twofa_recovery_codes_hash"] = _parse_hash_csv(value)
        elif key == "twofa_pending_secret":
            updates["twofa_pending_secret"] = value or None
        elif key == "twofa_pending_recovery_codes_hash":
            updates["twofa_pending_recovery_codes_hash"] = _parse_hash_csv(value)
        elif key == "auth_provider":
            updates["auth_provider"] = value or None
        elif key == "email_confirmed":
            updates["email_confirmed"] = value.lower() in {"1", "true", "yes"}
        elif key == "email_confirmed_at":
            updates["email_confirmed_at"] = _parse_iso_datetime(value)
        elif key == "updated_at":
            updates["updated_at"] = _parse_iso_datetime(value) or datetime.now(UTC)
    return updates


async def pg_patch_user_fields(db: AsyncSession, *, user_id: int, fields: dict[str, str]) -> bool:
    updates = _coerce_user_field_updates(fields)
    if not updates:
        return False
    row = await db.execute(
        update(AuthUser)
        .where(AuthUser.id == user_id)
        .values(**updates)
    )
    return int(row.rowcount or 0) > 0


async def pg_get_session(db: AsyncSession, *, session_id: str) -> dict[str, str] | None:
    row = (
        await db.execute(
            select(AuthSession)
            .where(and_(AuthSession.id == session_id, AuthSession.revoked_at.is_(None)))
            .limit(1)
        )
    ).scalars().first()
    if row is None:
        return None
    return _format_session_payload(row)


async def pg_upsert_session(
    db: AsyncSession,
    *,
    session_id: str,
    user_id: int,
    device: str,
    ip_address: str,
    location: str,
    created_at: datetime,
    last_seen_at: datetime,
) -> None:
    insert_stmt = pg_insert(AuthSession).values(
        id=session_id,
        user_id=user_id,
        device=device,
        ip_address=ip_address,
        location=location,
        created_at=created_at,
        last_seen_at=last_seen_at,
        revoked_at=None,
    )
    await db.execute(
        insert_stmt.on_conflict_do_update(
            index_elements=[AuthSession.id],
            set_={
                "user_id": insert_stmt.excluded.user_id,
                "device": insert_stmt.excluded.device,
                "ip_address": insert_stmt.excluded.ip_address,
                "location": insert_stmt.excluded.location,
                "last_seen_at": insert_stmt.excluded.last_seen_at,
                "revoked_at": None,
            },
        )
    )


async def pg_touch_session(
    db: AsyncSession,
    *,
    session_id: str,
    device: str,
    ip_address: str,
    location: str,
    last_seen_at: datetime,
) -> bool:
    row = await db.execute(
        update(AuthSession)
        .where(and_(AuthSession.id == session_id, AuthSession.revoked_at.is_(None)))
        .values(
            device=device,
            ip_address=ip_address,
            location=location,
            last_seen_at=last_seen_at,
        )
    )
    return int(row.rowcount or 0) > 0


async def pg_upsert_session_token(
    db: AsyncSession,
    *,
    session_id: str,
    user_id: int,
    raw_token: str,
    token_type: str,
    expires_at: datetime,
) -> None:
    token_hash = hash_auth_token(raw_token)
    insert_stmt = pg_insert(AuthSessionToken).values(
        session_id=session_id,
        user_id=user_id,
        token_hash=token_hash,
        token_type=token_type,
        expires_at=expires_at,
        revoked_at=None,
    )
    await db.execute(
        insert_stmt.on_conflict_do_update(
            index_elements=[AuthSessionToken.token_hash],
            set_={
                "session_id": insert_stmt.excluded.session_id,
                "user_id": insert_stmt.excluded.user_id,
                "token_type": insert_stmt.excluded.token_type,
                "expires_at": insert_stmt.excluded.expires_at,
                "revoked_at": None,
            },
        )
    )


async def pg_revoke_session_token(db: AsyncSession, *, raw_token: str, token_type: str | None = None) -> bool:
    conditions = [AuthSessionToken.token_hash == hash_auth_token(raw_token), AuthSessionToken.revoked_at.is_(None)]
    if token_type:
        conditions.append(AuthSessionToken.token_type == token_type)
    row = await db.execute(
        update(AuthSessionToken)
        .where(and_(*conditions))
        .values(revoked_at=datetime.now(UTC))
    )
    return int(row.rowcount or 0) > 0


async def pg_resolve_session_token(db: AsyncSession, *, raw_token: str, token_type: str) -> dict[str, Any] | None:
    now_dt = datetime.now(UTC)
    row = (
        await db.execute(
            select(AuthSessionToken.user_id, AuthSessionToken.session_id)
            .join(AuthSession, AuthSession.id == AuthSessionToken.session_id)
            .where(
                and_(
                    AuthSessionToken.token_hash == hash_auth_token(raw_token),
                    AuthSessionToken.token_type == token_type,
                    AuthSessionToken.revoked_at.is_(None),
                    AuthSessionToken.expires_at > now_dt,
                    AuthSession.revoked_at.is_(None),
                )
            )
            .limit(1)
        )
    ).first()
    if not row:
        return None
    return {"user_id": int(row[0]), "session_id": str(row[1])}


async def pg_revoke_session(db: AsyncSession, *, user_id: int, session_id: str) -> bool:
    now = datetime.now(UTC)
    session_row = await db.execute(
        update(AuthSession)
        .where(and_(AuthSession.id == session_id, AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)))
        .values(revoked_at=now)
    )
    revoked = int(session_row.rowcount or 0) > 0
    await db.execute(
        update(AuthSessionToken)
        .where(and_(AuthSessionToken.session_id == session_id, AuthSessionToken.revoked_at.is_(None)))
        .values(revoked_at=now)
    )
    return revoked


async def pg_create_password_reset_token(
    db: AsyncSession,
    *,
    user_id: int,
    raw_token: str,
    expires_at: datetime,
) -> None:
    token_hash = hash_auth_token(raw_token)
    await db.execute(
        update(AuthPasswordResetToken)
        .where(and_(AuthPasswordResetToken.user_id == user_id, AuthPasswordResetToken.used_at.is_(None)))
        .values(used_at=datetime.now(UTC))
    )
    insert_stmt = pg_insert(AuthPasswordResetToken).values(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
        used_at=None,
    )
    await db.execute(
        insert_stmt.on_conflict_do_update(
            index_elements=[AuthPasswordResetToken.token_hash],
            set_={
                "user_id": insert_stmt.excluded.user_id,
                "expires_at": insert_stmt.excluded.expires_at,
                "used_at": None,
            },
        )
    )


async def pg_consume_password_reset_token(db: AsyncSession, *, raw_token: str) -> int | None:
    now = datetime.now(UTC)
    row = (
        await db.execute(
            update(AuthPasswordResetToken)
            .where(
                and_(
                    AuthPasswordResetToken.token_hash == hash_auth_token(raw_token),
                    AuthPasswordResetToken.used_at.is_(None),
                    AuthPasswordResetToken.expires_at > now,
                )
            )
            .values(used_at=now)
            .returning(AuthPasswordResetToken.user_id)
        )
    ).first()
    if row is None or row[0] is None:
        return None
    return int(row[0])


async def pg_create_email_confirmation_token(
    db: AsyncSession,
    *,
    user_id: int,
    raw_token: str,
    expires_at: datetime,
) -> None:
    token_hash = hash_auth_token(raw_token)
    await db.execute(
        update(AuthEmailConfirmationToken)
        .where(and_(AuthEmailConfirmationToken.user_id == user_id, AuthEmailConfirmationToken.used_at.is_(None)))
        .values(used_at=datetime.now(UTC))
    )
    insert_stmt = pg_insert(AuthEmailConfirmationToken).values(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
        used_at=None,
    )
    await db.execute(
        insert_stmt.on_conflict_do_update(
            index_elements=[AuthEmailConfirmationToken.token_hash],
            set_={
                "user_id": insert_stmt.excluded.user_id,
                "expires_at": insert_stmt.excluded.expires_at,
                "used_at": None,
            },
        )
    )


async def pg_consume_email_confirmation_token(db: AsyncSession, *, raw_token: str) -> int | None:
    now = datetime.now(UTC)
    row = (
        await db.execute(
            update(AuthEmailConfirmationToken)
            .where(
                and_(
                    AuthEmailConfirmationToken.token_hash == hash_auth_token(raw_token),
                    AuthEmailConfirmationToken.used_at.is_(None),
                    AuthEmailConfirmationToken.expires_at > now,
                )
            )
            .values(used_at=now)
            .returning(AuthEmailConfirmationToken.user_id)
        )
    ).first()
    if row is None or row[0] is None:
        return None
    return int(row[0])


async def pg_list_active_sessions(db: AsyncSession, *, user_id: int) -> list[dict[str, str]]:
    rows = (
        await db.execute(
            select(AuthSession)
            .where(and_(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)))
            .order_by(AuthSession.last_seen_at.desc(), AuthSession.created_at.desc())
        )
    ).scalars().all()
    return [_format_session_payload(item) for item in rows]


async def pg_get_oauth_identity_user_id(db: AsyncSession, *, provider: str, provider_user_id: str) -> int | None:
    row = (
        await db.execute(
            select(AuthOAuthIdentity.user_id)
            .where(and_(AuthOAuthIdentity.provider == provider, AuthOAuthIdentity.provider_user_id == provider_user_id))
            .limit(1)
        )
    ).first()
    if not row:
        return None
    return int(row[0])


async def pg_upsert_oauth_identity(db: AsyncSession, *, provider: str, provider_user_id: str, user_id: int) -> None:
    insert_stmt = pg_insert(AuthOAuthIdentity).values(
        provider=provider,
        provider_user_id=provider_user_id,
        user_id=user_id,
    )
    await db.execute(
        insert_stmt.on_conflict_do_update(
            index_elements=[AuthOAuthIdentity.provider, AuthOAuthIdentity.provider_user_id],
            set_={
                "user_id": insert_stmt.excluded.user_id,
                "updated_at": datetime.now(UTC),
            },
        )
    )
