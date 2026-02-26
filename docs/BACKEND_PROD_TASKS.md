# Backend Prod Tasks

Последнее обновление: 2026-02-26

## P0 (критично)

1. `DONE` Перенести auth-хранилище из Redis в Postgres (Stage B+Stage C implemented in code; Redis оставлен для rate-limit/lockout и ephemeral ключей).
2. `DONE` Password reset + подтверждение email (API + DB tokens + SMTP delivery).
3. `DONE` Единый RBAC policy layer для API (через `app/api/rbac.py` и dependency-level `require_roles`).
4. `DONE` Audit log baseline для админ-операций (таблица + endpoint + write-hooks).
5. `DONE` Idempotency keys для критичных write-эндпоинтов (включая admin CRUD/enqueue, auth recovery/session maintenance/logout, price alerts, users/profile/preferences, product-feedback, compare-share).
6. `DONE` Усиленный anti-bruteforce для auth (ip/email lockout + отдельные buckets).
7. `DONE` Observability baseline: Sentry + HTTP metrics + request tracing.
8. `DONE` Расширенный readiness/liveness (db/redis/celery).
9. `DONE` Бэкапы + проверка восстановления (runbook + автоматизация).
10. `DONE` Контрактные тесты по OpenAPI + версионирование API (v1 prefix + stable operationId + version header checks).
11. `DONE` Cleanup tasks для сессий/токенов/временных сущностей.
12. `DONE` Уведомления о цене/наличии через очередь (email/telegram/webhook) baseline.

## Текущий спринт: Auth в Postgres

### Этап A: схема данных

- `DONE` Спроектировать таблицы `auth_users`, `auth_sessions`, `auth_session_tokens`, `auth_oauth_identities`, `auth_password_reset_tokens`.
- `DONE` Добавить ORM-модели.
- `DONE` Добавить Alembic migration.

### Этап B: dual-write без даунтайма

- `DONE` Реализовать repository-слой для чтения/записи auth в Postgres.
- `DONE` Добавить feature-flag: `AUTH_STORAGE_MODE=redis|dual|postgres`.
- `DONE` В режиме `dual` писать и в Redis, и в Postgres; читать пока из Redis.

### Этап C: cutover

- `DONE` Backfill пользователей/сессий из Redis в Postgres: подготовлены скрипт/dual-write/maintenance cleanup; для `AUTH_STORAGE_MODE=postgres` чтение выполняется из Postgres.
- `DONE` Переключить чтение на Postgres.
- `DONE` Оставить Redis только под rate-limit/cache.
- `DONE` Удалить legacy auth-ключи из Redis после grace-периода (добавлен maintenance task + daily beat schedule).

## Дополнительно сделано в рамках текущей итерации

- `DONE` Добавлен maintenance task `cleanup_auth_sessions` для автоочистки старых Redis auth-сессий.
- `DONE` Добавлен скрипт `scripts/backfill_auth_to_postgres.py` для миграции пользователей/сессий/токенов/OAuth-связок из Redis в Postgres.

## 2026-02-25 Update (ASCII)

- `DONE` Stage B repository layer added: `services/api/app/repositories/auth_storage.py`.
- `DONE` Stage B dual-write enabled in auth router for user/session/token/OAuth writes.
- `DONE` Seed admin now syncs to Postgres on startup (`services/api/app/main.py` + `ensure_seed_admin`).
- `DONE` Stage C read cutover to pure Postgres for user/profile/admin/auth flows.
- `DONE` Password reset API endpoints (`/auth/password-reset/request`, `/auth/password-reset/confirm`) with DB tokens in `auth_password_reset_tokens` and SMTP email delivery.
- `DONE` Email confirmation API (`/auth/email-confirmation/request`, `/auth/email-confirmation/confirm`) with Postgres token flow in `AUTH_STORAGE_MODE=postgres`, Postgres-backed `email_confirmed` fields, and SMTP email delivery.
- `DONE` Anti-bruteforce hardening: login/2FA lockout by IP and email with separate Redis buckets and configurable thresholds/TTL.
- `DONE` Expanded readiness/liveness endpoints: `/live` + enriched `/ready` with DB/Redis/Celery checks and 503 on not-ready.
- `DONE` Added maintenance cleanup for auth token tables in Postgres (`cleanup_auth_token_tables`): expired/used reset tokens, expired/revoked session tokens, old revoked sessions.
- `DONE` Registered `cleanup_auth_token_tables` in Celery routing + daily beat schedule (`cleanup-auth-token-tables-daily-0355`), with route/schedule tests.
- `DONE` OpenAPI contract coverage expanded: `tests/unit/test_openapi_contract.py` validates core endpoints, `/api/v1` prefix, unique/stable `operationId`, required tags/responses, and API version header behavior (default + override + non-API routes).
- `DONE` API version response header added for all API routes: `X-API-Version` (configurable via `API_VERSION_HEADER_VALUE`, default `v1`).
- `DONE` Stage C auth read cutover: in `AUTH_STORAGE_MODE=postgres`, user/email/session reads are served from Postgres and session revocation covers Postgres sessions.
- `DONE` User profile + notification preferences read/write now use Postgres in `AUTH_STORAGE_MODE=postgres` (`services/api/app/api/v1/routers/users.py`); Redis path remains for `redis|dual`.
- `DONE` Admin users management (`/admin/users` list/get/patch/delete + analytics users snapshot) now reads/writes Postgres in `AUTH_STORAGE_MODE=postgres`.
- `DONE` Unified RBAC policy layer: shared role helpers/dependencies in `services/api/app/api/rbac.py` adopted by admin and product-feedback routers via dependency-level `require_roles`.
- `DONE` Audit log baseline for admin operations: `admin_audit_events` table + `/api/v1/admin/audit/events` + write-audit hooks across mutating admin endpoints.
- `DONE` Idempotency baseline: shared `app/api/idempotency.py` helper + config/env toggles; adopted in auth recovery/session maintenance/logout writes, admin write/enqueue routes (including CRUD blocks), `POST /api/v1/products/{product_id}/alerts`, product-feedback mutating endpoints, users mutating endpoints (`profile`, `favorites`, `notification-preferences`, `alerts`, `recently-viewed`), and `POST /api/v1/compare/share`.
- `DONE` Observability baseline in API: optional Sentry init (with performance tracing/profiling knobs), request-level HTTP metrics exposed at `/api/v1/metrics` (Prometheus text format), and response timing header `X-Response-Time-Ms`.
- `DONE` Backup/restore baseline: `scripts/db_backup_restore.py` (pg_dump + optional restore validation + metadata hash) and scheduled/manual workflow `.github/workflows/backup-restore-validation.yml`; runbook added at `docs/BACKUP_RESTORE_RUNBOOK.md`.
- `DONE` OpenAPI contract and API versioning baseline: `tests/unit/test_openapi_contract.py` verifies core paths, unique/stable `operationId`, required tags/responses, `X-API-Version` default and override behavior.
- `DONE` Cleanup tasks baseline expanded: Redis auth sessions cleanup, Postgres auth token-table cleanup, and periodic TTL normalization for ephemeral auth keys (`2fa challenge`, `email confirmation`, `oauth state`) via Celery beat.
- `DONE` Notifications pipeline baseline: `deliver_price_alert_notifications` now supports channel delivery for `telegram` and `email` with optional webhook fanout for delivery events.
- `DONE` Stage C legacy Redis auth cleanup: new maintenance task `cleanup_auth_legacy_redis_keys` with `AUTH_LEGACY_REDIS_CLEANUP_*` settings and schedule `cleanup-auth-legacy-redis-keys-daily-0420`.
- `DONE` Stage C auth token/session cutover in `AUTH_STORAGE_MODE=postgres`: access/refresh token resolution uses Postgres token table and core auth user-field mutations write directly to Postgres (Redis auth writes skipped in postgres mode).
- `DONE` Stage C email-confirmation cutover: confirmation tokens use Postgres table `auth_email_confirmation_tokens` in postgres mode; cleanup task purges expired/used confirmation tokens.
- `DONE` Stage C pure-Postgres read path: in `AUTH_STORAGE_MODE=postgres`, token/user lookup, session validation/listing, and revoke/logout auth-token paths run without Redis auth-key dependency.
- `DONE` Compare share D-polish: compare page share UX improved (native share/clipboard, explicit generated link + expiry), and backend structured telemetry logs added for compare-share create/resolve events.
- `DONE` Offer trust score/ranking baseline (Roadmap C): added trust columns to `catalog_offers`, worker task `refresh_offer_trust_scores` with 30m schedule, `best_value` sorting in `/products/{product_id}/offers` + PDP offers block, and trust badges in frontend offer table.
- `DONE` Config-driven normalization baseline (Roadmap F): extracted normalization rules into YAML (`normalization_rules.yaml`) with runtime loader/cache + env-controlled path/reload, covering brand aliases, spec-key aliases, noise patterns, colors, and placeholder values.
- `DONE` SLO/observability hardening baseline (Roadmap G): `/api/v1/metrics` now exposes SLO-oriented gauges and breach indicators (5xx error ratio + p95/p99 latency estimates + configured targets).
- `DONE` Canonical matching scaling (partial baseline): introduced persistent canonical key index (`catalog_canonical_key_index`) with Redis cache-backed resolver and daily refresh task, plus candidate blocking buckets in matching engine to avoid full-corpus scans per offer.
- `DONE` Canonical index processing now uses offset checkpoints (`catalog_pipeline_offsets`) with incremental chunk processing and auto follow-up task scheduling for large backfills.
- `DONE` Canonical match ledger/snapshot baseline: normalize pipeline writes immutable match events to `catalog_canonical_match_ledger`; scheduled compaction task creates daily snapshots in `catalog_canonical_match_snapshots`.
