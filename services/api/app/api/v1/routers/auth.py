from __future__ import annotations

import base64
import hashlib
import hmac
import html
import io
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal
from urllib.parse import quote, urlencode
from uuid import UUID, uuid4

import httpx
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, get_redis
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.repositories.auth_storage import (
    pg_get_oauth_identity_user_id,
    pg_get_session,
    pg_get_user_id_by_email,
    pg_list_active_sessions,
    pg_patch_user_fields,
    pg_consume_password_reset_token,
    pg_create_password_reset_token,
    pg_load_user_by_email,
    pg_load_user_by_id,
    pg_revoke_session,
    pg_revoke_session_token,
    pg_touch_session,
    pg_upsert_oauth_identity,
    pg_upsert_session,
    pg_upsert_session_token,
    pg_upsert_user_from_redis_mapping,
)

router = APIRouter(prefix="/auth", tags=["auth"])

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
ROLE_COOKIE = "user_role"
ACCESS_TTL_SECONDS = 60 * 15
REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30
TWOFA_CHALLENGE_TTL_SECONDS = 60 * 5
OAUTH_STATE_TTL_SECONDS = 60 * 10
SUPPORTED_OAUTH_PROVIDERS = ("google", "facebook")
PASSWORD_HASHER = PasswordHasher()
LEGACY_SHA256_HEX = "0123456789abcdef"


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=150)
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=150)
    password: str = Field(min_length=8, max_length=128)
    two_factor_code: str | None = Field(default=None, min_length=6, max_length=16)
    recovery_code: str | None = Field(default=None, min_length=4, max_length=64)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    revoke_other_sessions: bool = False


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=5, max_length=150)


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(min_length=20, max_length=255)
    new_password: str = Field(min_length=8, max_length=128)


class PasswordResetRequestResponse(BaseModel):
    ok: bool = True
    expires_in: int | None = None
    reset_token: str | None = None


class EmailConfirmationConfirmRequest(BaseModel):
    token: str = Field(min_length=20, max_length=255)


class EmailConfirmationRequestResponse(BaseModel):
    ok: bool = True
    expires_in: int | None = None
    confirmation_token: str | None = None


class AuthUserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str = "user"
    twofa_enabled: bool = False
    email_confirmed: bool = False


class TwoFactorChallengeResponse(BaseModel):
    requires_2fa: Literal[True] = True
    challenge_token: str
    expires_in: int = TWOFA_CHALLENGE_TTL_SECONDS


class SessionInfo(BaseModel):
    id: str
    device: str
    ip_address: str
    location: str
    created_at: str
    last_seen_at: str
    is_current: bool


class SessionBulkRevokeResponse(BaseModel):
    ok: bool = True
    revoked: int


class TwoFactorSetupResponse(BaseModel):
    secret: str
    qr_svg: str
    recovery_codes: list[str]
    otpauth_url: str


class TwoFactorVerifyRequest(BaseModel):
    code: str | None = Field(default=None, min_length=6, max_length=16)
    recovery_code: str | None = Field(default=None, min_length=4, max_length=64)
    challenge_token: str | None = Field(default=None, min_length=20, max_length=255)


class TwoFactorStatusResponse(BaseModel):
    ok: bool = True
    enabled: bool


class OAuthProviderInfo(BaseModel):
    provider: str
    enabled: bool
    authorization_endpoint: str


class OAuthProvidersResponse(BaseModel):
    providers: list[OAuthProviderInfo]


def _legacy_hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _is_legacy_password_hash(password_hash: str) -> bool:
    normalized = str(password_hash or "").strip().lower()
    return len(normalized) == 64 and all(ch in LEGACY_SHA256_HEX for ch in normalized)


def _hash_password(password: str) -> str:
    return PASSWORD_HASHER.hash(password)


def _verify_password(password: str, password_hash: str) -> bool:
    normalized = str(password_hash or "").strip()
    if not normalized:
        return False
    if _is_legacy_password_hash(normalized):
        return hmac.compare_digest(_legacy_hash_password(password), normalized.lower())
    try:
        return PASSWORD_HASHER.verify(normalized, password)
    except (VerifyMismatchError, InvalidHash):
        return False
    except Exception:
        return False


def _password_needs_rehash(password_hash: str) -> bool:
    normalized = str(password_hash or "").strip()
    if not normalized or _is_legacy_password_hash(normalized):
        return True
    try:
        return PASSWORD_HASHER.check_needs_rehash(normalized)
    except InvalidHash:
        return True
    except Exception:
        return True


def _hash_recovery_code(code: str) -> str:
    normalized = "".join(ch for ch in str(code).strip().upper() if ch.isalnum())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _issue_token() -> str:
    return secrets.token_urlsafe(32)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _normalize_uuid(value: str | None) -> str | None:
    candidate = str(value or "").strip()
    if not candidate:
        return None
    try:
        return str(UUID(candidate))
    except ValueError:
        return None


def _encode_token_payload(user_id: int, session_id: str | None) -> str:
    return f"{user_id}:{session_id}" if session_id else str(user_id)


def _decode_token_payload(value: str | None) -> tuple[int | None, str | None]:
    raw = str(value or "").strip()
    if not raw:
        return None, None
    if ":" in raw:
        left, right = raw.split(":", 1)
        try:
            return int(left), _normalize_uuid(right)
        except ValueError:
            return None, None
    try:
        return int(raw), None
    except ValueError:
        return None, None


def _sanitize_code(value: str | None) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _build_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _hotp(secret: str, counter: int, *, digits: int = 6) -> str:
    if counter < 0:
        return "0" * digits
    pad = "=" * ((8 - (len(secret) % 8)) % 8)
    key = base64.b32decode(f"{secret.upper()}{pad}", casefold=True)
    digest = hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = (int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF) % (10**digits)
    return f"{code_int:0{digits}d}"


def _verify_totp(secret: str, code: str, *, step: int = 30, window: int = 1, digits: int = 6) -> bool:
    normalized = _sanitize_code(code)
    if len(normalized) != digits:
        return False
    current_counter = int(datetime.now(UTC).timestamp()) // step
    for delta in range(-window, window + 1):
        if hmac.compare_digest(_hotp(secret, current_counter + delta, digits=digits), normalized):
            return True
    return False


def _issue_recovery_codes(*, count: int = 8) -> list[str]:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return [
        f"{''.join(secrets.choice(alphabet) for _ in range(4))}-{''.join(secrets.choice(alphabet) for _ in range(4))}"
        for _ in range(count)
    ]


def _serialize_hashes(values: list[str]) -> str:
    return ",".join(values)


def _parse_hashes(value: str | None) -> list[str]:
    if not value:
        return []
    return [item for item in str(value).split(",") if item]


def _extract_client_ip(request: Request) -> str:
    forwarded_for = str(request.headers.get("x-forwarded-for") or "").strip()
    if forwarded_for:
        head = forwarded_for.split(",")[0].strip()
        if head:
            return head
    real_ip = str(request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _extract_location(request: Request) -> str:
    return str(request.headers.get("cf-ipcountry") or request.headers.get("x-country-code") or "unknown").strip() or "unknown"


def _extract_device(request: Request) -> str:
    ua = str(request.headers.get("user-agent") or "").strip()
    if not ua:
        return "unknown device"
    normalized = ua.lower()
    if "edg/" in normalized:
        browser = "Edge"
    elif "opr/" in normalized or "opera" in normalized:
        browser = "Opera"
    elif "chrome/" in normalized:
        browser = "Chrome"
    elif "firefox/" in normalized:
        browser = "Firefox"
    elif "safari/" in normalized:
        browser = "Safari"
    else:
        browser = "Browser"
    if "windows" in normalized:
        platform = "Windows"
    elif "android" in normalized:
        platform = "Android"
    elif "iphone" in normalized or "ipad" in normalized:
        platform = "iOS"
    elif "mac os x" in normalized or "macintosh" in normalized:
        platform = "macOS"
    elif "linux" in normalized:
        platform = "Linux"
    else:
        platform = "Unknown OS"
    return f"{browser} on {platform}"


def _session_key(session_id: str) -> str:
    return f"auth:session:{session_id}"


def _session_access_key(session_id: str) -> str:
    return f"auth:session:{session_id}:access_tokens"


def _session_refresh_key(session_id: str) -> str:
    return f"auth:session:{session_id}:refresh_tokens"


def _user_sessions_key(user_id: int) -> str:
    return f"auth:user:{user_id}:sessions"


def _challenge_key(token: str) -> str:
    return f"auth:2fa:challenge:{token}"


def _email_confirmation_key(token: str) -> str:
    return f"auth:email-confirmation:{token}"


def _oauth_state_key(provider: str, state: str) -> str:
    return f"auth:oauth:state:{provider}:{state}"


def _oauth_identity_key(provider: str, provider_user_id: str) -> str:
    return f"auth:oauth:{provider}:{provider_user_id}"


def _login_lock_scope_key(scope: Literal["ip", "email"], value: str, kind: Literal["fail", "block"]) -> str:
    subject = str(value or "").strip().lower()
    if not subject:
        return ""
    digest = hashlib.sha256(subject.encode("utf-8")).hexdigest()[:32]
    return f"auth:login:{kind}:{scope}:{digest}"


async def _enforce_login_lockout(redis: Redis, *, email: str, client_ip: str) -> None:
    if not settings.auth_lockout_enabled:
        return
    targets: list[tuple[Literal["ip", "email"], str]] = [
        ("ip", client_ip),
        ("email", email),
    ]
    max_retry_after = 0
    for scope, value in targets:
        block_key = _login_lock_scope_key(scope, value, "block")
        if not block_key:
            continue
        ttl = int(await redis.ttl(block_key) or 0)
        if ttl > max_retry_after:
            max_retry_after = ttl
    if max_retry_after > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"too many login attempts; retry in {max_retry_after}s",
        )


async def _register_failed_login_attempt(redis: Redis, *, email: str, client_ip: str) -> None:
    if not settings.auth_lockout_enabled:
        return
    window_seconds = max(60, int(settings.auth_lockout_window_seconds))
    block_seconds = max(60, int(settings.auth_lockout_block_seconds))
    limits: list[tuple[Literal["ip", "email"], str, int]] = [
        ("ip", client_ip, max(1, int(settings.auth_lockout_max_attempts_ip))),
        ("email", email, max(1, int(settings.auth_lockout_max_attempts_email))),
    ]
    for scope, value, limit in limits:
        fail_key = _login_lock_scope_key(scope, value, "fail")
        block_key = _login_lock_scope_key(scope, value, "block")
        if not fail_key or not block_key:
            continue
        attempts = int(await redis.incr(fail_key))
        if attempts == 1:
            await redis.expire(fail_key, window_seconds)
        if attempts >= limit:
            await redis.setex(block_key, block_seconds, str(attempts))


async def _clear_failed_login_attempts(redis: Redis, *, email: str, client_ip: str) -> None:
    if not settings.auth_lockout_enabled:
        return
    keys: list[str] = []
    for scope, value in (("ip", client_ip), ("email", email)):
        fail_key = _login_lock_scope_key(scope, value, "fail")
        block_key = _login_lock_scope_key(scope, value, "block")
        if fail_key:
            keys.append(fail_key)
        if block_key:
            keys.append(block_key)
    if keys:
        await redis.delete(*keys)


def _auth_writes_to_postgres() -> bool:
    return settings.auth_storage_mode in {"dual", "postgres"}


def _auth_reads_from_postgres() -> bool:
    return settings.auth_storage_mode == "postgres"


async def _sync_user_from_redis(redis: Redis, db: AsyncSession | None, *, user_id: int) -> int | None:
    if db is None or not _auth_writes_to_postgres():
        return None
    payload = await redis.hgetall(f"auth:user:{user_id}")
    if not payload:
        return None
    if not payload.get("id"):
        payload["id"] = str(user_id)
    if not payload.get("email"):
        return None
    return await pg_upsert_user_from_redis_mapping(db, payload)


async def _resolve_pg_user_id(redis: Redis, db: AsyncSession | None, *, user_id: int) -> int | None:
    if db is None or not _auth_writes_to_postgres():
        return None
    existing = await pg_load_user_by_id(db, user_id)
    if existing is not None:
        return int(existing["id"])
    synced = await _sync_user_from_redis(redis, db, user_id=user_id)
    if synced is not None:
        return int(synced)
    redis_payload = await redis.hgetall(f"auth:user:{user_id}")
    email = str(redis_payload.get("email") or "").strip().lower() if redis_payload else ""
    if email:
        return await pg_get_user_id_by_email(db, email)
    return None


async def _ensure_redis_user_from_postgres(redis: Redis, db: AsyncSession, *, pg_user_id: int) -> int | None:
    user = await pg_load_user_by_id(db, pg_user_id)
    if user is None:
        return None
    email = str(user.get("email") or "").strip().lower()
    if not email:
        return None
    existing_id = await redis.get(f"auth:user:email:{email}")
    if existing_id and str(existing_id).isdigit():
        return int(existing_id)
    now = _now_iso()
    user_uuid = _normalize_uuid(str(user.get("uuid") or "")) or str(uuid4())
    mapping: dict[str, str] = {
        "id": str(pg_user_id),
        "uuid": user_uuid,
        "email": email,
        "full_name": str(user.get("full_name") or "").strip(),
        "display_name": str(user.get("full_name") or "").strip(),
        "phone": "",
        "city": "",
        "telegram": "",
        "about": "",
        "updated_at": now,
        "created_at": now,
        "role": str(user.get("role") or "user"),
        "password_hash": str(user.get("password_hash") or ""),
        "last_seen_at": "",
        "twofa_enabled": "1" if bool(user.get("twofa_enabled")) else "0",
        "twofa_secret": str(user.get("twofa_secret") or ""),
        "twofa_recovery_codes_hash": str(user.get("twofa_recovery_codes_hash") or ""),
        "twofa_pending_secret": str(user.get("twofa_pending_secret") or ""),
        "twofa_pending_recovery_codes_hash": str(user.get("twofa_pending_recovery_codes_hash") or ""),
        "notification_preferences": "",
    }
    await redis.hset(f"auth:user:{pg_user_id}", mapping=mapping)
    await redis.set(f"auth:user:email:{email}", str(pg_user_id))
    return pg_user_id


async def _ensure_user_uuid(redis: Redis, *, user_key: str, payload: dict[str, str]) -> str:
    normalized = _normalize_uuid(payload.get("uuid"))
    if normalized is not None:
        if payload.get("uuid") != normalized:
            await redis.hset(user_key, mapping={"uuid": normalized})
            payload["uuid"] = normalized
        return normalized
    generated = str(uuid4())
    await redis.hset(user_key, mapping={"uuid": generated})
    payload["uuid"] = generated
    return generated


async def _load_user(redis: Redis, user_id: int, db: AsyncSession | None = None) -> dict | None:
    if db is not None and _auth_reads_from_postgres():
        pg_user = await pg_load_user_by_id(db, user_id)
        if pg_user is not None:
            return pg_user

    user_key = f"auth:user:{user_id}"
    payload = await redis.hgetall(user_key)
    if payload:
        user_uuid = await _ensure_user_uuid(redis, user_key=user_key, payload=payload)
        full_name = (
            str(payload.get("full_name", "")).strip()
            or str(payload.get("display_name", "")).strip()
            or str(payload.get("email", "")).split("@")[0]
        )
        return {
            "id": int(payload.get("id", user_id)),
            "uuid": user_uuid,
            "email": str(payload.get("email", "")).lower(),
            "full_name": full_name,
            "role": str(payload.get("role", "user")),
            "password_hash": str(payload.get("password_hash", "")),
            "twofa_enabled": str(payload.get("twofa_enabled", "0")) == "1",
            "twofa_secret": str(payload.get("twofa_secret", "")),
            "twofa_recovery_codes_hash": str(payload.get("twofa_recovery_codes_hash", "")),
            "twofa_pending_secret": str(payload.get("twofa_pending_secret", "")),
            "twofa_pending_recovery_codes_hash": str(payload.get("twofa_pending_recovery_codes_hash", "")),
            "email_confirmed": str(payload.get("email_confirmed", "0")).strip().lower() in {"1", "true", "yes"},
            "email_confirmed_at": str(payload.get("email_confirmed_at", "")).strip(),
        }
    if db is None or not _auth_writes_to_postgres():
        return None
    return await pg_load_user_by_id(db, user_id)


async def _get_user_by_email(redis: Redis, email: str, db: AsyncSession | None = None) -> dict | None:
    normalized_email = email.lower().strip()
    if db is not None and _auth_reads_from_postgres():
        pg_user = await pg_load_user_by_email(db, normalized_email)
        if pg_user is not None:
            return pg_user

    user_id = await redis.get(f"auth:user:email:{normalized_email}")
    if not user_id:
        if db is None or not _auth_writes_to_postgres():
            return None
        return await pg_load_user_by_email(db, normalized_email)
    try:
        return await _load_user(redis, int(user_id), db)
    except ValueError:
        return None


async def _create_user(
    redis: Redis,
    db: AsyncSession | None = None,
    *,
    email: str,
    full_name: str,
    password_hash: str,
    role: str = "user",
    extra_fields: dict[str, str] | None = None,
) -> dict:
    user_id = await redis.incr("auth:user:id")
    user_uuid = str(uuid4())
    now = _now_iso()
    normalized_email = email.lower().strip()
    normalized_full_name = full_name.strip()
    mapping: dict[str, str] = {
        "id": str(user_id),
        "uuid": user_uuid,
        "email": normalized_email,
        "full_name": normalized_full_name,
        "display_name": normalized_full_name,
        "phone": "",
        "city": "",
        "telegram": "",
        "about": "",
        "updated_at": now,
        "created_at": now,
        "role": role,
        "password_hash": password_hash,
        "last_seen_at": "",
        "twofa_enabled": "0",
        "twofa_secret": "",
        "twofa_recovery_codes_hash": "",
        "twofa_pending_secret": "",
        "twofa_pending_recovery_codes_hash": "",
        "notification_preferences": "",
        "email_confirmed": "0",
        "email_confirmed_at": "",
    }
    if extra_fields:
        mapping.update({key: str(value) for key, value in extra_fields.items()})
    await redis.hset(f"auth:user:{user_id}", mapping=mapping)
    await redis.set(f"auth:user:email:{normalized_email}", str(user_id))
    if db is not None and _auth_writes_to_postgres():
        await _sync_user_from_redis(redis, db, user_id=int(user_id))
        await db.commit()
    user = await _load_user(redis, int(user_id), db)
    if user is None:
        raise HTTPException(status_code=500, detail="failed to create user")
    return user


async def _create_session(
    redis: Redis,
    *,
    user_id: int,
    request: Request,
    db: AsyncSession | None = None,
) -> str:
    session_id = str(uuid4())
    now_dt = datetime.now(UTC)
    now = now_dt.isoformat()
    device = _extract_device(request)
    ip_address = _extract_client_ip(request)
    location = _extract_location(request)
    await redis.hset(
        _session_key(session_id),
        mapping={
            "id": session_id,
            "user_id": str(user_id),
            "device": device,
            "ip_address": ip_address,
            "location": location,
            "created_at": now,
            "last_seen_at": now,
        },
    )
    await redis.sadd(_user_sessions_key(user_id), session_id)
    if db is not None and _auth_writes_to_postgres():
        pg_user_id = await _resolve_pg_user_id(redis, db, user_id=user_id)
        if pg_user_id is not None:
            await pg_upsert_session(
                db,
                session_id=session_id,
                user_id=pg_user_id,
                device=device,
                ip_address=ip_address,
                location=location,
                created_at=now_dt,
                last_seen_at=now_dt,
            )
            await db.commit()
    return session_id


async def _touch_session(
    redis: Redis,
    *,
    session_id: str,
    request: Request,
    db: AsyncSession | None = None,
) -> None:
    now_dt = datetime.now(UTC)
    now = now_dt.isoformat()
    device = _extract_device(request)
    ip_address = _extract_client_ip(request)
    location = _extract_location(request)
    await redis.hset(
        _session_key(session_id),
        mapping={
            "last_seen_at": now,
            "device": device,
            "ip_address": ip_address,
            "location": location,
        },
    )
    if db is not None and _auth_writes_to_postgres():
        await pg_touch_session(
            db,
            session_id=session_id,
            device=device,
            ip_address=ip_address,
            location=location,
            last_seen_at=now_dt,
        )
        await db.commit()


async def _set_auth_cookies(
    response: Response,
    *,
    user_id: int,
    redis: Redis,
    request: Request,
    db: AsyncSession | None = None,
    session_id: str | None = None,
    rotate_refresh_token: str | None = None,
) -> str:
    if session_id is not None:
        payload = await redis.hgetall(_session_key(session_id))
        if not payload or str(payload.get("user_id", "")) != str(user_id):
            session_id = await _create_session(redis, user_id=user_id, request=request, db=db)
        else:
            await _touch_session(redis, session_id=session_id, request=request, db=db)
    else:
        session_id = await _create_session(redis, user_id=user_id, request=request, db=db)

    access = _issue_token()
    refresh = _issue_token()
    encoded = _encode_token_payload(user_id, session_id)
    role_payload = await redis.hgetall(f"auth:user:{user_id}")
    role = str(role_payload.get("role", "user")) if role_payload else "user"
    if role == "user" and db is not None and _auth_reads_from_postgres():
        pg_user = await pg_load_user_by_id(db, user_id)
        if pg_user is not None:
            role = str(pg_user.get("role") or "user")

    pipe = redis.pipeline()
    pipe.setex(f"auth:access:{access}", ACCESS_TTL_SECONDS, encoded)
    pipe.setex(f"auth:refresh:{refresh}", REFRESH_TTL_SECONDS, encoded)
    pipe.sadd(_session_access_key(session_id), access)
    pipe.sadd(_session_refresh_key(session_id), refresh)
    pipe.hset(f"auth:user:{user_id}", mapping={"last_seen_at": _now_iso()})
    if rotate_refresh_token:
        pipe.delete(f"auth:refresh:{rotate_refresh_token}")
        pipe.srem(_session_refresh_key(session_id), rotate_refresh_token)
    await pipe.execute()
    if db is not None and _auth_writes_to_postgres():
        pg_user_id = await _resolve_pg_user_id(redis, db, user_id=user_id)
        if pg_user_id is not None:
            now_dt = datetime.now(UTC)
            await pg_upsert_session_token(
                db,
                session_id=session_id,
                user_id=pg_user_id,
                raw_token=access,
                token_type="access",
                expires_at=now_dt + timedelta(seconds=ACCESS_TTL_SECONDS),
            )
            await pg_upsert_session_token(
                db,
                session_id=session_id,
                user_id=pg_user_id,
                raw_token=refresh,
                token_type="refresh",
                expires_at=now_dt + timedelta(seconds=REFRESH_TTL_SECONDS),
            )
            if rotate_refresh_token:
                await pg_revoke_session_token(db, raw_token=rotate_refresh_token, token_type="refresh")
            await _sync_user_from_redis(redis, db, user_id=user_id)
            await db.commit()

    cookie_base = {
        "httponly": True,
        "secure": settings.environment == "production",
        "samesite": "lax",
        "path": "/",
    }
    response.set_cookie(ACCESS_COOKIE, access, max_age=ACCESS_TTL_SECONDS, **cookie_base)
    response.set_cookie(REFRESH_COOKIE, refresh, max_age=REFRESH_TTL_SECONDS, **cookie_base)
    response.set_cookie(ROLE_COOKIE, role, max_age=REFRESH_TTL_SECONDS, **cookie_base)
    return session_id


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/")
    response.delete_cookie(ROLE_COOKIE, path="/")


async def _resolve_user_from_access(
    request: Request,
    redis: Redis,
    *,
    touch: bool = True,
    db: AsyncSession | None = None,
) -> dict:
    access = request.cookies.get(ACCESS_COOKIE)
    if not access:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing access token")

    user_id, session_id = _decode_token_payload(await redis.get(f"auth:access:{access}"))
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid access token")

    user = await _load_user(redis, user_id, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")

    if session_id:
        session_payload = await redis.hgetall(_session_key(session_id))
        if not session_payload or str(session_payload.get("user_id", "")) != str(user_id):
            if db is None or not _auth_writes_to_postgres():
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="session not found")
            pg_user_id = await _resolve_pg_user_id(redis, db, user_id=user_id)
            pg_payload = await pg_get_session(db, session_id=session_id)
            if pg_user_id is None or not pg_payload or str(pg_payload.get("user_id", "")) != str(pg_user_id):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="session not found")
        if touch:
            await _touch_session(redis, session_id=session_id, request=request, db=db)

    if touch:
        await redis.hset(f"auth:user:{user_id}", mapping={"last_seen_at": _now_iso()})
        if db is not None and _auth_writes_to_postgres():
            if _auth_reads_from_postgres():
                await pg_patch_user_fields(
                    db,
                    user_id=int(user["id"]),
                    fields={
                        "last_seen_at": _now_iso(),
                        "updated_at": _now_iso(),
                    },
                )
            else:
                await _sync_user_from_redis(redis, db, user_id=user_id)
            await db.commit()

    return {
        "id": user["uuid"],
        "internal_id": int(user["id"]),
        "email": user["email"],
        "full_name": user["full_name"],
        "role": user["role"],
        "twofa_enabled": bool(user["twofa_enabled"]),
        "session_id": session_id,
    }


async def _revoke_session(
    redis: Redis,
    *,
    user_id: int,
    session_id: str,
    db: AsyncSession | None = None,
) -> bool:
    revoked_redis = False
    payload = await redis.hgetall(_session_key(session_id))
    if payload and str(payload.get("user_id", "")) == str(user_id):
        access_tokens = await redis.smembers(_session_access_key(session_id))
        refresh_tokens = await redis.smembers(_session_refresh_key(session_id))
        pipe = redis.pipeline()
        for token in access_tokens:
            pipe.delete(f"auth:access:{token}")
        for token in refresh_tokens:
            pipe.delete(f"auth:refresh:{token}")
        pipe.delete(_session_key(session_id))
        pipe.delete(_session_access_key(session_id))
        pipe.delete(_session_refresh_key(session_id))
        pipe.srem(_user_sessions_key(user_id), session_id)
        await pipe.execute()
        revoked_redis = True

    revoked_postgres = False
    if db is not None and _auth_writes_to_postgres():
        pg_user_id = await _resolve_pg_user_id(redis, db, user_id=user_id)
        if pg_user_id is not None:
            revoked_postgres = await pg_revoke_session(db, user_id=pg_user_id, session_id=session_id)
            await db.commit()

    return revoked_redis or revoked_postgres


async def _revoke_all_sessions_except(
    redis: Redis,
    *,
    user_id: int,
    keep_session_id: str | None,
    db: AsyncSession | None = None,
) -> int:
    revoked = 0
    processed: set[str] = set()
    for session_id in await redis.smembers(_user_sessions_key(user_id)):
        if keep_session_id and session_id == keep_session_id:
            continue
        if await _revoke_session(redis, user_id=user_id, session_id=session_id, db=db):
            revoked += 1
        processed.add(session_id)
    if db is not None and _auth_writes_to_postgres():
        pg_user_id = await _resolve_pg_user_id(redis, db, user_id=user_id)
        if pg_user_id is not None:
            for payload in await pg_list_active_sessions(db, user_id=pg_user_id):
                session_id = str(payload.get("id") or "").strip()
                if not session_id:
                    continue
                if keep_session_id and session_id == keep_session_id:
                    continue
                if session_id in processed:
                    continue
                if await _revoke_session(redis, user_id=user_id, session_id=session_id, db=db):
                    revoked += 1
                processed.add(session_id)
    return revoked


async def _verify_user_2fa(
    redis: Redis,
    *,
    user: dict,
    code: str | None,
    recovery_code: str | None,
    db: AsyncSession | None = None,
) -> bool:
    if code and user.get("twofa_secret") and _verify_totp(str(user["twofa_secret"]), code):
        return True
    if recovery_code:
        hashes = _parse_hashes(str(user.get("twofa_recovery_codes_hash", "")))
        if not hashes:
            return False
        target = _hash_recovery_code(recovery_code)
        if target not in hashes:
            return False
        next_hashes = [item for item in hashes if item != target]
        await redis.hset(f"auth:user:{int(user['id'])}", mapping={"twofa_recovery_codes_hash": _serialize_hashes(next_hashes)})
        if db is not None and _auth_writes_to_postgres():
            await _sync_user_from_redis(redis, db, user_id=int(user["id"]))
            await db.commit()
        return True
    return False


def _build_otpauth_url(*, email: str, secret: str) -> str:
    issuer = settings.oauth_totp_issuer
    label = quote(f"{issuer}:{email}")
    query = urlencode({"secret": secret, "issuer": issuer, "algorithm": "SHA1", "digits": 6, "period": 30})
    return f"otpauth://totp/{label}?{query}"


def _build_qr_svg_fallback(otpauth_url: str) -> str:
    escaped = html.escape(otpauth_url)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="120" viewBox="0 0 640 120">'
        '<rect width="100%" height="100%" fill="#f8fafc" stroke="#cbd5e1" />'
        '<text x="12" y="28" font-size="14" fill="#0f172a">Use this otpauth URL in your authenticator app:</text>'
        f'<text x="12" y="56" font-size="12" fill="#1e293b">{escaped}</text>'
        "</svg>"
    )


def _build_qr_svg(otpauth_url: str) -> str:
    try:
        import qrcode
        from qrcode.image.svg import SvgPathImage
    except Exception:
        return _build_qr_svg_fallback(otpauth_url)

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(otpauth_url)
    qr.make(fit=True)
    image = qr.make_image(image_factory=SvgPathImage)
    buffer = io.BytesIO()
    image.save(buffer)
    return buffer.getvalue().decode("utf-8")


async def _create_2fa_challenge(redis: Redis, *, user_id: int) -> str:
    token = _issue_token()
    await redis.setex(_challenge_key(token), TWOFA_CHALLENGE_TTL_SECONDS, str(user_id))
    return token


@router.post("/register", response_model=AuthUserResponse)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    await enforce_rate_limit(request, redis, bucket="auth-register", limit=12)
    normalized_email = payload.email.lower().strip()
    if await _get_user_by_email(redis, normalized_email, db):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already exists")

    user = await _create_user(
        redis,
        db=db,
        email=normalized_email,
        full_name=payload.full_name,
        password_hash=_hash_password(payload.password),
    )
    await _set_auth_cookies(response, user_id=int(user["id"]), redis=redis, request=request, db=db)
    return AuthUserResponse(
        id=str(user["uuid"]),
        email=user["email"],
        full_name=user["full_name"],
        role=user["role"],
        twofa_enabled=bool(user["twofa_enabled"]),
        email_confirmed=bool(user.get("email_confirmed")),
    )


@router.post("/login", response_model=AuthUserResponse | TwoFactorChallengeResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    await enforce_rate_limit(request, redis, bucket="auth-login", limit=20)
    normalized_email = payload.email.lower().strip()
    client_ip = _extract_client_ip(request)
    await _enforce_login_lockout(redis, email=normalized_email, client_ip=client_ip)

    user = await _get_user_by_email(redis, normalized_email, db)
    if user is None or not _verify_password(payload.password, str(user["password_hash"])):
        await _register_failed_login_attempt(redis, email=normalized_email, client_ip=client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    if _password_needs_rehash(str(user["password_hash"])):
        await redis.hset(
            f"auth:user:{int(user['id'])}",
            mapping={"password_hash": _hash_password(payload.password), "updated_at": _now_iso()},
        )
        await _sync_user_from_redis(redis, db, user_id=int(user["id"]))
        await db.commit()

    if user["twofa_enabled"]:
        has_second_step = bool(payload.two_factor_code or payload.recovery_code)
        if has_second_step:
            if not await _verify_user_2fa(
                redis,
                user=user,
                code=payload.two_factor_code,
                recovery_code=payload.recovery_code,
                db=db,
            ):
                await _register_failed_login_attempt(redis, email=normalized_email, client_ip=client_ip)
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid 2fa code")
        else:
            await _clear_failed_login_attempts(redis, email=normalized_email, client_ip=client_ip)
            return TwoFactorChallengeResponse(challenge_token=await _create_2fa_challenge(redis, user_id=int(user["id"])))

    await _clear_failed_login_attempts(redis, email=normalized_email, client_ip=client_ip)
    await _set_auth_cookies(response, user_id=int(user["id"]), redis=redis, request=request, db=db)
    return AuthUserResponse(
        id=str(user["uuid"]),
        email=user["email"],
        full_name=user["full_name"],
        role=user["role"],
        twofa_enabled=bool(user["twofa_enabled"]),
        email_confirmed=bool(user.get("email_confirmed")),
    )


@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    await enforce_rate_limit(request, redis, bucket="auth-refresh", limit=120)
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing refresh token")

    user_id, session_id = _decode_token_payload(await redis.get(f"auth:refresh:{refresh_token}"))
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid refresh token")
    if session_id:
        payload = await redis.hgetall(_session_key(session_id))
        if not payload or str(payload.get("user_id", "")) != str(user_id):
            pg_user_id = await _resolve_pg_user_id(redis, db, user_id=user_id)
            pg_payload = await pg_get_session(db, session_id=session_id) if pg_user_id is not None else None
            if not pg_payload or str(pg_payload.get("user_id", "")) != str(pg_user_id):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="session not found")

    if await _load_user(redis, user_id, db) is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")

    await _set_auth_cookies(
        response,
        user_id=user_id,
        redis=redis,
        request=request,
        db=db,
        session_id=session_id,
        rotate_refresh_token=refresh_token,
    )
    return {"ok": True}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    access = request.cookies.get(ACCESS_COOKIE)
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    user_id: int | None = None
    session_id: str | None = None

    if access:
        user_id, session_id = _decode_token_payload(await redis.get(f"auth:access:{access}"))
    if refresh_token and user_id is None:
        user_id, session_id = _decode_token_payload(await redis.get(f"auth:refresh:{refresh_token}"))

    if user_id is not None and session_id:
        await _revoke_session(redis, user_id=user_id, session_id=session_id, db=db)
    else:
        pipe = redis.pipeline()
        if access:
            pipe.delete(f"auth:access:{access}")
        if refresh_token:
            pipe.delete(f"auth:refresh:{refresh_token}")
        await pipe.execute()
        if _auth_writes_to_postgres():
            if access:
                await pg_revoke_session_token(db, raw_token=access, token_type="access")
            if refresh_token:
                await pg_revoke_session_token(db, raw_token=refresh_token, token_type="refresh")
            await db.commit()

    _clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me", response_model=AuthUserResponse)
async def me(
    request: Request,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    user = await _resolve_user_from_access(request, redis, touch=True, db=db)
    return AuthUserResponse(
        id=user["id"],
        email=user["email"],
        full_name=user["full_name"],
        role=user["role"],
        twofa_enabled=bool(user.get("twofa_enabled")),
        email_confirmed=bool(user.get("email_confirmed")),
    )


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    current = await _resolve_user_from_access(request, redis, touch=True, db=db)
    user_id = int(current["internal_id"])
    user = await _load_user(redis, user_id, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    if not _verify_password(payload.current_password, str(user["password_hash"])):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid current password")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="new password must differ from current password")

    await redis.hset(f"auth:user:{user_id}", mapping={"password_hash": _hash_password(payload.new_password), "updated_at": _now_iso()})
    await _sync_user_from_redis(redis, db, user_id=user_id)
    await db.commit()
    revoked = 0
    if payload.revoke_other_sessions:
        revoked = await _revoke_all_sessions_except(redis, user_id=user_id, keep_session_id=current.get("session_id"), db=db)
    return {"ok": True, "revoked_sessions": revoked}


@router.post("/password-reset/request", response_model=PasswordResetRequestResponse)
async def request_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    await enforce_rate_limit(request, redis, bucket="auth-password-reset-request", limit=20)
    normalized_email = payload.email.lower().strip()
    user = await _get_user_by_email(redis, normalized_email, db)
    debug_token: str | None = None
    ttl_seconds = max(60, int(settings.auth_password_reset_ttl_seconds))

    if user is not None:
        redis_user_id = int(user["id"])
        pg_user_id = await _resolve_pg_user_id(redis, db, user_id=redis_user_id)
        if pg_user_id is None:
            synced_id = await _sync_user_from_redis(redis, db, user_id=redis_user_id)
            if synced_id is not None:
                pg_user_id = int(synced_id)
        if pg_user_id is not None:
            issued_token = _issue_token()
            await pg_create_password_reset_token(
                db,
                user_id=pg_user_id,
                raw_token=issued_token,
                expires_at=datetime.now(UTC) + timedelta(seconds=ttl_seconds),
            )
            await db.commit()
            if settings.environment == "local" or settings.auth_password_reset_debug_return_token:
                debug_token = issued_token

    if debug_token:
        return PasswordResetRequestResponse(ok=True, expires_in=ttl_seconds, reset_token=debug_token)
    return PasswordResetRequestResponse(ok=True)


@router.post("/password-reset/confirm")
async def confirm_password_reset(
    payload: PasswordResetConfirmRequest,
    request: Request,
    response: Response,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    await enforce_rate_limit(request, redis, bucket="auth-password-reset-confirm", limit=30)
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid reset token")

    pg_user_id = await pg_consume_password_reset_token(db, raw_token=token)
    if pg_user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired reset token")

    redis_user_id = await _ensure_redis_user_from_postgres(redis, db, pg_user_id=pg_user_id)
    if redis_user_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")

    await redis.hset(
        f"auth:user:{redis_user_id}",
        mapping={
            "password_hash": _hash_password(payload.new_password),
            "updated_at": _now_iso(),
        },
    )
    await _sync_user_from_redis(redis, db, user_id=redis_user_id)
    revoked = await _revoke_all_sessions_except(redis, user_id=redis_user_id, keep_session_id=None, db=db)
    await db.commit()
    _clear_auth_cookies(response)
    return {"ok": True, "revoked_sessions": revoked}


@router.post("/email-confirmation/request", response_model=EmailConfirmationRequestResponse)
async def request_email_confirmation(
    request: Request,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    await enforce_rate_limit(request, redis, bucket="auth-email-confirm-request", limit=20)
    current = await _resolve_user_from_access(request, redis, touch=True, db=db)
    user_id = int(current["internal_id"])
    user = await _load_user(redis, user_id, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")

    ttl_seconds = max(300, int(settings.auth_email_confirmation_ttl_seconds))
    if bool(user.get("email_confirmed")):
        return EmailConfirmationRequestResponse(ok=True, expires_in=ttl_seconds)

    confirmation_token = _issue_token()
    await redis.setex(_email_confirmation_key(confirmation_token), ttl_seconds, str(user_id))

    debug_token: str | None = None
    if settings.environment == "local" or settings.auth_email_confirmation_debug_return_token:
        debug_token = confirmation_token
    return EmailConfirmationRequestResponse(ok=True, expires_in=ttl_seconds, confirmation_token=debug_token)


@router.post("/email-confirmation/confirm")
async def confirm_email(
    payload: EmailConfirmationConfirmRequest,
    request: Request,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    await enforce_rate_limit(request, redis, bucket="auth-email-confirm", limit=30)
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid email confirmation token")

    raw_user_id = await redis.get(_email_confirmation_key(token))
    if not raw_user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired email confirmation token")
    try:
        user_id = int(raw_user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid email confirmation token") from exc

    now_iso = _now_iso()
    await redis.hset(
        f"auth:user:{user_id}",
        mapping={
            "email_confirmed": "1",
            "email_confirmed_at": now_iso,
            "updated_at": now_iso,
        },
    )
    await redis.delete(_email_confirmation_key(token))
    await _sync_user_from_redis(redis, db, user_id=user_id)
    await db.commit()
    return {"ok": True, "email_confirmed": True}


@router.get("/sessions", response_model=list[SessionInfo])
async def list_sessions(
    request: Request,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    current = await _resolve_user_from_access(request, redis, touch=True, db=db)
    user_id = int(current["internal_id"])
    current_session_id = current.get("session_id")
    sessions: list[SessionInfo] = []
    stale: list[str] = []

    if _auth_reads_from_postgres() and _auth_writes_to_postgres():
        pg_user_id = await _resolve_pg_user_id(redis, db, user_id=user_id)
        if pg_user_id is not None:
            for payload in await pg_list_active_sessions(db, user_id=pg_user_id):
                session_value = str(payload.get("id") or "")
                created_at = str(payload.get("created_at") or _now_iso())
                last_seen_at = str(payload.get("last_seen_at") or created_at)
                sessions.append(
                    SessionInfo(
                        id=session_value,
                        device=str(payload.get("device") or "unknown device"),
                        ip_address=str(payload.get("ip_address") or "unknown"),
                        location=str(payload.get("location") or "unknown"),
                        created_at=created_at,
                        last_seen_at=last_seen_at,
                        is_current=bool(current_session_id and session_value == current_session_id),
                    )
                )
            sessions.sort(key=lambda item: (item.last_seen_at, item.created_at, item.id), reverse=True)
            return sessions

    for session_id in await redis.smembers(_user_sessions_key(user_id)):
        payload = await redis.hgetall(_session_key(session_id))
        if not payload or str(payload.get("user_id", "")) != str(user_id):
            stale.append(session_id)
            continue
        created_at = str(payload.get("created_at") or _now_iso())
        last_seen_at = str(payload.get("last_seen_at") or created_at)
        sessions.append(
            SessionInfo(
                id=str(payload.get("id") or session_id),
                device=str(payload.get("device") or "unknown device"),
                ip_address=str(payload.get("ip_address") or "unknown"),
                location=str(payload.get("location") or "unknown"),
                created_at=created_at,
                last_seen_at=last_seen_at,
                is_current=bool(current_session_id and session_id == current_session_id),
            )
        )

    if stale:
        await redis.srem(_user_sessions_key(user_id), *stale)

    if not sessions and _auth_writes_to_postgres():
        pg_user_id = await _resolve_pg_user_id(redis, db, user_id=user_id)
        if pg_user_id is not None:
            for payload in await pg_list_active_sessions(db, user_id=pg_user_id):
                session_value = str(payload.get("id") or "")
                created_at = str(payload.get("created_at") or _now_iso())
                last_seen_at = str(payload.get("last_seen_at") or created_at)
                sessions.append(
                    SessionInfo(
                        id=session_value,
                        device=str(payload.get("device") or "unknown device"),
                        ip_address=str(payload.get("ip_address") or "unknown"),
                        location=str(payload.get("location") or "unknown"),
                        created_at=created_at,
                        last_seen_at=last_seen_at,
                        is_current=bool(current_session_id and session_value == current_session_id),
                    )
                )

    sessions.sort(key=lambda item: (item.last_seen_at, item.created_at, item.id), reverse=True)
    return sessions


@router.delete("/sessions/{session_id}")
async def revoke_session(
    request: Request,
    response: Response,
    session_id: str = Path(..., pattern=r"^[0-9a-fA-F-]{32,36}$"),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    current = await _resolve_user_from_access(request, redis, touch=True, db=db)
    user_id = int(current["internal_id"])
    normalized = _normalize_uuid(session_id) or session_id
    if not await _revoke_session(redis, user_id=user_id, session_id=normalized, db=db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    if current.get("session_id") == normalized:
        _clear_auth_cookies(response)
    return {"ok": True}


@router.delete("/sessions", response_model=SessionBulkRevokeResponse)
async def revoke_other_sessions(
    request: Request,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    current = await _resolve_user_from_access(request, redis, touch=True, db=db)
    revoked = await _revoke_all_sessions_except(
        redis,
        user_id=int(current["internal_id"]),
        keep_session_id=current.get("session_id"),
        db=db,
    )
    return SessionBulkRevokeResponse(revoked=revoked)


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
async def setup_twofa(
    request: Request,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    current = await _resolve_user_from_access(request, redis, touch=True, db=db)
    user_id = int(current["internal_id"])
    user = await _load_user(redis, user_id, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")

    secret = _build_totp_secret()
    recovery_codes = _issue_recovery_codes()
    await redis.hset(
        f"auth:user:{user_id}",
        mapping={
            "twofa_pending_secret": secret,
            "twofa_pending_recovery_codes_hash": _serialize_hashes([_hash_recovery_code(code) for code in recovery_codes]),
        },
    )
    await _sync_user_from_redis(redis, db, user_id=user_id)
    await db.commit()

    otpauth_url = _build_otpauth_url(email=user["email"], secret=secret)
    return TwoFactorSetupResponse(
        secret=secret,
        qr_svg=_build_qr_svg(otpauth_url),
        recovery_codes=recovery_codes,
        otpauth_url=otpauth_url,
    )


@router.post("/2fa/verify", response_model=AuthUserResponse | TwoFactorStatusResponse)
async def verify_twofa(
    payload: TwoFactorVerifyRequest,
    request: Request,
    response: Response,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    await enforce_rate_limit(request, redis, bucket="auth-2fa-verify", limit=60)
    client_ip = _extract_client_ip(request)
    if payload.challenge_token:
        challenge_raw = await redis.get(_challenge_key(payload.challenge_token.strip()))
        if not challenge_raw:
            await _register_failed_login_attempt(redis, email="", client_ip=client_ip)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid 2fa challenge")
        try:
            user_id = int(challenge_raw)
        except ValueError as exc:
            await _register_failed_login_attempt(redis, email="", client_ip=client_ip)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid 2fa challenge") from exc

        user = await _load_user(redis, user_id, db)
        if user is None or not user["twofa_enabled"]:
            await _register_failed_login_attempt(redis, email="", client_ip=client_ip)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="2fa not enabled")
        if not (payload.code or payload.recovery_code):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="code or recovery_code is required")
        if not await _verify_user_2fa(redis, user=user, code=payload.code, recovery_code=payload.recovery_code, db=db):
            await _register_failed_login_attempt(redis, email=str(user["email"]), client_ip=client_ip)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid 2fa code")

        await _clear_failed_login_attempts(redis, email=str(user["email"]), client_ip=client_ip)
        await redis.delete(_challenge_key(payload.challenge_token.strip()))
        await _set_auth_cookies(response, user_id=user_id, redis=redis, request=request, db=db)
        return AuthUserResponse(
            id=str(user["uuid"]),
            email=user["email"],
            full_name=user["full_name"],
            role=user["role"],
            twofa_enabled=bool(user["twofa_enabled"]),
            email_confirmed=bool(user.get("email_confirmed")),
        )

    current = await _resolve_user_from_access(request, redis, touch=True, db=db)
    user_id = int(current["internal_id"])
    user = await _load_user(redis, user_id, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")

    pending_secret = str(user.get("twofa_pending_secret", "")).strip()
    pending_hashes = str(user.get("twofa_pending_recovery_codes_hash", "")).strip()
    if not pending_secret:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="2fa setup not initialized")
    if not payload.code:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="code is required")
    if not _verify_totp(pending_secret, payload.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid 2fa code")

    await redis.hset(
        f"auth:user:{user_id}",
        mapping={
            "twofa_enabled": "1",
            "twofa_secret": pending_secret,
            "twofa_recovery_codes_hash": pending_hashes,
            "twofa_pending_secret": "",
            "twofa_pending_recovery_codes_hash": "",
            "updated_at": _now_iso(),
        },
    )
    await _sync_user_from_redis(redis, db, user_id=user_id)
    await db.commit()
    return TwoFactorStatusResponse(enabled=True)


@router.delete("/2fa", response_model=TwoFactorStatusResponse)
async def disable_twofa(
    request: Request,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    current = await _resolve_user_from_access(request, redis, touch=True, db=db)
    await redis.hset(
        f"auth:user:{int(current['internal_id'])}",
        mapping={
            "twofa_enabled": "0",
            "twofa_secret": "",
            "twofa_recovery_codes_hash": "",
            "twofa_pending_secret": "",
            "twofa_pending_recovery_codes_hash": "",
            "updated_at": _now_iso(),
        },
    )
    await _sync_user_from_redis(redis, db, user_id=int(current["internal_id"]))
    await db.commit()
    return TwoFactorStatusResponse(enabled=False)


def _normalize_oauth_provider(provider: str) -> str:
    normalized = provider.strip().lower()
    if normalized not in SUPPORTED_OAUTH_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unsupported oauth provider")
    return normalized


def _oauth_enabled(provider: str) -> bool:
    if provider == "google":
        return bool(settings.oauth_google_client_id and settings.oauth_google_client_secret)
    if provider == "facebook":
        return bool(settings.oauth_facebook_client_id and settings.oauth_facebook_client_secret)
    return False


def _normalize_next_path(next_path: str | None, *, fallback: str = "/profile") -> str:
    candidate = str(next_path or "").strip()
    if not candidate.startswith("/") or candidate.startswith("//"):
        return fallback
    return candidate


def _frontend_redirect_url(path: str, *, params: dict[str, str] | None = None) -> str:
    base = str(settings.next_public_app_url or "http://localhost").rstrip("/")
    normalized = _normalize_next_path(path)
    if not params:
        return f"{base}{normalized}"
    query = urlencode(params)
    return f"{base}{normalized}?{query}" if query else f"{base}{normalized}"


def _oauth_authorization_endpoint(provider: str) -> str:
    if provider == "google":
        return "https://accounts.google.com/o/oauth2/v2/auth"
    if provider == "facebook":
        return "https://www.facebook.com/v20.0/dialog/oauth"
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unsupported oauth provider")


def _build_oauth_url(*, provider: str, redirect_uri: str, state: str) -> str:
    endpoint = _oauth_authorization_endpoint(provider)
    if provider == "google":
        params = {
            "client_id": settings.oauth_google_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "select_account",
            "state": state,
        }
        return f"{endpoint}?{urlencode(params)}"
    params = {
        "client_id": settings.oauth_facebook_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "email,public_profile",
        "state": state,
    }
    return f"{endpoint}?{urlencode(params)}"


async def _exchange_google(code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.oauth_google_client_id,
                "client_secret": settings.oauth_google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_response.status_code >= 400:
            raise HTTPException(status_code=502, detail="google token exchange failed")
        access_token = str(token_response.json().get("access_token", "")).strip()
        if not access_token:
            raise HTTPException(status_code=502, detail="google access token missing")
        profile_response = await client.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if profile_response.status_code >= 400:
            raise HTTPException(status_code=502, detail="google user profile request failed")
        profile = profile_response.json()
    email = str(profile.get("email", "")).strip().lower()
    provider_user_id = str(profile.get("sub", "")).strip()
    full_name = str(profile.get("name", "")).strip() or (email.split("@")[0] if email else "")
    if not email or not provider_user_id:
        raise HTTPException(status_code=400, detail="google profile missing required fields")
    return {"provider_user_id": provider_user_id, "email": email, "full_name": full_name}


async def _exchange_facebook(code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_response = await client.get(
            "https://graph.facebook.com/v20.0/oauth/access_token",
            params={
                "client_id": settings.oauth_facebook_client_id,
                "client_secret": settings.oauth_facebook_client_secret,
                "redirect_uri": redirect_uri,
                "code": code,
            },
        )
        if token_response.status_code >= 400:
            raise HTTPException(status_code=502, detail="facebook token exchange failed")
        access_token = str(token_response.json().get("access_token", "")).strip()
        if not access_token:
            raise HTTPException(status_code=502, detail="facebook access token missing")
        profile_response = await client.get(
            "https://graph.facebook.com/me",
            params={"fields": "id,name,email", "access_token": access_token},
        )
        if profile_response.status_code >= 400:
            raise HTTPException(status_code=502, detail="facebook user profile request failed")
        profile = profile_response.json()
    email = str(profile.get("email", "")).strip().lower()
    provider_user_id = str(profile.get("id", "")).strip()
    full_name = str(profile.get("name", "")).strip() or (email.split("@")[0] if email else "")
    if not provider_user_id:
        raise HTTPException(status_code=400, detail="facebook profile missing id")
    if not email:
        raise HTTPException(status_code=400, detail="facebook profile missing email")
    return {"provider_user_id": provider_user_id, "email": email, "full_name": full_name}


async def _exchange_oauth_code(provider: str, code: str, redirect_uri: str) -> dict:
    if provider == "google":
        return await _exchange_google(code, redirect_uri)
    return await _exchange_facebook(code, redirect_uri)


async def _link_oauth_identity(
    redis: Redis,
    *,
    provider: str,
    provider_user_id: str,
    user_id: int,
    db: AsyncSession | None = None,
) -> None:
    await redis.set(_oauth_identity_key(provider, provider_user_id), str(user_id))
    await redis.sadd(f"auth:user:{user_id}:oauth_providers", provider)
    if db is not None and _auth_writes_to_postgres():
        pg_user_id = await _resolve_pg_user_id(redis, db, user_id=user_id)
        if pg_user_id is not None:
            await pg_upsert_oauth_identity(
                db,
                provider=provider,
                provider_user_id=provider_user_id,
                user_id=pg_user_id,
            )
            await db.commit()


async def _resolve_or_create_oauth_user(
    redis: Redis,
    *,
    provider: str,
    provider_user_id: str,
    email: str,
    full_name: str,
    db: AsyncSession | None = None,
) -> dict:
    mapped = await redis.get(_oauth_identity_key(provider, provider_user_id))
    if not mapped and db is not None and _auth_writes_to_postgres():
        mapped_id = await pg_get_oauth_identity_user_id(db, provider=provider, provider_user_id=provider_user_id)
        mapped = str(mapped_id) if mapped_id is not None else None
    if mapped:
        try:
            existing = await _load_user(redis, int(mapped), db)
        except ValueError:
            existing = None
        if existing is not None:
            return existing

    existing_by_email = await _get_user_by_email(redis, email, db)
    if existing_by_email is not None:
        await _link_oauth_identity(
            redis,
            provider=provider,
            provider_user_id=provider_user_id,
            user_id=int(existing_by_email["id"]),
            db=db,
        )
        return existing_by_email

    created = await _create_user(
        redis,
        db=db,
        email=email,
        full_name=full_name,
        password_hash=_hash_password(secrets.token_urlsafe(48)),
        role="user",
        extra_fields={"auth_provider": provider, "email_confirmed": "1", "email_confirmed_at": _now_iso()},
    )
    await _link_oauth_identity(
        redis,
        provider=provider,
        provider_user_id=provider_user_id,
        user_id=int(created["id"]),
        db=db,
    )
    return created


@router.get("/oauth/providers", response_model=OAuthProvidersResponse)
async def oauth_providers(request: Request):
    providers = [
        OAuthProviderInfo(
            provider=provider,
            enabled=_oauth_enabled(provider),
            authorization_endpoint=str(request.url_for("oauth_start", provider=provider)),
        )
        for provider in SUPPORTED_OAUTH_PROVIDERS
    ]
    return OAuthProvidersResponse(providers=providers)


@router.get("/oauth/{provider}", name="oauth_start")
async def oauth_start(
    request: Request,
    provider: str,
    next_path: str = Query(default="/profile", alias="next"),
    redis: Redis = Depends(get_redis),
):
    normalized_provider = _normalize_oauth_provider(provider)
    if not _oauth_enabled(normalized_provider):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="oauth provider is not configured")

    state = secrets.token_urlsafe(32)
    state_key = _oauth_state_key(normalized_provider, state)
    await redis.hset(state_key, mapping={"next": _normalize_next_path(next_path), "created_at": _now_iso()})
    await redis.expire(state_key, OAUTH_STATE_TTL_SECONDS)

    redirect_uri = str(request.url_for("oauth_callback", provider=normalized_provider))
    return RedirectResponse(url=_build_oauth_url(provider=normalized_provider, redirect_uri=redirect_uri, state=state), status_code=status.HTTP_302_FOUND)


@router.get("/oauth/{provider}/callback", name="oauth_callback")
async def oauth_callback(
    request: Request,
    provider: str,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
):
    normalized_provider = _normalize_oauth_provider(provider)
    if not _oauth_enabled(normalized_provider):
        return RedirectResponse(url=_frontend_redirect_url("/login", params={"oauth_error": "provider_not_configured"}), status_code=status.HTTP_302_FOUND)

    if error:
        return RedirectResponse(url=_frontend_redirect_url("/login", params={"oauth_error": "access_denied"}), status_code=status.HTTP_302_FOUND)
    if not code or not state:
        return RedirectResponse(url=_frontend_redirect_url("/login", params={"oauth_error": "missing_code_or_state"}), status_code=status.HTTP_302_FOUND)

    state_key = _oauth_state_key(normalized_provider, state)
    state_payload = await redis.hgetall(state_key)
    if not state_payload:
        return RedirectResponse(url=_frontend_redirect_url("/login", params={"oauth_error": "invalid_state"}), status_code=status.HTTP_302_FOUND)
    await redis.delete(state_key)

    next_path = _normalize_next_path(state_payload.get("next"), fallback="/profile")
    redirect_uri = str(request.url_for("oauth_callback", provider=normalized_provider))
    try:
        profile = await _exchange_oauth_code(normalized_provider, code, redirect_uri)
    except HTTPException as exc:
        return RedirectResponse(url=_frontend_redirect_url("/login", params={"oauth_error": str(exc.detail)}), status_code=status.HTTP_302_FOUND)

    user = await _resolve_or_create_oauth_user(
        redis,
        provider=normalized_provider,
        provider_user_id=str(profile["provider_user_id"]),
        email=str(profile["email"]),
        full_name=str(profile["full_name"]),
        db=db,
    )

    redirect = RedirectResponse(url=_frontend_redirect_url(next_path), status_code=status.HTTP_302_FOUND)
    await _set_auth_cookies(redirect, user_id=int(user["id"]), redis=redis, request=request, db=db)
    return redirect


async def get_current_user(
    request: Request,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    return await _resolve_user_from_access(request, redis, touch=True, db=db)


async def ensure_seed_admin(redis: Redis, db: AsyncSession | None = None) -> dict | None:
    if not settings.admin_seed_enabled:
        return None
    if not settings.admin_email or not settings.admin_password:
        return None

    email = settings.admin_email.lower().strip()
    existing = await _get_user_by_email(redis, email, db)
    if existing is not None:
        await redis.hset(
            f"auth:user:{existing['id']}",
            mapping={
                "full_name": settings.admin_full_name,
                "display_name": settings.admin_full_name,
                "role": settings.admin_role,
                "updated_at": _now_iso(),
            },
        )
        if db is not None and _auth_writes_to_postgres():
            await _sync_user_from_redis(redis, db, user_id=int(existing["id"]))
            await db.commit()
        refreshed = await _load_user(redis, int(existing["id"]), db)
        if refreshed is None:
            return None
        return {
            "id": refreshed["uuid"],
            "email": refreshed["email"],
            "full_name": refreshed["full_name"],
            "role": refreshed["role"],
        }

    created = await _create_user(
        redis,
        db=db,
        email=email,
        full_name=settings.admin_full_name,
        password_hash=_hash_password(settings.admin_password),
        role=settings.admin_role,
    )
    return {
        "id": created["uuid"],
        "email": created["email"],
        "full_name": created["full_name"],
        "role": created["role"],
    }
