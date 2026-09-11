# Recommended Workflow

A sane operating rhythm for Aperture, based on how the jobs actually behave.

![Admin Jobs](../images/admin/admin-jobs.png)

## The Default Rhythm

The scheduler (default seeds — all editable, see [Job scheduling](job-scheduling.md)):

| Cadence | Jobs |
|---------|------|
| Every 30 min | `sync-users` |
| Hourly | `sync-series-watch-history` (movies every 2 h) |
| Every 3 h | `sync-movies` / `sync-series`, staggered library builds |
| Every 6 h | `enrich-metadata`, movie/series embeddings (staggered) |
| Daily | backup 02:00, ratings refresh 02:30 (ahead of the rec run), reconcile requests 04:30, Top Picks 05:00, studio logos 05:30, discovery 06:00, MDBList 07:00 |
| Weekly (Sunday) | **recommendations 04:00**, Top Picks auto-request 00:00, assistant suggestions 00:00, AI pricing refresh 00:00 |

**Embeddings and enrichment are safe to leave on their defaults**; the pipeline is incremental (new/changed titles only). Recommendations are **weekly** by design: a scheduled run skips users with no new activity anyway, so mid-week regeneration happens through the per-user Regenerate button or a manual job run.

## Order of Operations (When It Matters)

Jobs aren't chained, but these orderings are real constraints:

- **Watch history before recommendations** — the runs exclude what you've watched; the recommendation job syncs history itself as a safety net, but after big syncs run history manually first
- **Embeddings before recommendations** after changing the [embedding model](embedding-models.md) — plus `refresh-embedding-centering` and `rebuild-taste-profiles` (both manual)
- **Enrichment before discovery** — genre strips and discovery quality depend on enriched metadata

## Manual-Only Tools, and When to Reach for Them

| Job | When |
|-----|------|
| `full-reset-movie/series-recommendations` | After a taste-profile reset or weight overhaul — per user, expensive |
| `refresh-recommendation-explanations` | Toggled explanations back on, or changed the text model — no re-scoring |
| `rebuild-taste-profiles` | After embedding-model changes or large library imports |
| `generate-title-analysis` | Batch-generate essays for the library |
| `evaluate-recommender` | Before/after algorithm changes — offline holdout metrics |
| `refresh-library-gaps` | Refresh the missing-collections report |

## Ongoing Care

- Watch the **[API errors](api-errors.md)** panel on integration pages — keys and quotas fail visibly
- **Backups**: verify the 2 AM job's history occasionally; retention keeps 7 by default
- **Database growth**: episode embeddings dominate; the [Embeddings](embedding-models.md) page shows per-set sizes and reclaims space

## After Downtime

Missed schedules don't catch up — after an outage, run the missed criticals manually (syncs, then recommendations).

---

**Related:** [Job scheduling](job-scheduling.md) · [Jobs overview](jobs-overview.md) · [Backup & restore](backup-restore.md)
