# Shows You Watch

Shows You Watch is your list of TV series you're following, with upcoming-episode countdowns and an honest picture of how much of each show your server actually has.

![Shows You Watch Page](../images/features/shows-you-watch.png)

## Accessing Shows You Watch

Navigate to **Shows You Watch** in the sidebar (queue icon). Your admin can switch the feature off for the whole server, in which case it's hidden.

---

## How the List Is Built

The list is the union of two things:

1. **Your watchlist** — series you've favorited in Emby/Jellyfin and series you've added here by hand. This list is **two-way synced with your media server favorites**: favorite a series there and it appears here; remove it here and it's unfavorited there.
2. **Your episode history** — any series with at least one played episode is tracked automatically.

Shows **stay on the list** once they end or you finish them — a series doesn't disappear just because there's nothing new. Ended shows carry an **Ended** chip, and fully-watched ones show a **Series Complete** panel.

---

## Page Layout

### View Modes

Toggle between display modes:

| Mode | Description |
|------|-------------|
| **Grid View** | Poster cards with progress and watch-state badges |
| **List View** | Detailed rows with availability bars and upcoming episodes |

### Filters

| Filter | Description |
|--------|-------------|
| **All / Airing / Ended / Upcoming** | Status tabs (defaults to **Upcoming**) |
| **Watchlist (N) / From History (N)** | Where each series came from |
| **N Currently Airing / N with Upcoming** | Quick stat chips |

Each row also carries a small source chip: **Watchlist**, **History**, or **Watchlist · History**. The list is ordered by the soonest upcoming episode, then by what you watched most recently.

---

## Episode Availability

Each series shows a segmented **availability bar** spanning every episode that has aired (totals come from TMDB):

| Segment | Meaning |
|---------|---------|
| **Watched** | Episodes you've played |
| **On server, unwatched** | Aired episodes your server has that you haven't seen |
| **Missing from server** | Aired episodes your server doesn't have yet |

Hover for the exact breakdown, including which **seasons aren't on your server at all** (e.g. "Seasons not on server: S3, S5"). Because totals come from TMDB, a show you're fully caught up on can still show missing segments — that's your server lacking episodes, not you falling behind.

To get the missing episodes, request them from the series' detail page (see [Series Details](series-detail.md)).

---

## Upcoming Episodes

For series with a scheduled next episode, a countdown chip tells you when:

- **"Airs today!"** — color-coded, it's imminent
- **"3 days to go"** — countdown with the weekday and date
- **"No episode data available" / "Check back soon"** — next episode not yet scheduled
- **"Series Complete"** — nothing more is coming

Posters carry your progress too: a watched tick, or an episode badge like **8/24** while you're partway through a season.

---

## Adding and Removing Series

- **Add Series** — search by name and add any series to the list. Adding it also favorites the series on your media server, so it stays in sync.
- **Remove** — the row's remove action asks for confirmation, and warns you what it implies: because the list is synced with your media server favorites, removing a series **also unfavorites it in Emby/Jellyfin**.

---

## Sync Favorites

The **Sync favorites** button reconciles your watchlist with your media server favorites in both directions. A summary afterwards tells you what changed: how many were favorited on the server, removed locally, added from the server, or failed to push. Episode counts and aired totals are refreshed from TMDB as needed, not on every visit.

---

## Rating Shows

Rate series directly from this page — hover a poster in grid view, or use the inline control in list view — on the usual 1–10 star scale (see [The Rating System](ratings.md)). Ratings feed your recommendations.

---

## Tips

### Stay Current

- The **Upcoming** tab (the default) puts what airs soonest at the top
- The availability bar shows at a glance whether you're behind — or whether the *server* is

### Manage a Big List

- Use the **Watchlist / From History** filter to separate shows you chose from shows you merely sampled
- Ended and completed shows stay listed; use the **Ended** tab to find and prune them

---

**Next:** [Playlists](playlists.md)
