# Real Scrape + Canonicalization Execution Report (2026-02-20)

## Scope
- Полный цикл на реальном скрапинге: очистка, скрап, синк, каноникализация, аудит.
- Без удаления Docker-стека, с сохранением логов и отчётов.

## What Was Run
1. `docker compose -f infra/docker/docker-compose.yml down -v --remove-orphans`
2. `docker compose -f infra/docker/docker-compose.yml build --no-cache`
3. `docker compose -f infra/docker/docker-compose.yml up -d`
4. `docker compose -f infra/docker/docker-compose.yml exec api alembic -c /srv/migrations/alembic.ini upgrade head`
5. Очистка БД (catalog + legacy таблицы для чистого прогона).
6. Реальный scrape через сервис `scraper`.
7. Legacy -> catalog sync: `python /srv/scripts/sync_legacy_to_catalog.py`
8. Worker pipeline: normalize, embeddings, dedupe, reindex.
9. Runtime audit: `scripts/canonical_runtime_audit.py`.

## Initial Outcome (до улучшений)
- `canonical_count`: 138
- `offers_count`: 71
- `avg_offers_per_canonical`: 1.0289
- `duplicate_model_storage_signatures`: 15
- `ambiguous_storage_cases`: 8

Проблема: сильный over-splitting (одинаковые model+storage дробились на много canonical).

## Fixes Applied
1. `services/worker/app/platform/services/normalization.py`
- `build_canonical_title` переведён на identity по `brand + model + storage`.
- Цвет и storefront-noise больше не участвуют в разделении canonical.

2. `scripts/canonical_runtime_audit.py`
- Пересмотрен low-confidence расчёт (не по сырым title-строкам, а по атрибутам и нормализованному canonical-title).
- Добавлены поля:
  - `canonical_with_offers_count`
  - `empty_active_canonical_count`

3. `services/worker/app/platform/services/ai_matching.py`
- Убран `temperature` из `/v1/responses` запросов (устранены 400 ошибки).
- Обновлён промпт: цвет не считается variant-defining.

4. Тесты обновлены под новую политику (цвет не разделяет canonical):
- `tests/unit/test_normalization.py`
- `tests/integration/test_canonical_pipeline.py`
- `tests/ai_validation/test_canonical_quality.py`

## Final QA Metrics (после исправлений)
Из `docs/reports/real_scrape_canonical_report.json`:
- `canonical_count`: 23
- `offers_count`: 71
- `canonical_with_offers_count`: 23
- `empty_active_canonical_count`: 0
- `avg_offers_per_canonical`: 3.0869
- `max_offers_in_single_canonical`: 7

Инварианты:
- `memory_mixed_canonical_count = 0`
- `model_mixed_canonical_count = 0`
- `orphan_offers_count = 0`
- `min_price_mismatch_count = 0`

Проблемные кейсы:
- `duplicate_model_storage_signatures = {}`
- `low_confidence_cases = 0`
- `cross_brand_cases = 0`
- `ambiguous_storage_cases = 8`
- `total_problem_cases = 8`

## Logs and Artifacts
- `docs/reports/real_scrape_scraper.log`
- `docs/reports/real_scrape_worker.log`
- `docs/reports/real_scrape_api.log`
- `docs/reports/real_scrape_canonical_report.json`
- `docs/reports/real_scrape_problem_cases.jsonl`

## Notes
- Выполнен lifecycle-cleanup `cleanup_empty_canonicals`: деактивировано 134 пустых canonical.
- После cleanup активные canonical соответствуют реально привязанным офферам (`canonical_count == canonical_with_offers_count == 23`).
