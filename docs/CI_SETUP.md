# CI Setup (GitHub Actions)

This repository uses:

- `.github/workflows/ci.yml`

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

Trigger policy:
- `push` on `dev`
- `pull_request` (any target branch)

## Why this CI layout

1. There are two different `app` packages (`services/api/app` and `services/worker/app`).
2. Running all tests under one `PYTHONPATH` causes import conflicts.
3. Frontend tests require Node `22+` because of `--experimental-strip-types`.
4. `ADMIN_SEED_ENABLED=false` avoids startup seed side effects in backend CI.

## Enable CI in GitHub

1. Open `Settings -> Actions -> General`:
   - `Actions permissions`: `Allow all actions and reusable workflows`
   - `Workflow permissions`: `Read repository contents permission`
2. Open `Settings -> Rules -> Rulesets` and create/edit a ruleset for `main`.
3. Enable:
   - `Require a pull request before merging`
   - `Require status checks to pass before merging`
   - `Require branches to be up to date before merging` (recommended)
4. Add required checks:
   - `Backend (pytest)`
   - `Frontend (lint, typecheck, test, build)`
5. Solo maintainer setup (recommended):
   - `Required approving reviews`: `0`
   - keep required status checks enabled
6. Open `Settings -> General -> Pull Requests` and enable:
   - `Automatically delete head branches`

## Git workflow (main + feature branches)

1. Always branch from latest `main`:

```bash
git checkout main
git pull origin main
git checkout -b feat/<short-task-name>
```

2. Push feature branch and open PR into `main`:

```bash
git push -u origin feat/<short-task-name>
```

3. Merge only after required checks are green.
4. After merge, GitHub auto-deletes remote feature branch (if enabled above).
5. Periodically clean local merged branches:

```bash
git fetch -p
git branch --merged main
```

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
