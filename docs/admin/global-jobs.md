# Global Jobs

The Global tab (`/admin/ops/jobs`) holds every job that spans media types or serves the whole instance. Default schedules below are seeds — edit any of them per job (see [Job scheduling](job-scheduling.md)).

![Admin Jobs](../images/admin/admin-jobs.png)

## Metadata Enrichment

| Job | Default schedule | What it does |
|-----|------------------|--------------|
| `enrich-metadata` | every 6 hours | TMDb (keywords, collections, crew) + OMDb (RT/Metacritic, awards) for un-enriched titles |
| `enrich-mdblist` | daily 07:00 | Letterboxd/MDBList scores, streaming providers, keywords ([MDBList](mdblist.md)) |
| `enrich-studio-logos` | daily 05:30 | Studio/network logos for stats and studio pages |
| `refresh-ratings` | daily 02:30 | IMDb-dataset rating freshness — **opt-in** sources ([Ratings refresh](ratings-refresh.md)) |

The ratings job runs deliberately ahead of the recommendation run, so a regenerate scores against ratings refreshed the same night — and deliberately outside enrichment, which stamps a title once and never revisits it.

## Curated Libraries

| Job | Default schedule | What it does |
|-----|------------------|--------------|
| `sync-movie-libraries` / `sync-series-libraries` | every 3 h (staggered :20/:30) | Rebuild AI Picks libraries (cards live on the media-type tabs) |
| `refresh-top-picks` | daily 05:00 | Re-rank [Top Picks](top-picks.md) and rewrite their output |
| `auto-request-top-picks` | weekly, Sunday 00:00 | Optionally auto-request missing popular titles via Seerr (per-media switches + a per-run cap) |

## Discovery & Suggestions

| Job | Default schedule | What it does |
|-----|------------------|--------------|
| `reconcile-discovery-requests` | daily 04:30 | Pull live request statuses from Seerr — **ahead of suggestions on purpose**: reconciling first is what lets a title declined in Seerr come back in the same night's run rather than a day later |
| `generate-discovery-suggestions` | daily 06:00 | Re-score the discovery pool; requires **Seerr configured** and enabled users (the job reports its unmet prerequisites instead of running) |

## Taste Profiles & Explanations

| Job | Default schedule | What it does |
|-----|------------------|--------------|
| `rebuild-taste-profiles` | manual | Rebuild every user's profile, clusters, and detected preferences — deliberately manual: each profile carries its own refresh interval, this exists for the one-off sweep after an algorithm change |
| `refresh-recommendation-explanations` | manual | Rewrite explanations for the newest completed run **without re-scoring** — use after changing the Text Generation model or to repair generic fallbacks; cancellable |

## Title Analysis, Ratings & Evaluation

| Job | Default schedule | What it does |
|-----|------------------|--------------|
| `generate-title-analysis` | manual | Write critic-informed analyses for titles that have none, current recommendations first (each title costs a web search, a few page fetches, one model call) |
| `evaluate-recommender` | manual | Offline holdout evaluation — reads only, changes nothing ([Evaluation](evaluation.md)) |
| `refresh-library-gaps` | manual | Re-scan TMDb collections vs the library ([Gap analysis](gap-analysis.md)); never requests via Seerr |
| `refresh-embedding-centering` | manual | Recompute the library mean and re-centre every vector — normally automatic; reach for it to repair a populated-but-wrong column, and run `rebuild-taste-profiles` after |

## Integrations & Housekeeping

| Job | Default schedule | What it does |
|-----|------------------|--------------|
| `sync-trakt-ratings` | every 6 h at :30 | One-way Trakt → Aperture rating import for connected users (push on rate is immediate) |
| `sync-watching-favorites` | hourly at :30 | Two-way reconcile of [Shows You Watch](shows-you-watch.md) with media-server favorites |
| `sync-lldap-emails` | daily 03:15 | Import emails from [LLDAP](lldap.md) by username match |
| `sync-users` | every 30 min | User import from the media server (new users, email/admin status) |
| `backup-database` | daily 02:00 | Scheduled backup ([Backup & restore](backup-restore.md)) |
| `cleanup-auth-state` | daily 03:30 | Delete expired/idle sessions and stale failed-login counters |
| `refresh-assistant-suggestions` | weekly, Sunday 00:00 | Refresh the chat welcome-screen suggestion chips from the newest completed run |
| `refresh-ai-pricing` | weekly, Sunday 00:00 | Refresh the LLM pricing catalog (Helicone) used by the [cost estimator](cost-estimate.md) |

Four of these have **no job card** — `sync-users`, `backup-database`, `cleanup-auth-state`, `refresh-library-gaps` appear only on the Schedule tab.

---

**Related:** [Jobs overview](jobs-overview.md) · [Job scheduling](job-scheduling.md) · [Recommended workflow](recommended-workflow.md)
