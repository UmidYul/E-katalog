# Backend Prod Tasks

Последнее обновление: 2026-02-25

## P0 (критично)

1. `IN_PROGRESS` Перенести auth-хранилище из Redis в Postgres.
2. `TODO` Password reset + подтверждение email.
3. `TODO` Единый RBAC policy layer для API.
4. `TODO` Audit log для админ-операций.
5. `TODO` Idempotency keys для критичных write-эндпоинтов.
6. `TODO` Усиленный anti-bruteforce для auth (ip/email lockout + отдельные buckets).
7. `TODO` Observability: Sentry + метрики + tracing.
8. `TODO` Расширенный readiness/liveness (db/redis/celery).
9. `TODO` Бэкапы + проверка восстановления (runbook + автоматизация).
10. `TODO` Контрактные тесты по OpenAPI + версионирование API.
11. `IN_PROGRESS` Cleanup tasks для сессий/токенов/временных сущностей.
12. `TODO` Уведомления о цене/наличии через очередь (email/telegram/webhook).

## Текущий спринт: Auth в Postgres

### Этап A: схема данных

- `DONE` Спроектировать таблицы `auth_users`, `auth_sessions`, `auth_session_tokens`, `auth_oauth_identities`, `auth_password_reset_tokens`.
- `DONE` Добавить ORM-модели.
- `DONE` Добавить Alembic migration.

### Этап B: dual-write без даунтайма

- `TODO` Реализовать repository-слой для чтения/записи auth в Postgres.
- `DONE` Добавить feature-flag: `AUTH_STORAGE_MODE=redis|dual|postgres`.
- `TODO` В режиме `dual` писать и в Redis, и в Postgres; читать пока из Redis.

### Этап C: cutover

- `IN_PROGRESS` Backfill пользователей/сессий из Redis в Postgres.
- `TODO` Переключить чтение на Postgres.
- `TODO` Оставить Redis только под rate-limit/cache.
- `TODO` Удалить legacy auth-ключи из Redis после grace-периода.

## Дополнительно сделано в рамках текущей итерации

- `DONE` Добавлен maintenance task `cleanup_auth_sessions` для автоочистки старых Redis auth-сессий.
- `DONE` Добавлен скрипт `scripts/backfill_auth_to_postgres.py` для миграции пользователей/сессий/токенов/OAuth-связок из Redis в Postgres.

## 2026-02-25 Update (ASCII)

- `DONE` Stage B repository layer added: `services/api/app/repositories/auth_storage.py`.
- `DONE` Stage B dual-write enabled in auth router for user/session/token/OAuth writes.
- `DONE` Seed admin now syncs to Postgres on startup (`services/api/app/main.py` + `ensure_seed_admin`).
- `TODO` Stage C read cutover to pure Postgres for all user/profile/admin flows.
- `IN_PROGRESS` Password reset API endpoints added (`/auth/password-reset/request`, `/auth/password-reset/confirm`) with DB tokens in `auth_password_reset_tokens`.
