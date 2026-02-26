# Docs Unimplemented Backlog

Generated: 2026-02-26
Source folder: `docs/`

This file aggregates items that are still not fully implemented based on explicit markers in docs:
- `TODO`
- `IN_PROGRESS`
- unchecked checklist items (`[ ]`)
- `Planned / Next / Future` sections

## 1) Backend Prod Tasks (`docs/BACKEND_PROD_TASKS.md`)

- [x] Auth storage migration Redis -> Postgres implemented for code paths: auth router + user profile/notification + admin user-management read/write paths are cut over for `AUTH_STORAGE_MODE=postgres`; Redis is retained for rate-limit/lockout and ephemeral keys.
- [x] Password reset + email confirmation implemented: API endpoints + DB-backed tokens + SMTP delivery integration.
- [x] Unified RBAC policy layer for API implemented: shared `app/api/rbac.py` helpers/dependencies adopted by admin + product-feedback routers.
- [x] Audit log for admin operations baseline implemented: `admin_audit_events` table + `/api/v1/admin/audit/events` + write logging in mutating admin endpoints.
- [x] Idempotency keys for critical write endpoints implemented (`Idempotency-Key` + Redis TTL replay) across auth recovery/session maintenance/logout, admin write/enqueue routes (including CRUD blocks), product price-alert upsert, product-feedback mutating routes, users mutating routes, and compare-share creation.
- [x] Anti-bruteforce hardening for auth implemented (ip/email lockout + separate Redis buckets).
- [x] Observability baseline implemented in API: optional Sentry integration (error + tracing), Prometheus-style `/api/v1/metrics`, and request timing header `X-Response-Time-Ms`.
- [x] Expanded readiness/liveness checks implemented (`/live` + enriched `/ready` with DB/Redis/Celery checks).
- [x] Backups + restore validation baseline implemented: `scripts/db_backup_restore.py` + GitHub workflow `.github/workflows/backup-restore-validation.yml` + runbook `docs/BACKUP_RESTORE_RUNBOOK.md`.
- [x] OpenAPI contract testing + API versioning baseline implemented (`tests/unit/test_openapi_contract.py` + `X-API-Version` middleware behavior checks).
- [x] Cleanup tasks for sessions/tokens/temporary entities baseline implemented (Redis auth sessions cleanup, Postgres token cleanup, ephemeral auth key TTL cleanup).
- [x] Notifications pipeline for price/stock baseline implemented: queued delivery worker supports `telegram` + `email` channels with optional webhook fanout.
- [x] Stage B dual-write transition implemented (`dual` writes to Redis+Postgres; reads remain Redis in transition mode).
- [x] Stage C cutover tasks:
- [x] switch reads to pure Postgres everywhere (core auth/user/session/token read paths in `AUTH_STORAGE_MODE=postgres` no longer depend on Redis auth keys);
- [x] leave Redis only for cache/rate-limit (Redis auth storage keys are not required in postgres mode; Redis remains for rate-limit/lockout and ephemeral challenge/state keys);
- [x] remove legacy auth keys from Redis after grace period (maintenance task + daily schedule implemented).

## 2) EK.UA MVP Features (`docs/EK_UA_MVP_FEATURES.md`)

- [~] Advanced feedback workflow (votes, report-abuse, pinned answers): API + UI baseline implemented on 2026-02-26, needs extra polishing/tests.  

Phase 2 / post-MVP backlog from this file:
- [ ] Full comparison matrix improvements.
- [ ] Reviews, Q&A, discussions/forum extension.
- [ ] Category ratings, popular requests, encyclopedic sections.
- [ ] Editorial content sections (articles, selections).
- [ ] Advanced server-synced notifications (price drop / stock).
- [ ] Advanced profile security hardening.
- [ ] B2B store cabinet and ad tools.

## 3) Product Feedback Future (`docs/PRODUCT_FEEDBACK_FUTURE_FEATURES.md`)

Planned API:
- [x] `POST /api/v1/products/reviews/{review_id}/votes`
- [x] `POST /api/v1/products/reviews/{review_id}/report`
- [x] `POST /api/v1/products/questions/{question_id}/report`
- [x] `POST /api/v1/products/answers/{answer_id}/pin`

Planned model extensions:
- [~] `is_verified_purchase` in reviews (field exposed; no purchase-proof pipeline yet).
- [x] `helpful_votes` and `not_helpful_votes` counters.
- [x] Extended moderation/status fields for feedback entities (reviews/questions/answers moderation + status fields in API).

Planned client tasks:
- [x] Helpful-vote UI for reviews.
- [x] Report actions for reviews/questions.
- [x] Pin/unpin UI for official answers.
- [x] Optimistic updates for votes/reports.
- [x] Pagination for high-volume products (frontend load-more pagers wired to backend `limit/offset`).

## 4) Business + Tech Scale Roadmap (`docs/BUSINESS_TECH_SCALE_ROADMAP_2026Q2.md`)

High-priority initiatives still listed as roadmap work:
- [x] Data quality guardrails + auto-heal (A): daily quality report + mismatch auto-heal + admin visibility and alerting baseline implemented.
- [x] Price alerts MVP (Telegram/Email) (B): schema/API + worker delivery (telegram/email/webhook) implemented.
- [x] Offer trust score and trust-aware ranking (C): offer trust fields added (`trust_score` + components), worker refresh task/schedule implemented, `best_value` ranking enabled in offers API/PDP, and trust badge shown in offer table.
- [x] Compare share links + entry points (D): share UX polished on compare page (native share/clipboard + visible generated link/expiry), and API structured telemetry events added for share create/resolve.
- [x] Config-driven normalization rules (F): YAML-based normalization rules source + runtime loader/cache wired in worker normalization service (brand aliases/spec-key mappings/placeholder values configurable without code edits).
- [x] SLO/observability hardening (G): API metrics extended with SLO gauges/targets/breach flags (`5xx ratio`, `p95/p99` latency estimates) for direct alerting integration.

Immediate backlog from roadmap:
- [x] Quality report task + DB table implemented (worker task + `catalog_data_quality_reports` model/migration).
- [x] Admin endpoint + dashboard panel for quality report implemented (admin quality API + frontend wiring).
- [x] Telegram-first price alert schema + API + notification delivery worker implemented on 2026-02-26.
- [x] Compare share link endpoint + frontend button.
- [~] Unit tests for roadmap items are partially implemented (quality report routes, price-alert delivery routing/logic, OpenAPI contract checks, and idempotency coverage checks for mutating API routes including auth/admin/users/product-feedback/compare are covered; broader integration coverage pending).

## 5) Canonical Matching (`docs/CANONICAL_MATCHING.md`)

Scaling plan not yet implemented in full:
- [x] Move canonical indexes to Redis/Postgres mappings for large-scale matching (added `catalog_canonical_key_index` table + worker service with Redis cache + periodic rebuild task).
- [ ] Batch embedding inference + vector DB ANN indexing strategy.
- [x] Replace O(N*C) scans with candidate blocking (bucket index in `CanonicalMatchingEngine` limits candidate set by brand/model/storage).
- [ ] Distributed workers with offset checkpoints for canonical pipeline.
- [ ] Immutable match ledger + snapshot compaction.
- [ ] Active learning loop for low-confidence/false-merge correction.

Tuning backlog:
- [ ] Tune fuzzy threshold via validation PR curve.
- [ ] Calibrate embedding thresholds by brand family.
- [ ] Penalize cross-variant candidates before final scoring.
- [ ] Separate confidence calibration model from similarity model.

## 6) EK.UA Full Audit (`docs/EK_UA_FUNCTIONALITY_FULL_AUDIT.md`)

This file is a capability audit/reference and does not use explicit `TODO` markers.  
Action item:
- [ ] Create a strict parity matrix: `implemented / partial / missing` for audited EK.UA feature blocks, then convert missing blocks into tracked dev tasks.

## 7) Profile Future Features (`docs/PROFILE_FUTURE_FEATURES.md`)

Most planned items in this file are already listed as implemented.

Action item:
- [ ] Refresh this document to remove outdated "Planned API" sections and leave only real future gaps.

## 8) Operational Docs (not feature backlog)

These docs are operational runbooks/checklists and do not define product-feature TODO by status:
- `docs/MVP_DEV_ROLLOUT_CHECKLIST.md`
- `docs/WINDOWS_SERVER_GUIDE.md`
- `docs/theme-palette-preview.html`

## 9) Additional Prod Readiness Gaps (manual additions)

These items are important for production quality but are not explicitly tracked as TODOs in the source docs above:
- [ ] Security baseline hardening checklist (strict CORS, security headers, HTTPS-only assumptions, secret rotation policy).
- [ ] Queue reliability standards (DLQ, retry/backoff policy, stuck-job monitoring, idempotent worker handlers).
- [ ] Release management hardening (staging parity, post-deploy smoke tests, rollback runbook).
- [ ] Legal/compliance storefront baseline (privacy policy, terms, cookie policy, contacts, status page).
