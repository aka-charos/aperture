# Movie Jobs

The Movies tab (`/admin/ops/jobs`) — the movie-side pipeline from sync to shelves.

## The Pipeline

| Job | Default schedule | What it does |
|-----|------------------|--------------|
| `sync-movies` | every 3 h | Pull the movie library from the media server |
| `sync-movie-watch-history` | every 2 h | Pull play states and progress for all users (runs before embeddings by design) |
| `generate-movie-embeddings` | every 6 h at :10 | Embed new/changed movies with the current [embedding model](embedding-models.md) |
| `generate-movie-recommendations` | **weekly, Sunday 04:00** | Score and select per-user picks (activity gate applies to scheduled runs) |
| `sync-movie-libraries` | every 3 h at :20 | Rebuild the legacy "AI Picks - Movies" libraries from the newest completed run. Writes nothing while legacy library output is off ([Output format](output-format.md)) |
| `enrich-metadata` | every 6 h | TMDb+OMDb enrichment (Global tab — shared with series) |

Jobs are **not chained** — schedules overlap deliberately and each job claims its own slot (a second start of the *same* job is refused with 409). The one ordering-sensitive case: **watch history before recommendations**, because runs exclude what you've watched. The recommendation job syncs history itself as a safety net, but after a big import, run history manually first.

## Scheduled vs Manual Runs

- **Scheduled runs** consult an **activity gate** — a user with nothing new since their last run is skipped, saving model spend
- **Manual runs** (the Run button, or per-user from [user management](user-management.md)) always execute
- Defaults are seeds: every schedule is editable per job (see [Job scheduling](job-scheduling.md))

## Full Reset

`full-reset-movie-recommendations` deletes **all** movie recommendations and rebuilds from scratch. It is **manual-only** and shows a warning dialog before running — it discards the current run's candidates and evidence and re-scores everything, which is minutes of paid model calls. Use it after meaningful changes (embedding model, algorithm weights, taste-profile rebuild), not on a schedule.

## Reading the Results

- The run stores `selected_rank` — the order on My Recommendations, and in the legacy AI Picks libraries and their poster badges
- [Emby home rows](home-rows.md) and library builds pick up the **newest completed** run; a failed recommendation run leaves the previous picks in place
- Each viewer's recommendations are limited to the libraries they can open ([User permissions](user-permissions.md#which-titles-a-user-sees)); a viewer with no movie library gets no movie run
- Explanations generate within the run (see [AI explanations](ai-explanations.md)); the separate `refresh-recommendation-explanations` job rewrites them without re-scoring

---

**Related:** [Jobs overview](jobs-overview.md) · [Series jobs](series-jobs.md) · [Embedding models](embedding-models.md)
