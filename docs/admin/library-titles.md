# Library Title Templates

Configure the default names of the two AI Picks libraries Aperture creates per user — the names your household sees on the Emby/Jellyfin home screen. These libraries are **legacy output**, being replaced by [Emby home rows](home-rows.md); while legacy output is switched off on [Output format](output-format.md), this page is greyed and its settings are kept.

## Accessing Settings

Admin console → **Recommendations** → **Library naming** (`/admin/recommendations/naming`). (Top Picks libraries are named in the [Top Picks](top-picks.md) page's own config; there is deliberately **no** Shows You Watch library.)

## The Two Templates

| Template | Default | Names |
|----------|---------|-------|
| Movies | `{{username}}'s AI Picks - Movies` | The per-user movie recommendations library |
| TV Series | `{{username}}'s AI Picks - TV Series` | The per-user series recommendations library |

### Merge Tags

Four tags, inserted with click-to-insert chips: `{{username}}`, `{{type}}`, `{{count}}`, `{{date}}` — with a **live preview** of the result. Rules enforced server-side: names that would break filesystem rules (slashes, colons, …) are rejected with a message, so a bad template can't reach your server.

### Cover Images

The page also manages the **library cover art** for the two AI libraries — bundled defaults ship with the app; upload your own (**1920×1080 recommended**) or restore the default. This is the tile users see on a TV screen, so a good image matters more than the name.

## Users Can Override

A user may rename *their own* libraries in User Settings → Preferences → AI Library Names (greyed there too while legacy output is off); their choice wins over these defaults. See [Virtual libraries](../features/virtual-libraries.md).

## Applying Changes

Names apply when the **`sync-movie-libraries` / `sync-series-libraries`** jobs next run (every 3 hours, staggered). Renaming creates the library under its new name and deletes the old-named one, as long as that library provably reads only that viewer's own folder; anything else is left alone.

A name already used by a library that is not the viewer's own (your "Movies" library, or another viewer's) is refused: that viewer's library is skipped, and the job log says to choose another name. Nothing is taken over or granted.

## Troubleshooting

- **New name didn't appear** — the library jobs haven't run since the change; check their history
- **Two AI Picks libraries on the server** — a rename from before old libraries were removed automatically left one behind; remove the stale one in Emby/Jellyfin (when phasing legacy output out altogether, **Remove generated libraries** on [Output format](output-format.md) finds such leftovers too)
- **"The library name … already belongs to a library…" in the job log** — the template or the viewer's own name matches an existing library; pick another
- **Users say "my library reverted"** — they're looking at the default name because their per-user override was cleared

---

**Related:** [Output format](output-format.md) · [Movie jobs](movie-jobs.md) · [Top Picks](top-picks.md)
