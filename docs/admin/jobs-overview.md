# Jobs Overview

Background jobs power everything periodic in Aperture — syncing, embeddings, recommendations, backups. This is the operations surface for all 39 of them.

## Where It Lives

Admin console → **Operations** → **Jobs** (`/admin/ops/jobs`). Tabs: **Movies / TV Series / Global** job cards (34 jobs), plus a **Schedule** tab listing every job, including the five that have no card (`sync-users`, `refresh-assistant-suggestions`, `backup-database`, `cleanup-auth-state`, `refresh-library-gaps`), with enable toggles.

A **Running Jobs** widget in the app bar shows what's active from anywhere; each row in it opens that job's card with its log. The admin search (⌘⇧K / Ctrl+Shift+K) finds every job by name.

## How Execution Works

- **One slot per job** — starting a job that's already running is rejected ("Job is already running"). A cancelled job keeps its slot until it has actually stopped, and the refusal says so. *Different* jobs run concurrently; there is no queue and no sequencing
- **Cancel is cooperative** — "Stop Job" asks for confirmation, then the job checks the cancel flag between units of work (important for paid-model jobs: a cancelled explanation job keeps what it already paid for)
- **No auto-retry, no priority system** — a failed job waits for its next schedule or a manual run
- **Per-job history** — the history dialog shows past runs with their logs; job cards also offer an inline "Show Logs (n)" toggle
- Scheduled recommendation runs consult an **activity gate** (a user with no new activity may be skipped) — manual runs always execute
- AI work done inside jobs is attributed per job in the [AI spend](ai-spend.md) dashboard
- **Legacy library jobs** (`sync-movie-libraries`, `sync-series-libraries`, `refresh-top-picks`) do nothing while legacy library output is switched off on [Output format](output-format.md): their cards are greyed with the reason, and a scheduled run records itself as skipped

## Job States

Jobs are **running** or **idle**. Past runs are completed, failed, or cancelled. There is no "queued" state — a job refused to start is simply refused.

## Failure Surfaces

- The run history shows the failure and its logs
- Integration failures additionally raise [API error](api-errors.md) alerts on the integration pages
- Interrupted metadata enrichment offers a **Resume / Dismiss** banner on the jobs page
- The discovery job reports its unmet prerequisites instead of running (e.g. Seerr not configured)

---

**Related:** [Job scheduling](job-scheduling.md) · [Global jobs](global-jobs.md) · [Movie jobs](movie-jobs.md)
