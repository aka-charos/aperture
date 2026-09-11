# Discovery Tuning

How much Discover fetches, how hard it filters, and what it ranks by — the knobs behind the user-facing [Discover](../features/discovery.md) pool.

## Where It Lives

Admin console → **Recommendations** → **Discovery tuning** (`/admin/recommendations/discovery`). The page is **gated on TMDb** — without a configured TMDb key it can't do anything.

## How Much to Fetch

| Setting | Default | Bounds | Notes |
|---------|---------|--------|-------|
| **Candidates per source** | 200 | 20–200 | TMDb returns 20/page and Discover walks at most 10 pages — 200 is the ceiling |
| **Candidates kept per person** | 1,000 | 50–5,000 | The per-user pool after merging |
| **Titles enriched with cast and crew** | 150 | 10–500 | The detail slice (cast, backdrop) fetched for the top of the pool |
| **Titles shown per page** | 50 | 10–200 | What a user's Discover page loads |

## Quality Floors

| Setting | Default | Notes |
|---------|---------|-------|
| **Minimum votes** | 50 | 0–10,000 |
| **Minimum rating** | 5.0 | 0–10 |
| **Trakt trending window** | This week | Today / week / month / year / all time |

## Shared Candidate Pool

- **Pool ceiling** (default 3,000, up to 20,000) and **drop titles unseen for N days** (default 30, 1–365) — the shared pool is pruned per run before personalized fetching merges in

## Ranking Weights — and the Honesty Table

Three sliders (**Taste match** 0.5, **Popularity** 0.3, **Recency** 0.2) with live % shares. Beneath them, **"What the weights actually do"** shows the *measured* share per term from real runs — because the configured split is not what lands: a fixed **source-quality term (10%)** has no slider, so the defaults actually blend to ≈45.5 / 27.3 / 18.2 / 9.1. Cells drift-flagged at ≥5 points. This is reported, not corrected — a measured correction was simulated and rejected.

Changes apply on the next run; **Refresh** on the Discover page shows them sooner.

## What's Not Configurable

Sources are fixed (TMDb Recommended / Similar / Discover; Trakt Trending / Popular / Pick; MDBList) — the only source knob is the Trakt window. Values are clamped server-side; the UI receives the bounds rather than hardcoding them.

---

**Related:** [Discover (user doc)](../features/discovery.md) · [Genre strips](genre-strips.md) · [TMDb](tmdb.md)
