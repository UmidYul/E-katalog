# Profile Future Features

This file tracks profile capabilities that are designed but not yet implementable with the current backend API.

## Implemented

- On February 23, 2026, profile editing was implemented with:
  - `GET /api/v1/users/me/profile`
  - `PATCH /api/v1/users/me/profile`
- Profile fields now persist server-side in the current auth storage (Redis).

## 2) Password Change and Session Management

### Goal
- Let users rotate password and revoke active sessions.

### Planned API
- `POST /api/v1/auth/change-password`
- `GET /api/v1/auth/sessions`
- `DELETE /api/v1/auth/sessions/{session_id}`
- `DELETE /api/v1/auth/sessions` (revoke all except current)

### Planned session model
```json
{
  "id": "sess_123",
  "device": "Chrome on Windows",
  "ip_address": "203.0.113.42",
  "location": "Tashkent, UZ",
  "created_at": "2026-02-23T10:22:00Z",
  "last_seen_at": "2026-02-23T14:06:00Z",
  "is_current": true
}
```

## 3) Two-Factor Authentication (2FA)

### Goal
- Increase account security with TOTP.

### Planned API
- `POST /api/v1/auth/2fa/setup`
- `POST /api/v1/auth/2fa/verify`
- `DELETE /api/v1/auth/2fa`

### Planned setup response
```json
{
  "secret": "BASE32SECRET",
  "qr_svg": "<svg>...</svg>",
  "recovery_codes": ["code1", "code2", "code3"]
}
```

## 4) Notification Channels

### Goal
- Sync notification preferences with backend.

### Planned API
- `GET /api/v1/users/me/notification-preferences`
- `PATCH /api/v1/users/me/notification-preferences`

### Planned payload
```json
{
  "price_drop_alerts": true,
  "stock_alerts": true,
  "weekly_digest": false,
  "marketing_emails": false,
  "channels": {
    "email": true,
    "telegram": false
  }
}
```

## 5) Cloud Sync for Recently Viewed

### Goal
- Keep recently viewed products consistent across devices.

### Planned API
- `GET /api/v1/users/me/recently-viewed`
- `POST /api/v1/users/me/recently-viewed`
- `DELETE /api/v1/users/me/recently-viewed`

### Planned client migration
- Keep local store as fallback cache.
- On login, merge local and remote history.
- On logout, preserve local cache for guest mode.
