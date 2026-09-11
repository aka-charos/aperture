# Library Configuration

Choose which media-server libraries Aperture analyzes — everything else stays out of sync, recommendations, and stats.

![Admin Settings - Media Server](../images/admin/admin-settings-setup-media.png)

## Accessing Settings

Admin console → **Library** → **Libraries** (`/admin/library/libraries`). The setup wizard's Libraries step configures the same thing initially, with the same bulk controls.

## Using the Page

- **Movies** and **TV** tabs, each listing the server's libraries with per-library **enable switches**
- An enabled-count chip per tab, and a **warning when zero libraries** of a type are enabled — syncs would do nothing
- **Sync from Media Server** re-reads the library list (run it after adding libraries on the server)
- Changes take effect on the **next `sync-movies` / `sync-series` run** — every 3 hours by default, or run it now from [Jobs](jobs-overview.md)

## What "Disabled" Means

A disabled library is **invisible to Aperture**: not synced, not enriched, not recommended from, not counted in stats, absent from users' library-exclusion lists. Nothing on the media server is touched.

This is **instance-wide**. The per-user version — a user excluding a library from *their own* taste profile while it stays visible in Browse — is a user setting (Watcher Identity → Library Sources), not configured here.

## Recipes

| Goal | Do this |
|------|---------|
| Keep kids' content out of recommendations | Disable the kids library here, or let each parent exclude it per-user |
| A library for raw/new imports you don't want scored | Disable it; enable when curated |
| Recommendations ignore your 4K duplicates | Disable the duplicate library — but watch for titles existing *only* there |

## Troubleshooting

- **New server library doesn't appear** — click **Sync from Media Server**; if still missing, check the [media server connection](media-server.md)
- **Sync runs but nothing changes** — the toggles apply at sync time; check the run happened *after* your change in the job history
- **Recommendations still mention a disabled library** — an old recommendation run predates the change; regenerate

---

**Related:** [Media server](media-server.md) · [User permissions](user-permissions.md) · [Job scheduling](job-scheduling.md)
