# Gap Analysis

What your library is **missing**, with one-click requesting for the gaps: films from TMDb collections on the **Movies** tab, and aired seasons of the shows you hold on the **TV shows** tab.

## Where It Lives

Admin console → **Library** → **Gap analysis** (`/admin/library/gaps`). The TV tab has its own address, `?type=tv`.

## Movies

### Prerequisites

The page states them at the top, each with a button to fix it:

1. **TMDb configured**: the analysis is a TMDb comparison
2. **Collection data present**: movies must carry TMDb collection data, which [enrichment](tmdb.md) (`enrich-metadata`) adds
3. **Seerr** (optional): only needed for requesting; without it missing films are listed but cannot be requested

When all three are in place a single line says so, with how many library movies carry collection data.

### Running It

**Run analysis** starts the `refresh-library-gaps` job (manual-only; refused if already running). While it runs, a progress bar counts collections and the last results stay on the page; a first scan, with nothing to keep showing, fills in as each batch finishes. A new scan replaces the old results only when it finishes, so a failed or cancelled scan leaves the last good list up. A failed scan also leaves a note saying what went wrong, including TMDb not answering and a scan cut off by a restart of the app.

If TMDb doesn't answer for a collection, the scan uses the part list it stored last time, which may miss the newest sequel. A collection with no stored list is left out and not counted as scanned, and the job log says how many. If more than a tenth of the library is left out (or more than three collections in a small one), the scan fails rather than replace a fuller list. The run collects your library's distinct collection ids, fetches TMDb collection data in cached chunks, keeps **released** parts, and records every part with whether it is in the library and its Seerr status. Page loads read the database only.

The **Analysis snapshot** card shows when the scan ran, **Collections with gaps** (of how many scanned), **Missing films** (released, not in the library or in Seerr), and **Released films in library**. When movies have been added to the library since the scan, it says how many and suggests running it again.

### Reading the Results

- **Toolbar**: search by title or collection, sort (Closest to complete / Most missing / Name A–Z), a **Missing** filter (any number / just one / 2–4 / 5 or more), and a checkbox selecting every missing film shown
- **Per collection**: poster, **owned of total**, **in Seerr** count and the missing titles; expand for every released film in the collection, oldest first, each marked **In Library**, with its Seerr status, or missing with a checkbox
- **Franchise page** opens the collection's own page (`/franchises/:id`), where any viewer can see what is owned, missing and upcoming
- Collections load 50 at a time; **Show more** loads the next

### Requesting the Gaps

Request per item, per collection ("request all missing"), or the current selection, through the standard Seerr options dialog (root folder, quality profile, server, 4K, language), with a confirmation step above 5 items. A large selection is sent in batches of 200. Titles that already have a pending, submitted or approved request are skipped. Gap-initiated requests carry the **Gap Analysis** source and appear on users' [My Requests](../features/my-requests.md).

Re-run after large library syncs so counts stay honest.

## TV Shows

**Run analysis** on this tab starts the `refresh-series-gaps` job (manual-only until given a schedule; refused if already running). It asks TMDb about every show in your library that has a TMDb id, compares each season that has aired with the episodes the library holds, and asks Seerr about the shows with a gap. The bar counts shows and the last results stay on the page; a first scan, with nothing to keep showing, fills in as each batch finishes. A new scan replaces the old results only when it finishes, so a failed or cancelled scan leaves the last good list up, with a note saying what went wrong. The scan fails if TMDb doesn't answer for more than a tenth of your shows (at least three), because those shows would drop off the list. Page loads read the database only.

Only **TMDb** is required. **Seerr** is needed only for requesting. Seasons that have not aired, and specials (season 0), are never counted.

### What Counts as a Gap

Choose with the **Seasons** filter:

- **Missing entirely** (the default): an aired season with no episode in the library, and not in Seerr
- **Partly held**: an aired season with some of its episodes. For a season still airing, only the episodes aired so far count. A file holding two episodes (`S05E01-E02`) counts as both, once a TV sync has run since the update. A show a streaming service splits into "parts" that TMDb groups into seasons differently can still show here although it is complete
- **Missing or partly held**: both of the above
- **Numbering differs**: shows whose gaps can't be trusted, listed so you can check them. The library holds a season TMDb doesn't list, or one with more episodes than TMDb gives it, so "season 3 is missing" may only mean your season 2 holds it. These shows offer nothing to request and aren't counted in the figures

A show in two libraries is one show, and an episode held in both counts once.

The caption under the snapshot says how many shows could not be compared: TMDb didn't answer, the show isn't on TMDb, or it has no TMDb id.

### Filtering by Network

The **Network** filter takes one or more networks, each with how many shows match the other filters. A show with several networks is found under any of them. Networks come from TMDb; the media server's value is used only when TMDb lists none, because that value is its first studio, which is often a production company. Shows with neither are under **No network listed**.

Search, sort and the count filter work as on the Movies tab.

### Requesting Seasons

Request a single season, a show's seasons, or the current selection, through the same Seerr options dialog. Each show becomes one request naming its seasons, and **My Requests** shows which. A row's **Request** button and checkbox cover the seasons of the filter in force.

A season already requested is skipped, so a show can be requested again for other seasons. Seerr refuses a season it already has any status for, so a partly held season Seerr knows about is listed with no **Request** button; Sonarr fetching its missing episodes is the way to finish it.

---

**Related:** [TMDb](tmdb.md) · [Seerr](seerr.md) · [Libraries](libraries.md)
