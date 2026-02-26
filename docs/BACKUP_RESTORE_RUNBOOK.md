# Backup + Restore Runbook

Updated: 2026-02-26

## Scope

This runbook covers PostgreSQL logical backups (`pg_dump` custom format) and restore validation into a temporary database.

## Prerequisites

- `DATABASE_URL` points to PostgreSQL (example: `postgresql+asyncpg://postgres:postgres@localhost:5432/scraper`)
- `pg_dump` and `pg_restore` available in `PATH`
- Python dependencies installed from `requirements.txt`

## Manual backup + restore validation

1. Run:

```bash
python scripts/db_backup_restore.py --label manual --validate-restore
```

2. Verify output contains:
- `"restore_validation": {"ok": true, ...}`
- non-zero `"tables_count"`
- `backup_file` and `sha256`

3. Inspect artifacts:
- backup file: `artifacts/backups/*.dump`
- metadata: `artifacts/backups/*.dump.metadata.json`

## Manual backup only (without restore check)

```bash
python scripts/db_backup_restore.py --label manual
```

## Automation

- Workflow: `.github/workflows/backup-restore-validation.yml`
- Triggers:
  - weekly schedule (`Sunday 02:00 UTC`)
  - manual (`workflow_dispatch`)
- It runs migrations, creates backup, validates restore, and uploads backup artifacts.

## Incident fallback (high level)

1. Select latest valid backup metadata with `"restore_validation.ok": true`.
2. Restore to target DB with `pg_restore`.
3. Run smoke checks (`/api/v1/live`, `/api/v1/ready`, key business flows).
4. Record restore timestamp and backup hash in incident log.
