# Job Scheduling

Configure when background jobs run — per job, from the jobs console.

## Where It Lives

Admin console → **Operations** → **Jobs** (`/admin/ops/jobs`):

- **Gear / "Configure schedule"** on any job card opens its schedule dialog
- The **Schedule tab** lists all 41 jobs — including the card-less ones (`sync-users`, `refresh-assistant-suggestions`, `backup-database`, `cleanup-auth-state`, `refresh-library-gaps`, `refresh-series-gaps`) — with an **Enabled toggle**, next run, last run, duration, and status

## Schedule Types

| Type | Meaning |
|------|---------|
| **Daily** | Once a day at a set time |
| **Weekly** | Chosen days of the week (multi-day) |
| **Every 2 weeks** | Biweekly gate on a weekly pattern |
| **Interval** | Every N minutes/hours — down to 15 or 30 minutes |
| **Manual only** | Never schedules; only the **Run** button fires it |

Disabled jobs can also be flipped off directly from the Schedule tab.

## Items Per Run

Some jobs work through a list and stop after a set number of items, then pick up where they left off on the next run. Their schedule dialog has an extra field for that cap, and the card shows it beside the schedule ("Up to 200 titles per run"). It applies to manual runs as well as scheduled ones; leave it blank for the job's default.

| Job | Unit | Default | Range |
|-----|------|---------|-------|
| `generate-title-analysis` | titles | 200 | 1–5,000 |
| `translate-title-synopses` | translations (title × language) | 300 | 1–20,000 |
| `translate-title-analyses` | translations (analysis × language) | 100 | 1–5,000 |

A run that is still going when its next firing is due makes that firing skip, so on a short interval pick a smaller number.

## Default Schedules

| Cadence | Jobs |
|---------|------|
| Every 15 min | `send-notification-emails` |
| Every 30 min | `sync-users` |
| Hourly | `sync-series-watch-history` (:05), `sync-watching-favorites` (:50) |
| Every 2 h | `sync-movie-watch-history` (:25) |
| Every 3 h | `sync-series` (:10), `sync-movie-libraries` (:20), `sync-series-libraries` (:35), `sync-movies` (:40) |
| Every 6 h | `enrich-metadata` (:00), `generate-movie-embeddings` (:10), `generate-series-embeddings` (:20), `sync-trakt-ratings` (:30) |
| Daily | `backup-database` 02:00, `refresh-ratings` 02:30, `sync-lldap-emails` 03:15, `cleanup-auth-state` 03:30, `reconcile-discovery-requests` 04:30, `refresh-top-picks` 05:00, `enrich-studio-logos` 05:30, `sync-home-sections` 05:45, `generate-discovery-suggestions` 06:00, `enrich-mdblist` 07:00 |
| Weekly, Sunday | `refresh-assistant-suggestions`, `refresh-ai-pricing` and `auto-request-top-picks` 00:00; `generate-movie-recommendations` and `generate-series-recommendations` 04:00 |
| Manual only | `full-reset-movie-recommendations`, `full-reset-series-recommendations`, `refresh-library-gaps`, `refresh-series-gaps`, `rebuild-taste-profiles`, `refresh-embedding-centering`, `refresh-recommendation-explanations`, `check-recommendation-explanations`, `evaluate-recommender`, `remove-legacy-libraries` |
| Manual by default, schedulable | `generate-title-analysis`, `translate-title-synopses`, `translate-title-analyses` (each one costs model calls, so a cadence is opted into) |

The order within a night is deliberate: ratings refresh before the recommendation run, reconciling Seerr before the discovery run, and home rows after Top Picks. The jobs that read the media server start on different minutes, away from `sync-users` on :00 and :30, so they don't all ask your server at once. Effective schedules come from the `job_config` table, seeded with these defaults — once you change one, the table is what runs.

Jobs that work the media server (the user, library, watch-history and favourites syncs, home-row sync, and the legacy library and Top Picks jobs) also take turns: one runs at a time, and the others wait. A waiting job shows **Queued** on its card and in the Schedule tab, and can be cancelled before it starts. A second **Run** of a queued job is refused, as for a running one.

The schedule dialog has a **Minute** field beside the time (and under the interval, for intervals of an hour or more). The 15- and 30-minute intervals always run on the quarter or half hour, so they have none.

## Timezone and Missed Runs

- Schedules run in the server's timezone, defaulting to **`America/New_York`** unless `TZ` is set in the API container — set `TZ` to your timezone in docker-compose. The schedule dialog names the zone, and the Schedule tab's **Next run** is worked out in it, so it is right whatever zone your browser is in
- **Missed runs are not caught up.** If the API is down at the firing time, that run is skipped until the next schedule. Run the job manually after downtime

---

**Related:** [Jobs overview](jobs-overview.md) · [Global jobs](global-jobs.md) · [Backup & restore](backup-restore.md)
