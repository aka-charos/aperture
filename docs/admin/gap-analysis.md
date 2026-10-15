# Gap Analysis

Collections and franchises your library is **missing** — TMDb collection membership compared against what you actually have, with one-click requesting for the gaps.

## Where It Lives

Admin console → **Library** → **Gap analysis** (`/admin/library/gaps`).

## Prerequisites

The page states them at the top, each with a button to fix it:

1. **TMDb configured**: the analysis is a TMDb comparison
2. **Collection data present**: movies must carry TMDb collection data, which [enrichment](tmdb.md) (`enrich-metadata`) adds
3. **Seerr** (optional): only needed for requesting; without it missing films are listed but cannot be requested

When all three are in place a single line says so, with how many library movies carry collection data.

## Running It

**Run analysis** starts the `refresh-library-gaps` job (manual-only; refused if already running). While it runs, a progress bar counts collections and the results fill in as each batch finishes. Each run **replaces the previous run's results**, so the page always shows the latest snapshot. The run collects your library's distinct collection ids, fetches TMDb collection data in cached chunks, keeps **released** parts, and records every part with whether it is in the library and its Seerr status. Page loads read the database only.

The **Analysis snapshot** card shows when the scan ran, **Collections with gaps** (of how many scanned), **Missing films** (released, not in the library or in Seerr), and **Released films in library**. When movies have been added to the library since the scan, it says how many and suggests running it again.

## Reading the Results

- **Toolbar**: search by title or collection, sort (Closest to complete / Most missing / Name A–Z), a **Missing** filter (any number / just one / 2–4 / 5 or more), and a checkbox selecting every missing film shown
- **Per collection**: poster, **owned of total**, **in Seerr** count and the missing titles; expand for every released film in the collection, oldest first, each marked **In Library**, with its Seerr status, or missing with a checkbox
- **Franchise page** opens the collection's own page (`/franchises/:id`), where any viewer can see what is owned, missing and upcoming
- Collections load 50 at a time; **Show more** loads the next

## Requesting the Gaps

Request per item, per collection ("request all missing"), or the current selection, through the standard Seerr options dialog (root folder, quality profile, server, 4K, language), with a confirmation step above 5 items. A large selection is sent in batches of 200. Titles that already have a pending, submitted or approved request are skipped. Gap-initiated requests carry the **Gap Analysis** source and appear on users' [My Requests](../features/my-requests.md).

Re-run after large library syncs so counts stay honest.

---

**Related:** [TMDb](tmdb.md) · [Seerr](seerr.md) · [Libraries](libraries.md)
