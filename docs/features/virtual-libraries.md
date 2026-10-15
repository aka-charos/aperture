# Virtual Libraries

Aperture can write its output back into your Emby/Jellyfin server as **real libraries** — your recommendations and the server's top picks appear as browsable shelves, sorted by rank, playable like any other content.

> **This is a legacy feature, being phased out.** New installs start with it switched off, and an admin may have switched it off on yours. On Emby, the same recommendations and Top Picks now appear as **rows on your home screen** instead, with no extra library: see [Emby Home Screen](user-settings/home-screen.md). The rest of this page applies only where your admin still writes these libraries.

## What Exists

| Library | Contents | Who sees it |
|---------|----------|-------------|
| **AI Picks — Movies** (e.g. "*YourName*'s AI Picks - Movies") | Your latest [recommendations](recommendations.md), in rank order | Only you |
| **AI Picks — TV Series** | Your series picks, in rank order | Only you |
| **Top Picks — Movies / Series** | The server's [top picks](top-picks.md) | Everyone (or as a shared Box Set / playlist, per admin config) |

These aren't copies: the entries point at your original media files, so nothing is duplicated, quality is untouched, and playback behaves exactly like your normal libraries.

---

## Renaming Your AI Picks Libraries

Under [Preferences](user-settings/preferences.md) → **AI Library Names**, you can rename your two AI Picks libraries (the card is greyed while the libraries are switched off). Renaming replaces the old library with one under the new name. A name already used by another library on the server, such as a regular "Movies" library or someone else's, is refused, and your library is skipped until you choose another. The defaults are templates like "*YourName*'s AI Picks - Movies", and support merge tags — `{{username}}`, `{{type}}`, `{{count}}`, `{{date}}` — if you want the name to carry metadata.

Top Picks library names are configured server-wide by your admin.

---

## How They Work

Your admin chooses the linking technology and manages the build jobs; the user-visible details:

- **Symlinks (the usual choice)** — the library holds links to your original files; native playback, no conversion. If symlinks can't be created (Windows without privileges, mounted shares), Aperture **falls back to STRM files automatically**
- **STRM files** — tiny text files each containing the path/URL of the real media; the server follows the pointer at play time
- **Poster overlays** — the rank badge you see in Aperture (#1, #2, …) is burned into the library's poster art, so the ranking survives on your TV
- **NFO sidecars** — carry the title's metadata into your media server; where AI explanations are enabled, the NFO's description carries the "Why *Aperture* picked this for you" credit line
- **Artwork** — banner, clearlogo, and landscape art are linked alongside posters, so shelf views look right

Library access is provisioned automatically — when your AI Picks library is created, it's added to your account's library access without admin effort. It only ever holds titles from libraries you can open yourself; if your access changes, it changes with it, and a library you may no longer fully open is removed.

---

## What They Update With

- **AI Picks** refresh whenever a new recommendation run completes for you — regenerate, and the library follows
- **Top Picks** refresh on the admin's schedule and popularity window (see [Top Picks](top-picks.md))

You never manage any of this yourself — the libraries simply exist and stay current.

---

**Next:** [AI Assistant](ai-assistant.md)
