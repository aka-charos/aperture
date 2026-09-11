# Backup & Restore

Protect your data with automatic and manual backups, and restore from the admin panel.

![Admin Settings - System](../images/admin/admin-settings-system.png)

## Where It Lives

Admin console → **Operations** → **Backup & restore** (`/admin/ops/backup`). The setup wizard's first step can also restore a backup into a fresh instance.

## Backups

- **Format** — `pg_dump` **custom format**, compressed: `aperture_backup_YYYY-MM-DD_HH-MM-SS.dump` (legacy `.sql`/`.sql.gz` files are still accepted for restore)
- **Backup Now** — run one immediately; in-progress backups can be **cancelled**
- **Upload Backup** — bring a file from elsewhere into the list
- **Automatic** — the `backup-database` job runs **daily at 2:00 AM** (editable like any job)
- Configured on this page: **Backup Path** (default `/backups` — mount it in docker-compose) and **Backups to Retain** (1–100, default 7; older files are pruned after each backup)

## Restore

Restoring replaces the whole database, so the panel makes you prove it:

1. Click restore on a backup
2. Type **RESTORE** to confirm
3. Aperture **creates a pre-restore safety backup first**, then runs `pg_restore --clean --if-exists`

The safety backup is your undo path — a bad restore can itself be restored.

## What's in a Backup

Everything in Postgres: content, embeddings, users, settings, assistant conversations. **Not** included: generated library files on disk (STRM/symlinks — rebuilt by the library jobs) and uploaded images living on the volume.

## Cron/External Backups

`pg_dump -F c` against `DATABASE_URL` works from outside the container too — same restore path via `pg_restore`. See [External database](external-database.md) for the compose variant that keeps Postgres outside Aperture's container.

---

**Related:** [Database management](database-management.md) · [External database](external-database.md) · [Job scheduling](job-scheduling.md)
