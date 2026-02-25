from __future__ import annotations

import base64
import hashlib
import hmac
import html
import secrets
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import quote, urlencode
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from app.api.deps import get_redis
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
ROLE_COOKIE = "user_role"
ACCESS_TTL_SECONDS = 60 * 15
REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30
TWOFA_CHALLENGE_TTL_SECONDS = 60 * 5
OAUTH_STATE_TTL_SECONDS = 60 * 10
SUPPORTED_OAUTH_PROVIDERS = ("google", "facebook")


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


class AuthUserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str = "user"
    twofa_enabled: bool = False


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


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


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


def _oauth_state_key(provider: str, state: str) -> str:
    return f"auth:oauth:state:{provider}:{state}"


def _oauth_identity_key(provider: str, provider_user_id: str) -> str:
    return f"auth:oauth:{provider}:{provider_user_id}"


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


async def _load_user(redis: Redis, user_id: int) -> dict | None:
    user_key = f"auth:user:{user_id}"
    payload = await redis.hgetall(user_key)
    if not payload:
        return None
    user_uuid = await _ensure_user_uuid(redis, user_key=user_key, payload=payload)
    full_name = str(payload.get("full_name", "")).strip() or str(payload.get("display_name", "")).strip() or str(payload.get("email", "")).split("@")[0]
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
    }


async def _get_user_by_email(redis: Redis, email: str) -> dict | None:
    user_id = await redis.get(f"auth:user:email:{email.lower()}")
    if not user_id:
        return None
    try:
        return await _load_user(redis, int(user_id))
    except ValueError:
        return None


async def _create_user(
    redis: Redis,
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
    }
    if extra_fields:
        mapping.update({key: str(value) for key, value in extra_fields.items()})
    await redis.hset(f"auth:user:{user_id}", mapping=mapping)
    await redis.set(f"auth:user:email:{normalized_email}", str(user_id))
    user = await _load_user(redis, int(user_id))
    if user is None:
        raise HTTPException(status_code=500, detail="failed to create user")
    return user


async def _create_session(redis: Redis, *, user_id: int, request: Request) -> str:
    session_id = str(uuid4())
    now = _now_iso()
    await redis.hset(
        _session_key(session_id),
        mapping={
            "id": session_id,
            "user_id": str(user_id),
            "device": _extract_device(request),
            "ip_address": _extract_client_ip(request),
            "location": _extract_location(request),
            "created_at": now,
            "last_seen_at": now,
        },
    )
    await redis.sadd(_user_sessions_key(user_id), session_id)
    return session_id


async def _touch_session(redis: Redis, *, session_id: str, request: Request) -> None:
    await redis.hset(
        _session_key(session_id),
        mapping={
            "last_seen_at": _now_iso(),
            "device": _extract_device(request),
            "ip_address": _extract_client_ip(request),
            "location": _extract_location(request),
        },
    )


async def _set_auth_cookies(
    response: Response,
    *,
    user_id: int,
    redis: Redis,
    request: Request,
    session_id: str | None = None,
    rotate_refresh_token: str | None = None,
) -> str:
    if session_id is not None:
        payload = await redis.hgetall(_session_key(session_id))
        if not payload or str(payload.get("user_id", "")) != str(user_id):
            session_id = await _create_session(redis, user_id=user_id, request=request)
        else:
            await _touch_session(redis, session_id=session_id, request=request)
    else:
        session_id = await _create_session(redis, user_id=user_id, request=request)

    access = _issue_token()
    refresh = _issue_token()
    encoded = _encode_token_payload(user_id, session_id)
    role_payload = await redis.hgetall(f"auth:user:{user_id}")
    role = str(role_payload.get("role", "user")) if role_payload else "user"

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


async def _resolve_user_from_access(request: Request, redis: Redis, *, touch: bool = True) -> dict:
    access = request.cookies.get(ACCESS_COOKIE)
    if not access:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing access token")

    user_id, session_id = _decode_token_payload(await redis.get(f"auth:access:{access}"))
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid access token")

    user = await _load_user(redis, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")

    if session_id:
        session_payload = await redis.hgetall(_session_key(session_id))
        if not session_payload or str(session_payload.get("user_id", "")) != str(user_id):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="session not found")
        if touch:
            await _touch_session(redis, session_id=session_id, request=request)

    if touch:
        await redis.hset(f"auth:user:{user_id}", mapping={"last_seen_at": _now_iso()})

    return {
        "id": user["uuid"],
        "internal_id": int(user["id"]),
        "email": user["email"],
        "full_name": user["full_name"],
        "role": user["role"],
        "twofa_enabled": bool(user["twofa_enabled"]),
        "session_id": session_id,
    }


async def _revoke_session(redis: Redis, *, user_id: int, session_id: str) -> bool:
    payload = await redis.hgetall(_session_key(session_id))
    if not payload or str(payload.get("user_id", "")) != str(user_id):
        return False

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
    return True


async def _revoke_all_sessions_except(redis: Redis, *, user_id: int, keep_session_id: str | None) -> int:
    revoked = 0
    for session_id in await redis.smembers(_user_sessions_key(user_id)):
        if keep_session_id and session_id == keep_session_id:
            continue
        if await _revoke_session(redis, user_id=user_id, session_id=session_id):
            revoked += 1
    return revoked


async def _verify_user_2fa(redis: Redis, *, user: dict, code: str | None, recovery_code: str | None) -> bool:
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


async def _create_2fa_challenge(redis: Redis, *, user_id: int) -> str:
    token = _issue_token()
    await redis.setex(_challenge_key(token), TWOFA_CHALLENGE_TTL_SECONDS, str(user_id))
    return token


@router.post("/register", response_model=AuthUserResponse)
async def register(payload: RegisterRequest, request: Request, response: Response, redis: Redis = Depends(get_redis)):
    normalized_email = payload.email.lower().strip()
    if await _get_user_by_email(redis, normalized_email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already exists")

    user = await _create_user(
        redis,
        email=normalized_email,
        full_name=payload.full_name,
        password_hash=_hash_password(payload.password),
    )
    await _set_auth_cookies(response, user_id=int(user["id"]), redis=redis, request=request)
    return AuthUserResponse(
        id=str(user["uuid"]),
        email=user["email"],
        full_name=user["full_name"],
        role=user["role"],
        twofa_enabled=bool(user["twofa_enabled"]),
    )


@router.post("/login", response_model=AuthUserResponse | TwoFactorChallengeResponse)
async def login(payload: LoginRequest, request: Request, response: Response, redis: Redis = Depends(get_redis)):
    user = await _get_user_by_email(redis, payload.email.lower().strip())
    if user is None or user["password_hash"] != _hash_password(payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    if user["twofa_enabled"]:
        has_second_step = bool(payload.two_factor_code or payload.recovery_code)
        if has_second_step:
            if not await _verify_user_2fa(redis, user=user, code=payload.two_factor_code, recovery_code=payload.recovery_code):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid 2fa code")
        else:
            return TwoFactorChallengeResponse(challenge_token=await _create_2fa_challenge(redis, user_id=int(user["id"])))

    await _set_auth_cookies(response, user_id=int(user["id"]), redis=redis, request=request)
    return AuthUserResponse(
        id=str(user["uuid"]),
        email=user["email"],
        full_name=user["full_name"],
        role=user["role"],
        twofa_enabled=bool(user["twofa_enabled"]),
    )


@router.post("/refresh")
async def refresh(request: Request, response: Response, redis: Redis = Depends(get_redis)):
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing refresh token")

    user_id, session_id = _decode_token_payload(await redis.get(f"auth:refresh:{refresh_token}"))
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid refresh token")
    if session_id:
        payload = await redis.hgetall(_session_key(session_id))
        if not payload or str(payload.get("user_id", "")) != str(user_id):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="session not found")

    if await _load_user(redis, user_id) is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")

    await _set_auth_cookies(
        response,
        user_id=user_id,
        redis=redis,
        request=request,
        session_id=session_id,
        rotate_refresh_token=refresh_token,
    )
    return {"ok": True}


@router.post("/logout")
async def logout(request: Request, response: Response, redis: Redis = Depends(get_redis)):
    access = request.cookies.get(ACCESS_COOKIE)
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    user_id: int | None = None
    session_id: str | None = None

    if access:
        user_id, session_id = _decode_token_payload(await redis.get(f"auth:access:{access}"))
    if refresh_token and user_id is None:
        user_id, session_id = _decode_token_payload(await redis.get(f"auth:refresh:{refresh_token}"))

    if user_id is not None and session_id:
        await _revoke_session(redis, user_id=user_id, session_id=session_id)
    else:
        pipe = redis.pipeline()
        if access:
            pipe.delete(f"auth:access:{access}")
        if refresh_token:
            pipe.delete(f"auth:refresh:{refresh_token}")
        await pipe.execute()

    _clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me", response_model=AuthUserResponse)
async def me(request: Request, redis: Redis = Depends(get_redis)):
    user = await _resolve_user_from_access(request, redis, touch=True)
    return AuthUserResponse(
        id=user["id"],
        email=user["email"],
        full_name=user["full_name"],
        role=user["role"],
        twofa_enabled=bool(user.get("twofa_enabled")),
    )


@router.post("/change-password")
async def change_password(payload: ChangePasswordRequest, request: Request, redis: Redis = Depends(get_redis)):
    current = await _resolve_user_from_access(request, redis, touch=True)
    user_id = int(current["internal_id"])
    user = await _load_user(redis, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    if user["password_hash"] != _hash_password(payload.current_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid current password")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="new password must differ from current password")

    await redis.hset(f"auth:user:{user_id}", mapping={"password_hash": _hash_password(payload.new_password), "updated_at": _now_iso()})
    revoked = 0
    if payload.revoke_other_sessions:
        revoked = await _revoke_all_sessions_except(redis, user_id=user_id, keep_session_id=current.get("session_id"))
    return {"ok": True, "revoked_sessions": revoked}


@router.get("/sessions", response_model=list[SessionInfo])
async def list_sessions(request: Request, redis: Redis = Depends(get_redis)):
    current = await _resolve_user_from_access(request, redis, touch=True)
    user_id = int(current["internal_id"])
    current_session_id = current.get("session_id")
    sessions: list[SessionInfo] = []
    stale: list[str] = []

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

    sessions.sort(key=lambda item: (item.last_seen_at, item.created_at, item.id), reverse=True)
    return sessions


@router.delete("/sessions/{session_id}")
async def revoke_session(
    request: Request,
    response: Response,
    session_id: str = Path(..., pattern=r"^[0-9a-fA-F-]{32,36}$"),
    redis: Redis = Depends(get_redis),
):
    current = await _resolve_user_from_access(request, redis, touch=True)
    user_id = int(current["internal_id"])
    normalized = _normalize_uuid(session_id) or session_id
    if not await _revoke_session(redis, user_id=user_id, session_id=normalized):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    if current.get("session_id") == normalized:
        _clear_auth_cookies(response)
    return {"ok": True}


@router.delete("/sessions", response_model=SessionBulkRevokeResponse)
async def revoke_other_sessions(request: Request, redis: Redis = Depends(get_redis)):
    current = await _resolve_user_from_access(request, redis, touch=True)
    revoked = await _revoke_all_sessions_except(
        redis,
        user_id=int(current["internal_id"]),
        keep_session_id=current.get("session_id"),
    )
    return SessionBulkRevokeResponse(revoked=revoked)


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
async def setup_twofa(request: Request, redis: Redis = Depends(get_redis)):
    current = await _resolve_user_from_access(request, redis, touch=True)
    user_id = int(current["internal_id"])
    user = await _load_user(redis, user_id)
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

    otpauth_url = _build_otpauth_url(email=user["email"], secret=secret)
    return TwoFactorSetupResponse(
        secret=secret,
        qr_svg=_build_qr_svg_fallback(otpauth_url),
        recovery_codes=recovery_codes,
        otpauth_url=otpauth_url,
    )


@router.post("/2fa/verify", response_model=AuthUserResponse | TwoFactorStatusResponse)
async def verify_twofa(payload: TwoFactorVerifyRequest, request: Request, response: Response, redis: Redis = Depends(get_redis)):
    if payload.challenge_token:
        challenge_raw = await redis.get(_challenge_key(payload.challenge_token.strip()))
        if not challenge_raw:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid 2fa challenge")
        try:
            user_id = int(challenge_raw)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid 2fa challenge") from exc

        user = await _load_user(redis, user_id)
        if user is None or not user["twofa_enabled"]:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="2fa not enabled")
        if not (payload.code or payload.recovery_code):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="code or recovery_code is required")
        if not await _verify_user_2fa(redis, user=user, code=payload.code, recovery_code=payload.recovery_code):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid 2fa code")

        await redis.delete(_challenge_key(payload.challenge_token.strip()))
        await _set_auth_cookies(response, user_id=user_id, redis=redis, request=request)
        return AuthUserResponse(
            id=str(user["uuid"]),
            email=user["email"],
            full_name=user["full_name"],
            role=user["role"],
            twofa_enabled=bool(user["twofa_enabled"]),
        )

    current = await _resolve_user_from_access(request, redis, touch=True)
    user_id = int(current["internal_id"])
    user = await _load_user(redis, user_id)
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
    return TwoFactorStatusResponse(enabled=True)


@router.delete("/2fa", response_model=TwoFactorStatusResponse)
async def disable_twofa(request: Request, redis: Redis = Depends(get_redis)):
    current = await _resolve_user_from_access(request, redis, touch=True)
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


async def _link_oauth_identity(redis: Redis, *, provider: str, provider_user_id: str, user_id: int) -> None:
    await redis.set(_oauth_identity_key(provider, provider_user_id), str(user_id))
    await redis.sadd(f"auth:user:{user_id}:oauth_providers", provider)


async def _resolve_or_create_oauth_user(redis: Redis, *, provider: str, provider_user_id: str, email: str, full_name: str) -> dict:
    mapped = await redis.get(_oauth_identity_key(provider, provider_user_id))
    if mapped:
        try:
            existing = await _load_user(redis, int(mapped))
        except ValueError:
            existing = None
        if existing is not None:
            return existing

    existing_by_email = await _get_user_by_email(redis, email)
    if existing_by_email is not None:
        await _link_oauth_identity(redis, provider=provider, provider_user_id=provider_user_id, user_id=int(existing_by_email["id"]))
        return existing_by_email

    created = await _create_user(
        redis,
        email=email,
        full_name=full_name,
        password_hash=_hash_password(secrets.token_urlsafe(48)),
        role="user",
        extra_fields={"auth_provider": provider},
    )
    await _link_oauth_identity(redis, provider=provider, provider_user_id=provider_user_id, user_id=int(created["id"]))
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
    )

    redirect = RedirectResponse(url=_frontend_redirect_url(next_path), status_code=status.HTTP_302_FOUND)
    await _set_auth_cookies(redirect, user_id=int(user["id"]), redis=redis, request=request)
    return redirect


async def get_current_user(request: Request, redis: Redis = Depends(get_redis)) -> dict:
    return await _resolve_user_from_access(request, redis, touch=True)


async def ensure_seed_admin(redis: Redis) -> dict | None:
    if not settings.admin_seed_enabled:
        return None
    if not settings.admin_email or not settings.admin_password:
        return None

    email = settings.admin_email.lower().strip()
    existing = await _get_user_by_email(redis, email)
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
        refreshed = await _load_user(redis, int(existing["id"]))
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
