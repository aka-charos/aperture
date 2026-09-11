# Ratings Refresh

Ratings change; plots and cast lists do not. Metadata enrichment fetches a title **once and never looks again** — correct for prose, wrong for a number that moves every week (measured live: one film's IMDb vote count sat 28% below the truth, and the error is biased — new releases' ratings decay from an enthusiastic start, so stale copies systematically **overrate recent films**).

This integration re-fetches the numbers the recommender actually scores on.

## Where It Lives

Admin console → **Integrations** → **Ratings refresh** (`/admin/integrations/ratings`). A green **Active** chip appears when any source is enabled.

## Sources

One source today, **off by default** (the cost is a licence, not a quota):

**IMDb dataset** — IMDb publishes `title.ratings.tsv.gz` daily under a **non-commercial-use licence** (terms linked from the page). One **~8 MB download covers the whole library**: no API key, no rate limit, fresher than per-title fetching.

The page shows live coverage: *"N of M titles have a stored IMDb rating"* and when it last ran — with "Never run" deliberately distinguished from "ran, found nothing".

## How the Job Works

`refresh-ratings` runs **daily at 02:30** — deliberately ahead of the recommendation run, so a regenerate scores against ratings refreshed the same night. The run:

1. Downloads and streams the dataset (~1.5M lines, rejected ~99% cheaply against your library's `imdb_id` set)
2. Updates `imdb_rating`, `imdb_vote_count`, and `imdb_ratings_refreshed_at` on matching movies **and** series (chunked writes, cancellation checked between chunks)
3. Stamps titles the dataset didn't know as *consulted* — a failed download stamps nothing, so a failed run is indistinguishable from never ran

Nothing enabled → the job completes cleanly with "No rating sources are enabled — nothing to refresh" (not a failure). Per-source failures are logged and other sources still run.

## Why It's Not Part of Enrichment

Enrichment's predicate is "never enriched or schema behind" — no TTL — which is right for a plot and wrong for a moving number. That separation is deliberate; see the job's own description on the [Jobs](jobs-overview.md) console.

---

**Related:** [OMDb](omdb.md) · [Jobs overview](jobs-overview.md) · [Algorithm tuning](algorithm-tuning.md)
