# Browse Movies & Series

The Browse page is your library explorer: every title you have, with deep filtering, sorting, presets, and a People tab.

![Browse Movies Grid View](../images/features/browse-movies-grid.png)

## Page Layout

### Tabs

- **Movies** — your movie library
- **Series** — your TV series library
- **People** — every actor, director, and creator in your library, searchable, with Name / Credits sorting and its own grid/list mode (People defaults to **list**)

Each tab keeps its own filters, sort preference, and view mode (see [Grid & List Views](grid-list-views.md)).

### The Filter Bar

A sticky bar above the grid holds, left to right: a **search box**, **Genre**, **Franchise** (movies) or **Network** (series), **Country**, **Filters**, **Sort**, and **Presets**. Active selections appear as removable chips under the bar.

The **search box** filters the current tab by title as you type.

---

## The Filters Popper

The **Filters** button (it shows a count when anything is active) opens the full panel, grouped into sections. Most filters are **dual-handle range sliders** — set both a floor and a ceiling:

| Section | Filters |
|---------|---------|
| **Scores** | Community rating, Rotten Tomatoes critic score, Metacritic |
| **Year** | Release-year range |
| **Library & Audience** | **Watch status** (Any / Watched / Unwatched — unwatched means never played or under 5% progress), **min/max watchers** (how many distinct users on your server have watched it) |
| **Runtime** | Length range (movies) |
| **Video quality** | Resolution / formats present in your files |
| **Seasons** | Season-count range (series) |
| **Status** | **Airing / Ended** (series) |
| **Content rating** | Age ratings |

The popper header has a **reset icon** that clears everything at once; chips let you remove individual filters.

### Country

The **Country** button opens its own popper for **production country**:

- A **Match All / Any** switch — "France AND Japan" versus "France OR Japan"
- It matches stored country names; nationalities work too ("French", "German"…)

Production country is almost completely populated (unlike language metadata), so it's the reliable way to browse national cinema.

### Franchise / Network

Movies can be narrowed to one **collection** (franchise); series to one **network**. For the collection overview across your whole library, see the [Franchise Tracker](franchises.md).

---

## Sorting

The **Sort** menu covers:

| Movies | Series |
|--------|--------|
| Title | Title |
| Year | Year |
| Release Date | Release Date |
| Rating | Rating |
| RT Score | RT Score |
| Metacritic | Metacritic |
| Runtime | Seasons |
| **Recently Added** | **Recently Added** |

Each tab remembers its own sort, synced to your account.

---

## Filter Presets

Any combination of filters can be saved as a **preset** from the Presets menu:

- **Save Current Filters** — name the combination and it joins the menu
- **Manage Presets** — rename and delete
- Applying a preset replaces the active filters; the chips show exactly what it contains
- Presets are per-account and work on both tabs

---

## Reading the Results

**Grid view** — posters with overlays: watched tick, your star rating on hover, episode-progress badge for series, community rating badge.

**List view** — poster beside the details:

- Title, year, **community rating**
- **Genre chips** (up to four)
- A two-line **overview** (with "View on TMDb" alongside)
- Your rating, inline; series add their **status** (Airing/Ended) and **season count**, plus an **Add to Watching** toggle

Results load infinitely as you scroll, with an end message at the bottom of the match set.

---

## Tips

- **Watch status is a filter** — "Unwatched + RT 80%+" is the fastest shortlist in the app
- **Save your default browse** (e.g. unwatched, sorted by Recently Added) as a preset and apply it in one click
- **Country, not language** — use production country for national-cinema browsing
- **Min/max watchers** finds hidden gems (low) or household hits (high)

---

**Next:** [Movie Details](movie-detail.md)
