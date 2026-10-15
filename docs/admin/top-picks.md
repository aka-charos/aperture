# Top Picks Configuration

Configure the server-wide popularity rankings — what [Top Picks](../features/top-picks.md) ranks and where it gets its data. The same list feeds the Top Picks page and the Top Picks rows on Emby home screens ([Emby home rows](home-rows.md)); writing it back to the media server as libraries, collections or playlists is legacy output.

## Where It Lives

Admin console → **Recommendations** → **Top Picks** (`/admin/recommendations/top-picks`), organized as cards: header, local algorithm, per-media settings, output, auto-request.

## Enable & Rank

- The **Enabled** switch on the header card turns Top Picks on for the whole server; **Reset to Defaults** restores the seeds
- **Local Popularity Algorithm**: how the local watch-history ranking weighs **unique viewers**, **play count** and **completion rate**
- Per media type: the **data source** (below), a **time window** in days (default 30) and **minimum viewers** for the local source, a **sort** for an MDBList list, a **language filter** (with "include unknown"), and the **list size** (a fixed count, or every title that matches)

The list is computed when it is asked for, so changes reach the Top Picks page and the next home-row sync without a refresh. **Refresh Now** runs `refresh-top-picks`, which only writes the legacy libraries, collections and playlists; it is greyed while legacy library output is off.

## Data Sources

Per media type, choose what ranks:

| Source | Meaning |
|--------|---------|
| **Local watch history** | Your server's actual viewing |
| **TMDB Popular / Trending (Today) / Trending (Week) / Top Rated** | External charts |
| **MDBList** | A curated list (picked with the [MDBList selector](mdblist.md)) |
| **Hybrid** | Local blended with any external source — one **local↔external slider** (default 50/50) |

## Output (Legacy)

Per media type, the list can also be written to the media server as a **Library**, a **Collection (Box Set)** and/or a **Playlist**, each with its own name (defaults "Top Picks - Movies" / "Top Picks - Series") and, for a library, symlinks or STRM files and a cover image. Poster overlays carry the rank badges into the library.

This is **legacy output**: while it is switched off on [Output format](output-format.md) (new installs start with it off) this card is greyed, nothing is written, and its settings are kept. To put Top Picks in front of people instead, use the Top Picks rows of [Emby home rows](home-rows.md).

## Auto-Request

Optionally have Aperture **request missing popular titles via Seerr** (movies and series separately, with a **max requests per run** cap). Requires an **external** source — a local-only ranking has nothing to request — and [Seerr](seerr.md) configured. Runs weekly (Sunday 00:00) via `auto-request-top-picks`; change that schedule on the [Jobs](job-scheduling.md) page like any other job.

---

**Related:** [Emby home rows](home-rows.md) · [MDBList](mdblist.md) · [Seerr](seerr.md) · [Global jobs](global-jobs.md)
