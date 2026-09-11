# Gap Analysis

Collections and franchises your library is **missing** — TMDb collection membership compared against what you actually have, with one-click requesting for the gaps.

## Where It Lives

Admin console → **Library** → **Gap analysis** (`/admin/library/gaps`).

## Prerequisites

Three status cards state them plainly:

1. **TMDb configured** — the analysis is a TMDb comparison
2. **Collections present** — at least some titles carry collection metadata (run [enrichment](tmdb.md) first)
3. **Seerr** (optional) — only needed for requesting; the analysis itself never requests anything

## Running It

**Run analysis** starts the `refresh-library-gaps` job (manual-only; 409 if already running) with a live progress panel (step, items processed, "missing so far"). Each run **replaces the previous run's results** — the page always shows the latest snapshot. The run: collects your library's distinct collection ids, fetches TMDb collection data in cached chunks, keeps **released** parts, and records every part with `in_library` and Seerr status attached. Page loads are pure database — no TMDb/Seerr calls until you expand a collection.

## Reading the Results

- **Toolbar**: search, sort by (Most missing / Most complete / Name), **min-missing** filter, select-all
- **Per collection**: poster, **Owned N** and **In Seerr N** chips, coverage bar; expand for a **chronological poster grid** where each part is *In library* (dimmed), has a Seerr status badge, or is missing with a checkbox
- Click any poster for the full TMDb detail modal

## Requesting the Gaps

Request per item, per collection, selected, or "Request all missing" — through the standard Seerr options dialog (root folder, quality profile, server, 4K, language), with a confirmation step above 5 items. Guards: duplicates with pending/submitted/approved requests are skipped, max 200 items per batch, Seerr-unlinked accounts are refused when user mapping is required. Gap-initiated requests carry the **Gap Analysis** source and appear on users' [My Requests](../features/my-requests.md).

Re-run after large library syncs so counts stay honest.

---

**Related:** [TMDb](tmdb.md) · [Seerr](seerr.md) · [Libraries](libraries.md)
