# Genre Strips

The **"Popular by genre"** rows on the user-facing [Discover](../features/discovery.md) page — each strip is a TMDb Discover query you define.

## Where It Lives

Admin console → **Recommendations** → **Genre strips** (`/admin/recommendations/genre-strips`). **Gated on TMDb** — without a configured key the page explains what's missing.

## The Shape

Two independent sections — **Movies** and **TV** — each a list of up to **24 strips**. Per strip:

| Field | Rules |
|-------|-------|
| **Genres** | Multi-select (up to 8); several genres in one strip are **ANDed** — titles matching all of them |
| **Max titles** | 1–48 (default 24) |
| **Exclude genres** | Up to 8 — TMDb `without_genres` ("Science Fiction but not Animation") |
| **From year / To year** | No end / Today / a specific year (TV uses first-air date); start-after-end is rejected, as is a future start |
| **Heading** | Optional custom title (default: the genre names), max 80 chars |
| **Origin country** | ISO country code — national-cinema strips ("French sci-fi") |

Legacy single-genre-strip configs (movie/series genre-id lists) migrate automatically to row form.

## Saving Model

**Drag-to-reorder auto-saves.** Field edits within a strip save via the strip's save icon (which saves the whole Movies or TV list). The server validates rows and rejects invalid configurations with a detailed 400.

## How Rows Reach Users

The Discover page fetches TMDb Discover per row, then **reorders the rows per viewer** by taste — affinity comes from the viewer's own genre weights (clamped band; 1.0 = neutral), sorted stably so ties keep your configured order. Rows are never dropped and titles within a row are never reordered — personalization touches ordering only.

Results exclude titles already in the library, watched, or requested, like the rest of Discover.

---

**Related:** [Discovery tuning](discovery-tuning.md) · [TMDb](tmdb.md) · [Discover (user doc)](../features/discovery.md)
