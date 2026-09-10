# Series Details

The Series Detail page shows everything about a TV series — its episodes and your progress through them, what's missing from your server, and how it fits your taste. It shares its layout with [Movie Details](movie-detail.md).

![Series Detail Page](../images/features/series-detail.png)

## Page Sections

### Hero

Full-width fanart backdrop, poster, title, year, and the key facts in one line.

- **Status chip** — **Continuing** (green) while new episodes are still coming; otherwise **Ended**
- **Ratings** — community rating ("8.4 / 10"), critic score where available, and the external badges (Rotten Tomatoes, Metacritic, IMDb, TMDB, Letterboxd) with the critic consensus quote
- **Created By** — the show's creator, linked to their person page
- **Seasons / Episodes / avg per episode** chips
- **Genre chips** — annotated by the recommender ("a genre you already watch a lot of" vs "new to you")

### Actions

| Action | What it does |
|--------|--------------|
| **Open in Jellyfin / Open in Emby** | Opens the series in your media server |
| **Favorite / Favorited** | Sets the favorite flag on your media server — for a series, this is also how it lands on [Shows You Watch](shows-you-watch.md) |
| **Add to Watching / Watching** | Toggles the series on your Shows You Watch list directly |
| **Trailer** | Opens the YouTube trailer in a modal |
| **Report a problem** | Report video/audio/subtitle issues, scoped to a season or episode if you like |

The 1–10 star rating sits on the poster and in the hero. Unlike movies, rating a series never asks when you watched it.

---

## Episodes

The **Episodes** section is where series live:

### Season pills

Each season is a pill with a **segmented progress bar** and a legend:

| Segment | Meaning |
|---------|---------|
| Watched | Episodes you've played |
| In progress | Started but unfinished |
| Not watched | Available to you |
| Missing | Aired but not on your server |

Pills read "12 / 24 watched", "N in progress", "Complete", or "N missing".

### Episode list

Expand a season to see its episodes: thumbnail with a resume bar, episode number and title, community rating chip, air date, and always-visible overview. **"Next up"** marks the episode you're on, with **Resume S2·E5**, **Play next**, or **Continue · 62%** actions.

### Missing seasons

A **"Not on your server"** card appears when aired episodes aren't available to you — with a **Request via Seerr** button that files the request through [Discover](discovery.md)'s pipeline. See [My Requests](my-requests.md) to track it.

---

## Community Activity

A strip under the actions shows how the household engages with the series — watched/favorited counts, **Completed**, **episode plays**, and **Average Viewer Progress** across all episodes. Where your admin allows it, the counts expand to named watchers.

---

## Recommended For You

If the recommender scored this series for you, the insights panel explains the pick — **Recommended For You** or **How This Fits Your Taste**, the **Taste Match / Discovery / Quality** breakdown with weight shares, evidence from your history, the **taste-twin** note (without naming anyone), and the AI explanation if enabled. See [Movie Details](movie-detail.md) for the full tour.

A **Series Analysis** may also be available — see [Title Analysis](title-analysis.md).

---

## Related Series

The right column shows similar series from your library as **Related Series**, with **List** and **Graph** tabs and connection-reason chips. See [Related-Content Graphs](similarity-graphs.md).

---

## Managing Watched State

The series detail page doesn't offer un-watch controls — episode, season, and whole-series **un-watch** actions live on your [Watch History](watch-history.md) page, alongside the mark-watched controls for movies.

---

**Next:** [Title Analysis](title-analysis.md)
