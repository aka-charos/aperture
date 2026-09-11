# Integrations Overview

Aperture connects to external services for metadata, ratings, requests, and AI grounding. Each integration is its own page in the admin console.

![Admin Settings - Integrations](../images/admin/admin-settings-setup-integrations.png)

## Where Integrations Live

Admin console → **Integrations** — one page per service:

| Integration | Page | What it provides |
|-------------|------|------------------|
| **TMDB** | `/admin/integrations/tmdb` | Metadata enrichment, posters, genre strips, gap analysis — the backbone |
| **OMDb** | `/admin/integrations/omdb` | RT/Metacritic/IMDb scores, awards, plot |
| **MDBList** | `/admin/integrations/mdblist` | Curated scores, streaming providers, a Top Picks source |
| **Trakt** | `/admin/integrations/trakt` | Per-user rating sync + Discovery chart sources |
| **Seerr** | `/admin/integrations/seerr` | Requests, issue reporting, Top Picks auto-request |
| **LLDAP** | `/admin/integrations/lldap` | Email address import for users |
| **n8n** | `/admin/integrations/n8n` | Webhook automation |
| **Tavily** | `/admin/integrations/tavily` | Web search for the assistant's discovery turns |
| **fastCRW** | `/admin/integrations/crw` | Self-hosted search/scrape for Title Analysis |
| **Streaming (JustWatch)** | `/admin/integrations/streaming` | Streaming-chart discovery tab |
| **Ratings Refresh** | `/admin/integrations/ratings-refresh` | Ongoing IMDb rating freshness |

Each card shows a green **Configured** chip once saved; most have an **enable switch**, so an integration is turned off by toggling — the key stays saved.

## Setup Order

1. **Media server** first (Library group) — everything reads from it
2. **TMDB** — gates genre strips, discovery tuning, and gap analysis
3. **OMDb** — scores for filtering and taste-vs-crowd
4. **AI models** (its own group) — required before embeddings and recommendations
5. Everything else as needed

## Storage Note

API keys are stored in the `system_settings` table **in plain text** (database file access should be trusted accordingly); they are redacted from logs and from the API responses that fill the admin forms.

## When an Integration Breaks

Failures surface in the **[API errors](api-errors.md)** panel inside the admin shell — with an alert that lingers until dismissed or cleared by a successful connection test.

---

**Related:** [Media server](media-server.md) · [AI providers](ai-providers.md) · [API errors](api-errors.md)
