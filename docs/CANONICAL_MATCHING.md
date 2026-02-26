# Canonical Matching Pipeline (Synthetic, Local-Only)

## Architecture
1. Rule-based extractor parses `brand`, `model`, `storage`, `variant` from normalized title.
2. Canonical key is generated as `{brand}|{model}|{storage}`.
3. Exact matching uses canonical key index.
4. Fuzzy matching combines normalized Levenshtein + token Jaccard.
5. Embedding matching uses `sentence-transformers` in offline mode (`local_files_only=True`) with deterministic hashing fallback.
6. Confidence scoring returns `confidence_score` and `match_type` (`exact`, `fuzzy`, `embedding`, `new`).
7. Audit log stores match/create events with timestamp, version, dry-run flag, and details.
8. Versioning and recompute are supported via `engine.recompute(...)` without deleting existing data.
9. Alias dictionary is externalized in `services/worker/app/platform/services/canonical_aliases.py`.
10. Ambiguous storage cases are explicitly flagged in audit (`flags: ("ambiguous_storage",)`).

## Thresholds
- `embedding > 0.92`: auto merge.
- `0.85 <= embedding <= 0.92`: low confidence, create new canonical and mark for review.
- `< 0.85`: create new canonical.

## Scaling Plan to 1M offers
1. Move canonical indexes to Redis/PostgreSQL (`canonical_key -> canonical_id`, brand partitions).
2. Batch embedding inference with vector DB (pgvector) and ANN index (HNSW/IVFFlat).
3. Replace O(N*C) candidate scan with candidate blocking: brand + storage + model prefix.
4. Execute pipeline in distributed workers with offset checkpoints.
5. Keep immutable match ledger (event sourcing) and periodically compact snapshots.
6. Add active learning loop for low-confidence and false-merge corrections (baseline implemented via `catalog_canonical_review_cases` + admin review endpoints).

## Tuning Suggestions
1. Tune `fuzzy_threshold` using validation PR curve; start in `[0.93, 0.98]` (baseline tooling added: `build_fuzzy_threshold_pr_curve` + `scripts/tune_canonical_fuzzy_threshold.py`).
2. Calibrate embedding thresholds by model family (Apple/Samsung can have different score distributions); baseline tooling added via `calibrate_embedding_thresholds_by_brand` and `scripts/calibrate_embedding_thresholds_by_brand.py`.
3. Penalize cross-variant candidates (`pro`, `plus`, storage mismatch) before final scoring (baseline variant-penalty logic wired into matcher scoring path).
4. Separate confidence calibration model from similarity model for stable production behavior (baseline implemented via dedicated confidence calibration layer in matcher decisions).
