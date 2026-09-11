# Job Scheduling

Configure when background jobs run — per job, from the jobs console.

![Admin Jobs](../images/admin/admin-jobs.png)

## Where It Lives

Admin console → **Operations** → **Jobs** (`/admin/ops/jobs`):

- **Gear / "Configure schedule"** on any job card opens its schedule dialog
- The **Schedule tab** lists all 34 jobs — including the card-less ones (`sync-users`, `backup-database`, `cleanup-auth-state`, `refresh-library-gaps`) — with an **Enabled toggle**, next run, last run, duration, and status

## Schedule Types

| Type | Meaning |
|------|---------|
| **Daily** | Once a day at a set time |
| **Weekly** | Chosen days of the week (multi-day) |
| **Every 2 weeks** | Biweekly gate on a weekly pattern |
| **Interval** | Every N minutes/hours — down to 15 or 30 minutes |
| **Manual only** | Never schedules; only the **Run** button fires it |

Disabled jobs can also be flipped off directly from the Schedule tab.

## Defaults Worth Knowing

- Syncs: library syncs every 3 h (staggered), movie watch history every 2 h, **series watch history hourly**, users every 30 min
- Embeddings: every 6 h (staggered :10/:20)
- Recommendations: **weekly, Sunday 04:00**; Top Picks daily 05:00; backup 02:00; `refresh-ai-pricing` weekly Sunday 00:00
- Several jobs are **manual by default**: metadata enrichment in some setups (`enrich-metadata` seeds every-6h via job config), taste-profile rebuilds, explanation refreshes, title analysis, evaluation, gap analysis
- Effective schedules come from the `job_config` table seeded with defaults — the definitions' cron fields are documentation, the table is truth

## Timezone and Missed Runs

- Schedules run in the server's timezone, defaulting to **`America/New_York`** unless `TZ` is set in the API container — set `TZ` to your timezone in docker-compose
- **Missed runs are not caught up.** If the API is down at the firing time, that run is skipped until the next schedule. Run the job manually after downtime

---

**Related:** [Jobs overview](jobs-overview.md) · [Global jobs](global-jobs.md) · [Backup & restore](backup-restore.md)
