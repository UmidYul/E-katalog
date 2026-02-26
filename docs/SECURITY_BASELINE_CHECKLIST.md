# Security Baseline Hardening Checklist

Updated: 2026-02-26

## 1) CORS baseline

- [x] Explicit `CORS_ORIGINS` allowlist configured.
- [x] `allow_methods` narrowed to explicit HTTP methods.
- [x] `allow_headers` narrowed to required request headers.
- [ ] Production-only origin list reviewed and approved before release.

## 2) API security headers baseline

- [x] `X-Frame-Options: DENY`
- [x] `X-Content-Type-Options: nosniff`
- [x] `Referrer-Policy` configured
- [x] `Permissions-Policy` configured
- [x] `Content-Security-Policy` baseline configured for API responses
- [x] `Strict-Transport-Security` enabled for `staging/production` environment modes

## 3) HTTPS-only assumptions

- [x] HSTS applied for non-local environments.
- [ ] Edge/LB enforces HTTPS redirect and TLS minimum version.
- [ ] Proxy headers (`X-Forwarded-Proto`) validated in deployment tier.

## 4) Secret handling and rotation policy

- [x] Secrets are sourced from environment variables.
- [x] `.env.example` includes only placeholders.
- [ ] Rotation cadence established (at least quarterly for app secrets, immediate for compromise).
- [ ] Incident runbook for forced secret rotation documented.

## 5) Verification gates

- [x] Unit tests verify API security headers contract (`tests/unit/test_openapi_contract.py`).
- [ ] CI gate for production env config validation.
