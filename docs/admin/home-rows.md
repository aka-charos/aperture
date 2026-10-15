# Emby Home Rows

Puts rows on each viewer's Emby home screen: Top Picks, their own recommendations, what their connections recommended to them, and playlists they chose to show. Each row is backed by a tag on the titles already in your library, so nothing is copied, no files are written, and watching from a row plays and marks the real item. This is what replaces the [legacy library output](output-format.md).

## Where It Lives

Admin console → **Recommendations** → **Emby Home Rows** (`/admin/recommendations/home-sections`). When the server qualifies, a chip reads **Emby 4.10.x — supported**.

## Requirements

- **Emby 4.10.0.40 or newer.** The version is checked live each time the page opens and at every sync. On Jellyfin, an older Emby, or a server that does not answer, the page says which, and the master switch cannot be turned **on**. It can always be turned **off**, because that is how the rows are removed.
- Top Picks rows read the Top Picks list, so [Top Picks](top-picks.md) itself must be switched on.

## The Rows

| Row | Who gets it | Default |
|-----|-------------|---------|
| **Top Picks** (one movies row, one series row) | Every account the media server has not disabled. With **Also show Top Picks to accounts without access** off, only accounts that can sign in to Aperture; the others lose the rows at the next sync. | On |
| **Each viewer's own recommendations** (movies, series) | Accounts with access whose recommendations are switched on, for each media type they have a library of. The picks come from their newest recommendation run. | On |
| **Recommended by friends** | Accounts with access and at least one connection. Holds what connections sent them on Watch This, until they finish it or dismiss it. | Off |
| **Playlists viewers choose to show** | The owner only. A viewer ticks **Also show it on my Emby home screen** on a playlist or collection they generated, or on one made from assistant suggestions; each becomes its own row. Playlists built on the Explore graph are not offered this. A row follows the playlist's current contents, not its order. | On |

An account disabled on the media server, or deleted from it, gets no row at all. A row whose list is empty right now (no recommendations yet, nothing from connections) is simply not shown until there is something in it.

**Viewers decide too.** Each viewer can switch any of these rows off for themselves and choose where theirs go, on the **Emby home screen** tab of their own settings (shown to Emby accounts only). That page says why a row cannot reach them when it cannot: switched off for everyone here, no access, recommendations off, or no library of that kind. A viewer's own "off" is kept while you have the row switched off too, so it stays off for them when you turn it back on. To see what one person sees, view the app as them from the [Users page](user-management.md).

## Configuration

| Field | Default | Notes |
|-------|---------|-------|
| **Manage home screen rows** | Off | Master switch. Everything below it is greyed while it is off. Switching it off removes every managed row and tag at the next sync. |
| **Row switches** | See above | One per row kind. **Also show Top Picks to accounts without access** sits under the Top Picks switch. |
| **Row names** | Top Picks: Movies · Top Picks: Series · Recommended Movies · Recommended Series · Recommended by Friends | What the row is called on the home screen. A playlist row takes the playlist's own name. |
| **Placement** | Top, for every row | Per row kind. See below. |
| **Recommendations per media type** | 20 (1–100) | How many picks go in each viewer's recommendation rows |
| **Order within each row** | Random | Random, Title (A–Z), Recently added, Newest release year, Newest release date, Highest rated. Emby cannot show a row in recommendation rank, so each row is sorted by a field on the server. |

### Placement

Each row kind goes at **Top**, **Bottom**, a **Position number** (how many rows sit above it, 0 being the top, up to 50), or **After a row** / **Before a row**. A position counts the viewer's own rows, never Aperture's. Rows sharing a spot stack in the order of the list on the page.

**After a row** and **Before a row** list the rows read live from every account, with how many accounts have each one. Built-in rows such as My Media and Continue Watching carry the same id on every account, so one choice works everywhere. Every library's "Latest" row is a single **Latest Media** group in Emby: it is offered as one row, and nothing can be placed between two of its libraries. Once you choose a row, the page says how many accounts lack it and names them, and asks what those accounts get **Instead** (Bottom by default, or Top, or a position). Accounts that did not answer are listed too. **Re-read rows** reads them again.

The placement here is the default. A viewer who chose their own keeps theirs.

## Applying Changes

- **Save** starts the `sync-home-sections` job straight away, so a change reaches home screens now; **Follow it in Jobs** opens its log. If a sync was already running, the page says so: run **Sync now** when it finishes.
- **Sync now** runs the same job without saving. It is unavailable while there are unsaved changes, while the master switch is off, or on an unsupported server.
- The job also runs daily at 05:45, after `refresh-top-picks` at 05:00, so the Top Picks rows show that morning's list. Change it on the [Jobs](job-scheduling.md) page like any other job. With the master switch off, a scheduled or manual run only removes what was written.
- A viewer's own changes, and a viewer ticking a playlist, apply at once without waiting for a sync.
- A row is only moved when it is created or when the placement that applies to that viewer changes. A row a viewer dragged somewhere else in Emby stays where they put it.

## How It Works

Each row is an Emby home screen section that shows the titles carrying one tag beginning with `aperture:`. The tags are added to the original library items, are visible in Emby, and are ignored when Aperture syncs your library, so they never change what is recommended. A section is recognised by the tag it shows: a home screen row that shows no Aperture tag is never touched, and a viewer's own edits to an Aperture row (its display mode, an extra filter) survive later syncs.

If a list cannot be read during a sync (the Top Picks source fails, or a viewer's picks cannot be loaded), that row and its tag are left exactly as they were. A row is only removed when its list is genuinely empty or no longer wanted.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| The master switch is greyed | The warning above it says why: not Emby, Emby older than 4.10.0.40, or the server did not answer |
| One viewer has no recommendation row | Their settings tab says why. Usually: no Aperture access, recommendations switched off for them on the [Users page](user-permissions.md), no library of that type they can open, or no recommendation run yet |
| No Top Picks rows anywhere | [Top Picks](top-picks.md) is switched off, or its list is empty |
| Top Picks rows vanished for some accounts | **Also show Top Picks to accounts without access** is off, and those accounts have no Aperture access |
| "Choose a row for every placement…" and Save is disabled | A row kind is set to After or Before a row with no row chosen |
| A row is in a different place than set | The viewer chose their own placement, or dragged the row in Emby after it was created |
| Sync fails or does nothing | Open the `sync-home-sections` run in [Jobs](jobs-overview.md); its log says what each row held and what it skipped, and why |

---

**Related:** [Top Picks](top-picks.md) · [Output format (legacy libraries)](output-format.md) · [User permissions](user-permissions.md) · [Global jobs](global-jobs.md)
