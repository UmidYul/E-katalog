# Docs Unimplemented Backlog

Generated: 2026-02-26
Source folder: `docs/`

This file aggregates items that are still not fully implemented based on explicit markers in docs:
- `TODO`
- `IN_PROGRESS`
- unchecked checklist items (`[ ]`)
- `Planned / Next / Future` sections

## 1) Backend Prod Tasks (`docs/BACKEND_PROD_TASKS.md`)

- [ ] Auth storage migration Redis -> Postgres is not finished (`IN_PROGRESS`).
- [ ] Password reset + email confirmation is not fully finished (`IN_PROGRESS` / `TODO`).
- [ ] Unified RBAC policy layer for API (`TODO`).
- [ ] Audit log for admin operations (`TODO`).
- [ ] Idempotency keys for critical write endpoints (`TODO`).
- [ ] Anti-bruteforce hardening for auth (`TODO` in P0 list; later update marks this as `DONE`, needs status reconciliation).
- [ ] Observability hardening (Sentry + metrics + tracing) (`TODO`).
- [ ] Expanded readiness/liveness checks (`TODO` in P0 list; later update marks this as `DONE`, needs status reconciliation).
- [ ] Backups + restore validation (runbook + automation) (`TODO`).
- [ ] OpenAPI contract testing + API versioning work is still in progress (`IN_PROGRESS`).
- [ ] Cleanup tasks for sessions/tokens/temporary entities are still in progress (`IN_PROGRESS`).
- [ ] Notifications pipeline for price/stock (email/telegram/webhook) (`TODO`).
- [ ] Stage B dual-write transition still has open TODO markers in source doc (`dual` writes in both stores, reads from Redis during transition).
- [ ] Stage C cutover tasks:
- [ ] switch reads to pure Postgres everywhere (`TODO` / `IN_PROGRESS`);
- [ ] leave Redis only for cache/rate-limit (`TODO`);
- [ ] remove legacy auth keys from Redis after grace period (`TODO`).

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
- [ ] Extended moderation/status fields for feedback entities.

Planned client tasks:
- [x] Helpful-vote UI for reviews.
- [x] Report actions for reviews/questions.
- [x] Pin/unpin UI for official answers.
- [ ] Optimistic updates for votes/reports.
- [~] Pagination for high-volume products (backend `limit/offset` added; frontend pagers pending).

## 4) Business + Tech Scale Roadmap (`docs/BUSINESS_TECH_SCALE_ROADMAP_2026Q2.md`)

High-priority initiatives still listed as roadmap work:
- [ ] Data quality guardrails + auto-heal (A).
- [ ] Price alerts MVP (Telegram/Email) (B).
- [ ] Offer trust score and trust-aware ranking (C).
- [~] Compare share links + entry points (D): backend share token endpoints + frontend share button implemented on 2026-02-26, needs final UX polish/telemetry.
- [ ] Config-driven normalization rules (F).
- [ ] SLO/observability hardening (G).

Immediate backlog from roadmap:
- [ ] Quality report task + DB table.
- [ ] Admin endpoint + dashboard panel for quality report.
- [~] Telegram-first price alert schema + API: DB table + API endpoints + frontend API wiring implemented on 2026-02-26; notification delivery worker is pending.
- [x] Compare share link endpoint + frontend button.
- [ ] Unit tests for all above.

## 5) Canonical Matching (`docs/CANONICAL_MATCHING.md`)

Scaling plan not yet implemented in full:
- [ ] Move canonical indexes to Redis/Postgres mappings for large-scale matching.
- [ ] Batch embedding inference + vector DB ANN indexing strategy.
- [ ] Replace O(N*C) scans with candidate blocking.
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
