# My Requests

**My Requests** (sidebar) is where everything you've asked for — and everything you've reported — lives in one place. The page has two tabs: **Requests** and **Issues**.

Requests are fulfilled through your server's *Seerr integration (Jellyseerr/Overseerr)*, which your administrator configures. The page needs it; without Seerr there is nothing to request with. See [Seerr Integration](../admin/seerr.md) on the admin side.

---

## The Requests tab

A table of every request, yours (and everyone's, if you're an admin):

- **What and where from** — each row shows the title, whether it's a movie or series, and the **source**: a *direct request* you made by name, a *Discovery* suggestion you accepted, or a *gap analysis* the administrator ran.
- **Live status** — statuses are pulled from Seerr as it works, not stale copies: *Pending approval → Approved → Processing → Partially available → Available* (or *Declined*). The table also shows Seerr's own status message when there is one.
- **When it's available** — a link opens the title in your media server's library.
- **Filters** — narrow by source and status; paginated for long histories.
- **Administrators** see an **All users** switch, and can **approve or decline** requests inline for anyone.

Selecting a row opens a TMDb detail modal with the full picture of what was requested.

---

## Where requests come from

You can request content from several places; all of it lands here:

- **Discover** — hover a suggestion card and request it directly. See [Discover](discovery.md).
- **Search & request by name** — on the My Requests page, search your Seerr catalog for anything at all — including titles Aperture's Discovery never surfaced — and request it. These are recorded as *direct requests*.
- **Person pages** — the *Not in your library* section of an actor's or director's page can request any of their missing titles (for series, you pick the seasons). See [Person Pages](person-pages.md).
- **Series detail pages** — the *missing episodes* card can request the seasons your server doesn't have. See [Series Details](series-detail.md).

---

## The Issues tab

If a title misbehaves — wrong audio track, missing subtitles, a broken file — report it from the title's own page via **Report a problem**:

1. Pick what kind of problem it is: **Video**, **Audio**, **Subtitles**, or **Something else**.
2. For a series, optionally scope it to a season and episode.
3. Add a message if it helps, and send.

The report is passed to Seerr, where your administrator triages it. The **Issues** tab lists the problems you've reported and their current status; administrators see reports from all users.
