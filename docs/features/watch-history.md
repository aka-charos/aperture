# Watch History

The Watch History page is your complete viewing log — everything your media server says you've played, with search, filters, and the tools to correct it.

![Watch History Page](../images/features/watch-history.png)

## Accessing Watch History

Navigate to **Watch History** in the sidebar (clock icon). The page has two tabs, **Movies** and **Series**, each with its own view mode ([grid or list](grid-list-views.md)).

Your history comes from your media server, synced automatically — movies roughly every 2 hours, series hourly, and always right before a recommendation run. Roughly-dated watches (from the rating prompt) appear here too, marked as approximate.

---

## Finding Things

- **Search** — the box searches your **entire history** on the server (title and genre), not just the loaded page
- **Status filter** — All / **In Progress** (started, not finished) / **Completed**
- **Pagination** — 50 per page; the counter tells you where you are

## Sorting

| Sort | Order |
|------|-------|
| **Recent** | Most recently played first (default) |
| **Plays** | Most-played first |
| **A-Z** | Alphabetical |

---

## What Each Entry Shows

### Movies

- Poster with a **watched tick** and, where applicable, a **plays chip** — "3 plays", capped at 5, then "Rewatched"
- **Favorite badge** — the heart, if you've favorited it on the media server
- **Resume bar** — if you stopped partway, the poster shows how far, with a "% watched" tooltip on hover
- Title, year, and the last-watched date

### Series

- Poster with watched tick and progress, plus the watched/total episode count and completion percentage
- A **Complete** chip when you've watched everything on the server
- The last-watched date
- A **hover toggle** to add the series to (or remove it from) [Shows You Watch](shows-you-watch.md) — the same list the sidebar page manages

Both tabs rate inline (hover the stars), same as everywhere else.

---

## Correcting Your History

Where you have permission (admins, or users granted **manage watch history**), hovering an entry reveals a **Mark Unwatched** button:

- **Movies** — removes the play from your media server and from Aperture's history
- **Series** — "Mark all episodes as unwatched" clears the whole series

Both ask for confirmation — **"Mark as Unwatched? This action cannot be undone"** — and update what the recommender sees immediately.

Episode- and season-level correction is API-only today; the page manages whole movies and whole series.

---

## Tips

- **Fix mistakes promptly** — everything here feeds your taste profile; a misattributed play skews recommendations until removed
- **Use In Progress** — the fastest list of things you started and abandoned
- **Favorite things here too** — favorites are a taste signal; the badge shows you what's already counted

---

**Next:** [Watch Stats](watch-stats.md)
