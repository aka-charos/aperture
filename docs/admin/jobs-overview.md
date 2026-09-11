# Jobs Overview

Background jobs power everything periodic in Aperture — syncing, embeddings, recommendations, backups. This is the operations surface for all 34 of them.

![Admin Jobs](../images/admin/admin-jobs.png)

## Where It Lives

Admin console → **Operations** → **Jobs** (`/admin/ops/jobs`). Tabs: **Movies / TV Series / Global** job cards, plus a **Schedule** tab listing every job (including a few that have no card) with enable toggles.

A **Running Jobs** widget in the app bar shows what's active from anywhere.

## How Execution Works

- **One slot per job** — starting a job that's already running is rejected ("Job is already running"). *Different* jobs run concurrently; there is no queue and no sequencing
- **Cancel is cooperative** — "Stop Job" asks for confirmation, then the job checks the cancel flag between units of work (important for paid-model jobs: a cancelled explanation job keeps what it already paid for)
- **No auto-retry, no priority system** — a failed job waits for its next schedule or a manual run
- **Per-job history** — the history dialog shows past runs with their logs; job cards also offer an inline "Show Logs (n)" toggle
- Scheduled recommendation runs consult an **activity gate** (a user with no new activity may be skipped) — manual runs always execute
- AI work done inside jobs is attributed per job in the [AI spend](ai-providers.md) dashboard

## Job States

Jobs are **running** or **idle**. Past runs are completed, failed, or cancelled. There is no "queued" state — a job refused to start is simply refused.

## Failure Surfaces

- The run history shows the failure and its logs
- Integration failures additionally raise [API error](api-errors.md) alerts on the integration pages
- Interrupted metadata enrichment offers a **Resume / Dismiss** banner on the jobs page
- The discovery job reports its unmet prerequisites instead of running (e.g. Seerr not configured)

---

**Related:** [Job scheduling](job-scheduling.md) · [Global jobs](global-jobs.md) · [Movie jobs](movie-jobs.md)
