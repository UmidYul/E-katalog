# CI Setup (GitHub Actions)

This repository uses:

- `.github/workflows/ci.yml`
- `.github/workflows/promote-dev-to-main.yml`

The workflow runs:

1. Backend tests (pytest) with separate `PYTHONPATH` contexts:
   - `services/api`
   - `services/worker`
   - `services/scraper`
2. Frontend checks:
   - `lint`
   - `typecheck`
   - `test`
   - `build`
3. Auto-promotion mode:
   - when CI on `dev` is green, workflow fast-forwards `main` to `dev`

## Why this CI layout

1. There are two different `app` packages (`services/api/app` and `services/worker/app`).
2. Running all tests under one `PYTHONPATH` causes import conflicts.
3. Frontend tests require Node `22+` because of `--experimental-strip-types`.
4. `ADMIN_SEED_ENABLED=false` avoids startup seed side effects in backend CI.
5. `dev` can be used as a single integration branch, with automatic publish to `main`.

## Enable CI in GitHub

1. Open `Settings -> Actions -> General`:
   - `Actions permissions`: `Allow all actions and reusable workflows`
   - `Workflow permissions`: `Read and write permissions`
2. Open `Settings -> Rules -> Rulesets` and create/edit a ruleset for `dev`.
3. Enable on `dev`:
   - `Require status checks to pass before merging`
   - `Require branches to be up to date before merging` (recommended)
4. Add required checks for `dev`:
   - `Backend (pytest)`
   - `Frontend (lint, typecheck, test, build)`
5. For `main`, use one of these options:
   - Option A (auto-publish direct): no PR requirement on `main`; allow GitHub Actions to push.
   - Option B (strict): keep PR requirement on `main` and do manual PR `dev -> main`.
6. Open `Settings -> General -> Pull Requests` and enable:
   - `Automatically delete head branches`

## Git workflow (single `dev` branch)

1. Work only in `dev`:

```bash
git checkout dev
git pull origin dev
```

2. Commit and push to `dev`:

```bash
git push origin dev
```

3. CI runs on `dev`.
4. If CI is green, `promote-dev-to-main.yml` publishes the same commit to `main`.

## Local pre-push smoke check

```bash
# backend quick run
python -m pytest -q --maxfail=1 --confcutdir=tests/unit tests/unit

# frontend
cd frontend
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

## Common CI failures

1. `ModuleNotFoundError: No module named 'app.api'`
   - Cause: mixed API/Worker imports in one Python path.
   - Fix: run pytest in separate CI steps (already implemented).
2. `node: bad option: --experimental-strip-types`
   - Cause: old Node version.
   - Fix: use Node `22+` in CI (already implemented).
3. Backend tests fail because of infra dependencies
   - Keep unit tests infra-free, or move infra-dependent tests to a separate docker/integration workflow.
