# Post-Setup Checklist

After the Setup Wizard, work through this to get Aperture fully operational.

![Admin Jobs](../images/admin/admin-jobs.png)

## 1. Users

**Access → Users** (`/admin/access/users`):

- Users sync automatically every 30 minutes; **Sync Users** forces it. Provider users not yet imported can be imported from the list
- Enable **Movies / Series** per user (a user with neither gets nothing)
- Give permissions where warranted — **Discovery, content requests, collections access** (see [User permissions](user-permissions.md))

## 2. Integrations

**Integrations** group, in order of impact:

- **TMDB** (required for enrichment, genre strips, discovery tuning, gap analysis)
- **OMDb** (scores everywhere)
- **Seerr** (requests + issue reporting) — then grant per-user request permissions
- **Trakt** (users connect individually), **MDBList**, the rest as desired

## 3. AI Roles

**AI models → Providers & roles**: all four core roles configured (the wizard required this — verify the keys are the ones you want long-term). Check the **Embeddings** page shows coverage after the first embedding jobs run.

## 4. Verify the Pipeline Ran

**Operations → Jobs** (`/admin/ops/jobs`) — check history (green runs, logs) for:

1. `sync-movies` / `sync-series` — content in the library
2. `sync-movie-watch-history` / `sync-series-watch-history`
3. `generate-movie-embeddings` / `generate-series-embeddings`
4. `generate-movie-recommendations` / `generate-series-recommendations`
5. `sync-movie-libraries` / `sync-series-libraries` — AI Picks libraries appear in Emby/Jellyfin

The wizard's last step runs all of these; if any show red, open its logs before going further.

## 5. Output Sanity

- Libraries appear on the media server with **rank badges burned into posters**
- Open an AI Picks library on a TV/client — sort order should read #1 down
- Spot-check the [File locations](file-locations.md) mapping if the server sees nothing

## 6. Schedules

Review the **Schedule tab** against your household's rhythm (recommendations at 04:00 may not suit you). Set `TZ` in the API container so times mean what you think.

## 7. Backups

Confirm `backup-database` is enabled, the **Backup Path** is mounted, and a manual **Backup Now** round-trips.

---

**Related:** [Setup wizard](setup-wizard.md) · [Recommended workflow](recommended-workflow.md) · [User permissions](user-permissions.md)
