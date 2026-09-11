# Streaming Discovery (JustWatch)

Popular and per-provider **streaming charts** on the Discover page, powered by JustWatch public data.

## Where It Lives

Admin console → **Integrations** → **Streaming providers** (`/admin/integrations/streaming`). The page says it plainly: uses JustWatch public data; "enable only after you are comfortable with the integration."

## Configuration

| Setting | Notes |
|---------|-------|
| **Show streaming charts on Discovery** | Master switch — adds the **Streaming** tab to users' Discover page (users still need Discovery + request permissions of their own) |
| **Provider strips** | Multi-select of JustWatch providers, rendered as chips. Stored values are JustWatch `short_name` codes. Defaults: **Netflix, Disney Plus, Max** (`nfx, dnp, mxx`) |

The provider picker is fed a **US snapshot** of provider terms; codes from other regions stay valid and removable even when the picker can't name them. For regions outside the bundled list, cross-check codes against the live providers endpoint.

## What Users Get

Per configured provider: a **"Popular on {service}"** strip, plus a "Popular (all services)" strip and in-section search, on the Discover page's Streaming tab. Users pick a **country** (remembered per browser); the content **language follows their UI locale**. An **"Only titles not in my library"** switch filters to genuinely new titles, and configured Seerr request statuses appear on the rows.

## How the Data Flows

- JustWatch is queried at **read time** — there is no background job for it
- Two-level cache: in-memory + Postgres (`justwatch_chart_cache`), **TTL 6 hours** (env-overridable), with concurrent fetches deduplicated
- On upstream failure the **stale cache is served** with a "Showing cached results; live data refresh failed" banner; with no cache at all, the tab reports streaming data temporarily unavailable
- Rows are library-matched, given TMDb posters, and stamped with Seerr request statuses (up to 80 items per batch) when Seerr is configured

---

**Related:** [Discover (user doc)](../features/discovery.md) · [Seerr](seerr.md) · [Integrations overview](integrations-overview.md)
