# Shows You Watch Configuration

The admin side of the [Shows You Watch](../features/shows-you-watch.md) feature — one switch.

![Admin Settings - Shows You Watch](../images/admin/admin-settings-shows-you-watch.png)

## Where It Lives

Admin console → **Recommendations** → **Shows You Watch** (`/admin/recommendations/watching`).

## The Setting

**Enabled / Disabled** — the only control. When disabled:

- The `/watching` page no longer shows users their list
- The **`sync-watching-favorites`** job stops reconciling

## How the Feature Actually Works

There are no thresholds to tune — the list is **user-driven**:

- A user's list is kept in sync **bidirectionally with their media-server series favorites** (favorite a series in Emby/Jellyfin → it appears; remove it in Aperture → it's unfavorited)
- Users add series manually from the page's search
- Any series with played episode history is tracked for episode availability

The hourly `sync-watching-favorites` job (Global tab) does the server-side reconcile; TMDB episode totals refresh lazily per title.

There is deliberately **no "Shows You Watch" virtual library** — the feature is in-app plus the favorites sync, nothing is written to the media server's filesystem.

---

**Related:** [Shows You Watch (user doc)](../features/shows-you-watch.md) · [Global jobs](global-jobs.md) · [User permissions](user-permissions.md)
