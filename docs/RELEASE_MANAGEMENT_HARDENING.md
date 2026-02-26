# Release Management Hardening

Updated: 2026-02-26

## 1) Staging parity baseline

- [x] Dockerized full stack path exists (`infra/docker/docker-compose.yml`).
- [x] DB migration flow documented and automated in CI paths.
- [ ] Enforce explicit staging env matrix parity check before production promotion.

## 2) Post-deploy smoke tests

Required checks after each deploy:

- [ ] `GET /api/v1/health` returns `200`.
- [ ] `GET /api/v1/ready` returns `200`.
- [ ] `GET /api/v1/metrics` responds with Prometheus payload.
- [ ] Frontend home/catalog/PDP/compare pages render and hydrate.
- [ ] Auth login + token refresh + logout happy path passes.

## 3) Rollback runbook

Rollback minimum steps:

1. Freeze new deploys and announce incident.
2. Roll back app image tag for API/frontend/worker.
3. If migration introduced incompatible schema changes, execute backward-safe DB rollback plan.
4. Re-run smoke tests.
5. Publish incident status and ETA.

## 4) Release gate checklist

- [ ] Migration reviewed for backward compatibility.
- [ ] Feature flags set for risky rollout paths.
- [ ] On-call owner assigned for release window.
- [ ] Rollback owner assigned and runbook link included in release notes.
