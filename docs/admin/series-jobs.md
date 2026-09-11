# Series Jobs

The TV Series tab (`/admin/ops/jobs`) — the series-side pipeline, including episodes.

![Admin Jobs](../images/admin/admin-jobs.png)

## The Pipeline

| Job | Default schedule | What it does |
|-----|------------------|--------------|
| `sync-series` | every 3 h at :10 | Pull the series library and episodes from the media server |
| `sync-series-watch-history` | **every hour** | Episode-level play states and progress for all users — hourly because episode data changes faster than movies |
| `generate-series-embeddings` | every 6 h at :20 | Embeds **series and episodes** — episode vectors power the assistant's episode search |
| `generate-series-recommendations` | **weekly, Sunday 04:00** | Score and select per-user series picks (activity gate applies to scheduled runs) |
| `sync-series-libraries` | every 3 h at :30 | Rebuild the "AI Picks - TV Series" libraries from the newest completed run |
| `enrich-metadata` | every 6 h | TMDb+OMDb enrichment (Global tab — shared with movies) |

Jobs are **not chained** — the staggering is for load-spreading, not sequencing. The one ordering rule that matters: **watch history before recommendations** (runs exclude watched episodes; the job syncs history itself as a safety net, but after a big import, run history manually first).

## Scheduled vs Manual Runs

- **Scheduled runs** skip users with no new activity since their last run
- **Manual runs** (the Run button, or per-user from [user management](user-management.md)) always execute
- Every schedule is editable per job (see [Job scheduling](job-scheduling.md))

## Full Reset

`full-reset-series-recommendations` deletes **all** series recommendations and rebuilds from scratch — **manual-only**, with a warning dialog before it runs. It re-scores everything (minutes of model calls); reserve it for embedding-model or algorithm changes, and prefer per-user regeneration otherwise.

## Episode Embeddings

The largest embedding tables in a real library are the **episode** tables — a long-running show contributes thousands of vectors:

- Episode vectors are gated by the **episode embeddings** toggle on the [Embeddings](embedding-models.md) page — with it off, this job embeds series only
- The assistant's episode search exists **only** when episode embeddings are enabled and populated
- Watch storage: the [Embeddings](embedding-models.md) page shows per-set sizes, and episodes dominate them

## Season 00 (Specials) Handling

The library writer keeps specials from jumping the queue on Emby shelves:

- Season 00 is written as a **hidden placeholder** entry with a future `dateadded`, so it sorts last rather than first
- Its NFO plot carries an explanatory note, so it's identifiable if it's ever seen
- Nothing is skipped — specials remain playable and progress-tracked

## Reading the Results

- `selected_rank` from the newest completed run drives the AI Picks library ordering and burned-in poster badges
- A failed run leaves the previous picks in place — check the run history and logs before assuming "no recommendations"
- Series watched-state exclusions treat **5%+ episode progress** as "watched" for recommendation purposes

---

**Related:** [Jobs overview](jobs-overview.md) · [Movie jobs](movie-jobs.md) · [Embedding models](embedding-models.md)
