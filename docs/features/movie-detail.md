# Movie Details

The Movie Detail page shows everything about a specific movie — its ratings, its people, how it fits your taste, and what you can do with it. Series share the same page layout; the series-specific parts are described in [Series Details](series-detail.md).

![Movie Detail Page](../images/features/movie-detail.png)

## Page Sections

### Hero

The top of the page: full-width fanart backdrop, poster, title, year, and the key facts in one line.

- **Ratings** — the community rating from your media server ("7.6 / 10"), followed by external score badges where available: Rotten Tomatoes (Tomatometer and Audience), Metacritic, IMDb, TMDB, and Letterboxd. For movies with a critic consensus, the quote appears under the badges, and an awards line where one exists.
- **Genre chips** — clickable, and annotated by the recommender where it has something to say: "a genre you already watch a lot of" versus "new to you".
- **Synopsis** — with a **Read full synopsis** expander for the longer plot text.

### Actions

The hero's action row:

| Action | What it does |
|--------|--------------|
| **Open in Jellyfin / Open in Emby** | Opens the movie in your media server's app or web client |
| **Favorite / Favorited** | Sets or clears the favorite flag **on your media server**. Favorites matter: they feed your taste profile and what the recommender excludes |
| **Mark Watched / Mark Unwatched** | Marks the movie watched (or clears it) in your media server and Aperture's history. Unwatching asks for confirmation — it cannot be undone. Availability depends on a per-user permission |
| **Trailer** | Opens the YouTube trailer in a modal |
| **Report a problem** | Report video, audio, subtitle, or other playback issues — see below |

### Rating

The star rating control (1–10) sits on the poster and in the hero. Rating affects your recommendations and syncs to Trakt if connected.

If your server has no record of you playing the movie, rating it also asks **"When did you watch *title*?"** with time bands — *This month*, *Last month*, *Earlier this year*, *Last year*, *Longer ago than that* — plus **Not now** and **I haven't seen it**. Choosing a band records the watch (dated to the band) on your media server, so your history reflects reality without a real play event. See [The Rating System](ratings.md).

---

## Community Activity

Directly under the actions, a **Community Activity** strip shows how the household has engaged with this title:

- **Watched / Plays / Favorited** counts, and for series, **Completed** and episode plays
- **Average Viewer Progress** — how far into it viewers typically get
- **User Reach** — what percentage of the server's users have touched it

Where your admin allows it, these counts expand into a list of **who** watched and favorited it; otherwise they stay anonymous.

---

## Recommended For You

If the recommender scored this title for you, the page shows a personal insights panel — headed **Recommended For You** (it made your list) or **How This Fits Your Taste** (it was scored but not picked):

- **How We Calculated Your Match** — the three factors with their weight shares: **Taste Match** (similarity to your history), **Discovery** (how different it is from what you usually watch), and **Quality** (community and critic ratings), blended, then adjusted by your franchise and genre preferences.
- **Evidence** — "Based on your history with similar movies:" the specific titles from your history that pulled it in, linked.
- **Variety In Your List** — how much this pick differs from the others chosen with it; this shapes the *order* of your list, not the match.
- **Taste twin** — sometimes the reason is a person here whose taste closely overlaps yours; the panel says so and shows the rare titles you've both watched, but never names them.
- **AI explanation** — "Why *Aperture* picked this for you", a natural-language paragraph, if your admin enabled it.

---

## Film Analysis

Many titles also carry a **Film Analysis** — a grounded critical essay about the work itself, written from published sources rather than from your data. See [Title Analysis](title-analysis.md).

---

## Related Movies

The right column lists similar titles from your library as **Related Movies**, with two tabs:

- **List** — poster cards with watch-state badges, your ratings, and chips naming the connection (shared cast, genre, theme...)
- **Graph** — the same relationships drawn as an explorable graph; open it fullscreen to go deeper

See [Related-Content Graphs](similarity-graphs.md).

---

## The Info Card

The lower-left card collects the rest, most of it clickable:

| Field | Notes |
|-------|-------|
| **Cast / Director / Writers** | Names link to their [person pages](person-pages.md) |
| **Created By** | For series |
| **Studios** | Links to the [studio page](studio-pages.md) |
| **Available On** | Streaming providers, where known |
| **Keywords, Languages, Countries** | Production metadata |
| **Cinematography / Music / Editing** | Key crew |
| **Awards** | Notable wins and nominations |
| **External Links** | IMDb, TMDb, TVDb |
| **Part of Collection** | The franchise this belongs to (see the [Franchise Tracker](franchises.md)) |

---

## Report a Problem

If something's wrong with the file — video, audio, subtitles, or something else — use **Report a problem**:

1. Pick what's wrong (Video / Audio / Subtitles / Something else)
2. For series, optionally scope it to a season and episode
3. Describe what happens and send

The report goes to your server's Seerr, where your admin triages it; your reports are listed under [My Requests](my-requests.md) → **Issues**. The button only appears when Seerr has a record of the title.

---

## Navigation

- Click any person's name for their filmography
- Click the studio for its catalog
- Every poster on the page navigates the same way

---

**Next:** [Series Details](series-detail.md)
