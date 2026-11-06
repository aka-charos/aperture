# Backup & Restore

Protect your data with automatic and manual backups, and restore from the admin panel.

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
3. Aperture **creates a pre-restore safety backup first**. If that backup fails, the restore stops and nothing changes. You can skip it in the dialog when you already have a recent copy; on a large database it roughly doubles the wait.
4. Aperture reads the backup through to the end, then applies it in **one transaction**

A restore either completes or leaves the data as it was. If it fails at any point, the error appears on this page and nothing has been replaced.

While it runs:

- **The app is unavailable to everyone.** The API answers 503 until the transaction ends, and sign-in waits too. Keep the page open, since it is the one place that still shows progress.
- **It needs free disk space in the backup folder**, for a temporary copy of the backup as plain SQL. That is much larger than the compressed file. The database also needs room to hold the old and new data until the transaction ends.

Sessions come from the backup as well, so you may need to sign in again afterwards. Reload when the page offers it.

The safety backup is your undo path once a restore has succeeded.

## What's in a Backup

Everything in Postgres: content, embeddings, users, settings, assistant conversations. **Not** included: generated library files on disk (STRM/symlinks — rebuilt by the library jobs) and uploaded images living on the volume.

## Cron/External Backups

`pg_dump -F c` against `DATABASE_URL` works from outside the container too — same restore path via `pg_restore`. See [External database](external-database.md) for the compose variant that keeps Postgres outside Aperture's container.

---

**Related:** [Database management](database-management.md) · [External database](external-database.md) · [Job scheduling](job-scheduling.md)
