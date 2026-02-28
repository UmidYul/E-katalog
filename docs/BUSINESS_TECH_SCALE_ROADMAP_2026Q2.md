# Doxx Business + Technical Scale Roadmap (Q2 2026)

## 1) Why this roadmap
The current product already has core catalog, PDP, compare, normalization, dedupe, and AI enrichment.
The next stage should focus on:
- better user retention and repeat visits
- predictable data quality at scale
- clear monetization surfaces for stores
- lower operational risk when adding new brands/categories

This roadmap is designed for 12 weeks (Q2) with direct mapping to the current repo.

## 2) North-star KPIs
Set baseline first week, then track weekly.

- Product CTR to stores: +20%
- Repeat compare sessions (7-day): +25%
- Share of PDP with valid hero image: >= 95%
- Share of active products with >= 1 valid in-stock offer: >= 90%
- Data freshness (offer scraped_at age): P95 <= 6h
- API error rate (5xx): <= 0.5%
- Reindex lag after merge/normalize: <= 15 min
- Monetization KPI (sponsored + partner analytics pilots): first paid pilots in Q2

## 3) Priority matrix (impact / effort)

| Initiative | Impact | Effort | Priority | Target window |
|---|---:|---:|---|---|
| A. Data Quality Guardrails + Auto-heal | 10 | 4 | P0 | Weeks 1-3 |
| B. Price Alerts (Telegram/Email) MVP | 9 | 5 | P0 | Weeks 2-5 |
| C. Trust Score for offers | 8 | 4 | P1 | Weeks 4-7 |
| D. Compare Share Links + entry points | 7 | 3 | P1 | Weeks 3-5 |
| E. Partner Analytics (B2B dashboard lite) | 9 | 7 | P1 | Weeks 6-10 |
| F. Config-driven normalization rules | 8 | 8 | P1 | Weeks 7-12 |
| G. SLO/Observability hardening | 8 | 5 | P0 | Weeks 1-6 |

## 4) Execution plan by sprint

## Sprint 1 (Weeks 1-2): Reliability foundation
### Goal
Stop hidden data regressions and make failures visible.

### Scope
1. Build guardrail checks and daily report task.
2. Add SLO metrics and alerts.
3. Ensure merge/reindex consistency is always repaired.

### Repo tasks
1. Add quality check task:
   - `services/worker/app/tasks/maintenance_tasks.py`
   - checks:
     - active products with no valid offers
     - `catalog_product_search.store_count` mismatch vs actual offers
     - PDP image quality ratio
     - canonical products with broken refs
2. Add audit table for check results:
   - `shared/db/models.py`
   - migration in `migrations/versions/`
3. Add API admin endpoint to view last quality report:
   - `services/api/app/api/v1/routers/admin.py`
4. Add structured metrics logging in worker and API:
   - `services/worker/app/core/logging.py`
   - `services/api/app/core/logging.py`
5. Keep reindex consistency fix active and tested:
   - `services/worker/app/tasks/reindex_tasks.py`
   - tests in `tests/unit/`

### DoD
- Daily quality report exists and is queryable.
- Alert is raised when mismatch exceeds threshold.
- Reindex lag after merge <= 15 minutes.

## Sprint 2 (Weeks 3-4): Retention levers
### Goal
Increase repeat sessions and return traffic.

### Scope
1. Price Alerts MVP.
2. Compare share links.

### Repo tasks
1. Price Alerts backend:
   - new table `catalog_price_alerts` (user_id, product_id, target_price, channel, is_active)
   - migration + model updates:
     - `shared/db/models.py`
     - `migrations/versions/*`
2. Alert scanning worker task:
   - `services/worker/app/tasks/maintenance_tasks.py` or new `alerts_tasks.py`
   - trigger when current min price <= target
3. Notification adapter:
   - telegram first (already practical for local market), email second
   - `services/worker/app/platform/services/`
4. API endpoints:
   - `POST /api/v1/products/{id}/alerts`
   - `GET /api/v1/users/me/alerts`
   - `DELETE /api/v1/users/me/alerts/{id}`
   - files:
     - `services/api/app/api/v1/routers/products.py`
     - `services/api/app/api/v1/routers/users.py`
5. Frontend alert controls:
   - PDP: add "Notify me when price drops"
   - profile: list alerts
   - files:
     - `frontend/features/product/product-client-page.tsx`
     - `frontend/features/user/account-pages.tsx`
6. Compare share links:
   - encode selected IDs into short share token
   - endpoint to resolve token -> product ids
   - files:
     - `services/api/app/api/v1/routers/compare.py`
     - `frontend/features/compare/compare-client-page.tsx`

### DoD
- User can create/delete alerts.
- At least one notification channel works in production.
- Shared compare URL opens same set of products.

## Sprint 3 (Weeks 5-6): Conversion quality
### Goal
Improve trust and CTR to offers.

### Scope
1. Offer Trust Score.
2. Better ranking in offers list and compare.

### Repo tasks
1. Extend offer model with calculated trust fields:
   - `shared/db/models.py`
   - include components: freshness, seller rating, price anomaly score, stock consistency
2. Worker job to refresh trust scores:
   - `services/worker/app/tasks/maintenance_tasks.py`
3. API ranking integration:
   - `services/api/app/repositories/catalog.py`
   - ranking mode `best_value` in offers endpoints
4. Frontend display:
   - show "Best value" and trust badge in PDP offers table
   - files:
     - `frontend/components/product/offer-table.tsx`
     - compare table optional hint

### DoD
- Offer ranking can use trust score.
- CTR to store improves in A/B slice.

## Sprint 4 (Weeks 7-9): Monetization MVP
### Goal
Launch first B2B value and pilot paid features.

### Scope
1. Partner analytics lite dashboard.
2. Sponsored offers with strict labels.

### Repo tasks
1. Track click events with attribution:
   - product_id, store_id, seller_id, source_page, position, timestamp
   - new table + API ingest endpoint
2. Admin/partner reporting endpoints:
   - daily clicks, CTR, average rank, price competitiveness
   - `services/api/app/api/v1/routers/admin.py`
3. Sponsored placements:
   - schema for sponsorship campaigns
   - ranking blend with max cap and explicit label
4. Frontend:
   - show "Sponsored" label clearly
   - keep trust + price context visible

### DoD
- First partner sees dashboard data.
- Sponsored logic is transparent and toggleable by config.

## Sprint 5 (Weeks 10-12): Scale architecture for new brands/categories
### Goal
Reduce hardcoded behavior and make onboarding fast.

### Scope
1. Config-driven normalization engine.
2. Golden regression dataset and CI gates.

### Repo tasks
1. Add normalization rule source:
   - YAML/DB rules for brand aliases, spec key mapping, value normalization
   - `services/worker/app/platform/services/normalization.py`
2. Add runtime loader + cache:
   - `shared/config/settings.py` and service loader
3. Add golden fixtures:
   - iPhone, Samsung, Xiaomi, Honor, etc
   - checks for:
     - canonical title formatting
     - image selection quality
     - key specs extraction
     - compare scoring behavior
   - `tests/unit/`
4. Add CI guard:
   - fail build if golden tests regress

### DoD
- New brand onboarding can be done by config change for common cases.
- Golden tests protect core normalization behavior.

## 5) Immediate backlog (next 7 days)

1. Create quality report task and DB table for results.
2. Add admin endpoint + simple dashboard panel for quality report.
3. Add Telegram-only price alert MVP schema and API.
4. Add compare share link endpoint and frontend button.
5. Add unit tests for all above.

## 6) Risk controls

1. Feature flags for each initiative:
   - `*_enabled` flags in `shared/config/settings.py`
2. Expand/contract migration strategy:
   - add nullable columns first
   - backfill async
   - switch reads
   - remove legacy columns later
3. Idempotent workers:
   - use source hashes and upsert rules
4. Rollback plan:
   - disable flag + keep old read path for one release window

## 7) Suggested owner split (small team)

1. Backend/API owner:
   - endpoints, ranking, contracts, schema stability
2. Worker/Data owner:
   - enrichment, quality jobs, reindex/dedupe reliability
3. Frontend owner:
   - PDP/compare/profile UX and instrumentation
4. Product owner:
   - KPI baseline, experiment design, partner pilot selection

## 8) Definition of success for Q2

By end of Q2:
- catalog reliability incidents reduced by at least 50%
- retention features (alerts + share) driving measurable repeat traffic
- trust-aware offer ranking live
- first monetization pilot running with reporting
- onboarding new brands requires minimal code changes

