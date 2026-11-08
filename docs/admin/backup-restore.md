# Backup & Restore

Protect your data with automatic and manual backups, and restore from the admin panel.

## Where It Lives

Admin console → **Operations** → **Backup & restore** (`/admin/ops/backup`). The setup wizard's first step can also restore a backup into a fresh instance.

## Backups

- **Format** — `pg_dump` **custom format**, compressed: `aperture_backup_YYYY-MM-DD_HH-MM-SS.dump` (legacy `.sql`/`.sql.gz` files are still accepted for restore)
- **Backup Now** — run one immediately; in-progress backups can be **cancelled**
- **Upload Backup** — bring a `.dump`, `.sql` or `.sql.gz` file from elsewhere into the list, up to 50 GB. A reverse proxy in front of the app may set a lower limit of its own. Uploads stay until you delete them; retention never removes them. An upload marked as cut off was made under the old 10 MB limit and can't be restored: upload it again and delete that copy. For a larger file, copy it into the backup folder yourself, with a name starting `aperture_uploaded_`.
- **Automatic** — the `backup-database` job runs **daily at 2:00 AM** (editable like any job)
- Configured on this page: **Backup Path** (default `/backups` — mount it in docker-compose) and **Backups to Retain** (1–100, default 7; older files are pruned after each backup)

## Restore

Restoring replaces the whole database, so the panel makes you prove it:

1. Click restore on a backup
2. Type **RESTORE** to confirm
3. Aperture **creates a pre-restore safety backup first**. If that backup fails, the restore stops and nothing changes. You can skip it in the dialog when you already have a recent copy; on a large database it roughly doubles the wait.
4. Aperture reads the backup through to the end, then applies it in **one transaction**, replacing everything in the database except its extensions
5. It brings the restored data up to date with this version, so a backup older than the app works. If this step fails, the data has been restored and the error asks you to restart the app.

A `.sql` or `.sql.gz` file must end with the closing line `pg_dump` writes, so a file that was cut off is refused before anything changes. A hand-written SQL file is refused for the same reason, and so is a file that doesn't hold the whole database, such as a `pg_dump -t` export of a few tables, since restoring it would remove everything it leaves out.

A restore either completes or leaves the data as it was. If it fails at any point, the error appears on this page and nothing has been replaced.

While it runs:

- **The app is unavailable to everyone.** The API answers 503 until the transaction ends, and anyone opening the app sees a waiting screen. This page still shows progress, and you can leave it and come back in the same browser tab. Another tab can't show progress.
- **If the server stops answering,** the page says so after a minute and keeps asking, so a lost connection isn't mistaken for a slow restore. If the server restarted, the page tells you it lost track of the job. Check the backup list and the server log to see how it ended.
- **Let running jobs finish first.** A restore doesn't stop them. One that holds a table too long makes the restore fail safely, but one that finishes in time carries on working from what it read before the restore.
- **Only one restore can run at a time.** A second one is refused straight away.
- **It stops rather than waits forever.** If another task holds a table for more than a minute, the restore fails, nothing changes, and the error tells you to try again once running jobs have finished.
- **It needs free disk space in the backup folder**, for a temporary copy of the backup as plain SQL. That is much larger than the compressed file. The database also needs room to hold the old and new data until the transaction ends.

Sessions come from the backup as well, so you may need to sign in again afterwards. Reload when the page offers it. You don't need to restart the app, unless the error says so or you've turned `RUN_MIGRATIONS_ON_START` off, in which case run your migrations first.

The safety backup is your undo path once a restore has succeeded.

## What's in a Backup

Everything in Postgres: content, embeddings, users, settings, assistant conversations. **Not** included: generated library files on disk (STRM/symlinks — rebuilt by the library jobs) and uploaded images living on the volume.

## Cron/External Backups

`pg_dump -F c` against `DATABASE_URL` works from outside the container too — same restore path via `pg_restore`. See [External database](external-database.md) for the compose variant that keeps Postgres outside Aperture's container.

## Client and Server Versions

The app's image carries the **PostgreSQL 18** client tools, ahead of the bundled PostgreSQL 16 database on purpose:

- `pg_dump` works against any server up to its own major, so an 18 client backs up a 16, 17 or 18 database. Moving the database past 18 needs a newer image first, or backups stop; the startup log says so.
- Files written by a 17 or 18 client can only be read by a 17 or newer `pg_restore`. The tools inside a PostgreSQL 16 database container refuse them (`unsupported version (1.16) in file header`).

**Restore through the app whenever it runs.** **Restore** above uses the app's own tools, empties the schema first so a backup older than the app restores cleanly, and applies everything in one transaction, so a failure changes nothing.

**By hand, only into an empty database**, for example a fresh volume on a new host before the app has started. A newer client's `pg_restore` always sends `SET transaction_timeout = 0`, which PostgreSQL 16 refuses, and a restore that carries on past an error can leave some tables replaced and others not. So convert the backup to SQL, drop that line, and apply it in one transaction that stops at the first error:

```bash
docker run --rm -i --network container:aperture-db -e PGPASSWORD=app pgvector/pgvector:pg18 sh -c "pg_restore --no-owner --no-acl --file=- | sed '/^SET transaction_timeout = 0;$/d' | psql -h 127.0.0.1 -U app -d aperture --single-transaction -v ON_ERROR_STOP=1" < backup.dump
```

Replace `aperture-db` with your database container's name, and `app` (password, user) and `aperture` (database) with the values in your `DATABASE_URL`. With an [external database](external-database.md), drop `--network container:…` and point `-h` at its host. The command prints `COMMIT` at the end when it worked; on any error it rolls back and the database stays empty.

---

**Related:** [Database management](database-management.md) · [External database](external-database.md) · [Job scheduling](job-scheduling.md)
