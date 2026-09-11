# Top Picks Configuration

Configure the server-wide popularity rankings — what [Top Picks](../features/top-picks.md) ranks, where it gets its data, and what it writes back to the media server.

![Admin Settings - Top Picks](../images/admin/admin-settings-top-picks.png)

## Where It Lives

Admin console → **Recommendations** → **Top Picks** (`/admin/recommendations/top-picks`), organized as cards: header, local algorithm, per-media settings, output, auto-request.

## Enable & Rank

- **Enabled** switch per the header card; **Refresh now** forces a re-rank; **Reset defaults** restores seeds
- **Local algorithm** (for the watch-history source): **time window** in days (default 30), **minimum viewers**, **list size**, **sort by** (8 options), and a **language filter** (with include-unknown)

## Data Sources

Per media type, choose what ranks:

| Source | Meaning |
|--------|---------|
| **Local watch history** | Your server's actual viewing |
| **TMDB Popular / Trending (Today) / Trending (Week) / Top Rated** | External charts |
| **MDBList** | A curated list (picked with the [MDBList selector](mdblist.md)) |
| **Hybrid** | Local blended with any external source — one **local↔external slider** (default 50/50) |

## Output

Per media type, choose the write-back form: **Library**, **Collection (Box Set)**, or **Playlist** — each with its own symlink/STRM switch, and the library/collection/playlist **names** (defaults "Top Picks - Movies" / "Top Picks - Series"). Poster overlays carry the rank badges into the output.

## Auto-Request

Optionally have Aperture **request missing popular titles via Seerr** (movies and series separately, with a **max requests per run** cap). Requires an **external** source — a local-only ranking has nothing to request — and [Seerr](seerr.md) configured. Runs weekly (Sunday 00:00) via `auto-request-top-picks`; change that schedule on the [Jobs](job-scheduling.md) page like any other job.

---

**Related:** [MDBList](mdblist.md) · [Seerr](seerr.md) · [Global jobs](global-jobs.md)
