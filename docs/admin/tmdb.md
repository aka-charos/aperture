# TMDb Integration

Connect to The Movie Database (TMDb) — the metadata backbone of Aperture: enrichment, posters, genre strips, gap analysis, and the external side of discovery all read from it.

![Admin Settings - Integrations](../images/admin/admin-settings-setup-integrations.png)

## Accessing Settings

Admin console → **Integrations** → **TMDB** (`/admin/integrations/tmdb`).

## Getting an API Key

1. Create a (free) account at [themoviedb.org](https://www.themoviedb.org/signup)
2. Go to **Settings → API** and request a **Developer** key — any personal-use description works
3. Copy the **API Key (v3 auth)** — that's the value Aperture wants

Free tier, no per-key quota that Aperture's usage would approach.

## Configuration

| Setting | Description |
|---------|-------------|
| **API Key** | The v3 key above — masked once saved |
| **Enable TMDb enrichment** | Master switch; off keeps the key saved but skips enrichment work |

**Test** verifies the key before you save.

## What TMDb Feeds

| Consumer | What it uses |
|----------|--------------|
| **Metadata enrichment** (`enrich-metadata`, every 6 h) | Keywords, **collections** (franchises), crew, runtimes — for movies *and* series |
| **Posters & artwork** | Poster proxying, studio logos (separate `enrich-studio-logos` job), person profiles |
| **Genre strips & Discovery tuning** | Both admin pages are **gated**: they're hidden/redirected until TMDb is configured |
| **Gap analysis** | TMDb collection membership vs your library (`/admin/library/gaps`) |
| **Discovery & streaming rows** | External candidates, poster paths for JustWatch rows |

Selection is schema-aware and simple: rows with an `imdb_id`/`tmdb_id` that haven't been enriched yet, processed until the pending set is empty.

## Ratings Are Not Enrichment

Ratings change; metadata doesn't. Ongoing rating freshness is the separate **[Ratings Refresh](ratings-refresh.md)** integration (`refresh-ratings` job, IMDb's daily dataset) — deliberately outside the enrichment job, which stamps a title once and never revisits it.

## Troubleshooting

- **"Not configured" gates everywhere** — genre strips, discovery tuning, and gap analysis are *hidden* until a working key is saved; fix the key and they reappear (the gate re-probes, it isn't cached)
- **Enrichment running but nothing enriched** — the pending selection only picks rows with an `imdb_id`/`tmdb_id`; run a library sync first and check that your titles carry ids
- **Posters missing after enrichment** — check the `enrich-metadata` run logs and the [API errors](api-errors.md) panel for TMDb failures

---

**Related:** [OMDb](omdb.md) · [Ratings refresh](ratings-refresh.md) · [Discovery tuning](discovery-tuning.md)
