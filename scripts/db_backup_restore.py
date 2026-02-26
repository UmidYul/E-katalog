from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shutil
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


@dataclass(frozen=True)
class DbConn:
    host: str
    port: int
    user: str
    password: str
    database: str


def _conn_from_database_url(database_url: str) -> DbConn:
    normalized_url = database_url.replace("postgresql+asyncpg://", "postgresql://").replace(
        "postgresql+psycopg://", "postgresql://"
    )
    parsed = urlparse(normalized_url)
    if parsed.scheme != "postgresql":
        raise ValueError("Only PostgreSQL DATABASE_URL is supported")
    if not parsed.hostname or not parsed.path or not parsed.username:
        raise ValueError("DATABASE_URL must include host, database and username")
    database = parsed.path.lstrip("/")
    if not database:
        raise ValueError("DATABASE_URL must include database name")
    return DbConn(
        host=str(parsed.hostname),
        port=int(parsed.port or 5432),
        user=unquote(str(parsed.username)),
        password=unquote(str(parsed.password or "")),
        database=unquote(database),
    )


def _run(cmd: list[str], *, password: str) -> None:
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    subprocess.run(cmd, check=True, env=env)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_backup(*, conn: DbConn, output_dir: Path, label: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    filename = f"{timestamp}_{label}_{conn.database}.dump"
    backup_path = output_dir / filename
    cmd = [
        "pg_dump",
        "-h",
        conn.host,
        "-p",
        str(conn.port),
        "-U",
        conn.user,
        "-d",
        conn.database,
        "-F",
        "c",
        "-f",
        str(backup_path),
        "--no-owner",
        "--no-privileges",
    ]
    _run(cmd, password=conn.password)
    return backup_path


def _drop_database(conn: DbConn, database: str) -> None:
    import psycopg

    admin_dsn = f"host={conn.host} port={conn.port} user={conn.user} password={conn.password} dbname=postgres"
    with psycopg.connect(admin_dsn, autocommit=True) as pg:
        with pg.cursor() as cur:
            cur.execute("select pg_terminate_backend(pid) from pg_stat_activity where datname = %s", (database,))
            cur.execute(f'drop database if exists "{database}"')


def validate_restore(*, conn: DbConn, backup_path: Path) -> dict[str, object]:
    import psycopg

    temp_db = f"restore_check_{secrets.token_hex(4)}"
    admin_dsn = f"host={conn.host} port={conn.port} user={conn.user} password={conn.password} dbname=postgres"
    try:
        with psycopg.connect(admin_dsn, autocommit=True) as pg:
            with pg.cursor() as cur:
                cur.execute(f'create database "{temp_db}"')

        restore_cmd = [
            "pg_restore",
            "-h",
            conn.host,
            "-p",
            str(conn.port),
            "-U",
            conn.user,
            "-d",
            temp_db,
            "--no-owner",
            "--no-privileges",
            str(backup_path),
        ]
        _run(restore_cmd, password=conn.password)

        restored_dsn = f"host={conn.host} port={conn.port} user={conn.user} password={conn.password} dbname={temp_db}"
        with psycopg.connect(restored_dsn) as pg:
            with pg.cursor() as cur:
                cur.execute("select count(*) from information_schema.tables where table_schema = 'public'")
                tables_count = int(cur.fetchone()[0])
                cur.execute("select exists (select 1 from public.alembic_version)")
                has_alembic_version = bool(cur.fetchone()[0])
        return {
            "ok": True,
            "temp_database": temp_db,
            "tables_count": tables_count,
            "has_alembic_version": has_alembic_version,
        }
    finally:
        _drop_database(conn, temp_db)


def main() -> int:
    parser = argparse.ArgumentParser(description="Create PostgreSQL backup and optionally validate restore.")
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="SQLAlchemy-style DATABASE_URL. Defaults to env DATABASE_URL.",
    )
    parser.add_argument("--output-dir", default="artifacts/backups", help="Backup directory.")
    parser.add_argument("--label", default="manual", help="Backup label.")
    parser.add_argument("--validate-restore", action="store_true", help="Restore backup into temporary DB and validate.")
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("DATABASE_URL is required (argument or env)")
    if shutil.which("pg_dump") is None:
        raise SystemExit("pg_dump is required in PATH")
    if args.validate_restore and shutil.which("pg_restore") is None:
        raise SystemExit("pg_restore is required in PATH when --validate-restore is set")

    conn = _conn_from_database_url(args.database_url)
    backup_path = create_backup(conn=conn, output_dir=Path(args.output_dir), label=args.label)
    backup_hash = _sha256(backup_path)
    metadata: dict[str, Any] = {
        "created_at": datetime.now(UTC).isoformat(),
        "database": conn.database,
        "backup_file": str(backup_path),
        "size_bytes": backup_path.stat().st_size,
        "sha256": backup_hash,
        "restore_validation": {"ok": False},
    }
    if args.validate_restore:
        metadata["restore_validation"] = validate_restore(conn=conn, backup_path=backup_path)

    meta_path = Path(f"{backup_path}.metadata.json")
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
