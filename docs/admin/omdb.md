# OMDb Integration

Connect to the Open Movie Database (OMDb) for Rotten Tomatoes (Tomatometer, audience score, consensus), Metacritic, IMDb ratings/votes, awards, languages/countries, and longer plot text.

![Admin Settings - Integrations](../images/admin/admin-settings-setup-integrations.png)

## Accessing Settings

Admin console → **Integrations** → **OMDb** (`/admin/integrations/omdb`).

## Getting an API Key

Request a key at [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx):

| Tier | Cost | Quota | Aperture rate |
|------|------|-------|---------------|
| **Free** | $0 | **1,000 requests/day** | ~1 request/sec |
| **Patron** | $1+/mo | **100,000/day** | **40 requests/sec** |

## Configuration

| Setting | Description |
|---------|-------------|
| **API Key** | Masked once saved |
| **Enable OMDb enrichment** | Master switch |
| **Paid subscription** | **Toggle this if your key is paid** — raises the request rate to 40/sec. This is the single biggest backfill speed lever: at free-tier rate a 12,500-title library takes ~3.5 hours of pure OMDb time; at paid rate, minutes |

**Test** verifies the key.

## How It's Used

- OMDb is fetched **inside the `enrich-metadata` job** (every 6 h by default) for every title that has an **`imdb_id`** — one request per title, then never again (an OMDb "not found" is recorded as attempted; an outage is retried later)
- Adds: RT Tomatometer + audience + **consensus quote**, Metacritic, IMDb rating/votes, awards line, languages/countries, cinematography/music/editing credits, longer plot
- Powers: Browse score filters, Watch Stats "Your Taste vs. the Crowd" (including **guilty pleasures**), detail-page rating badges

## Failure Behavior (Worth Knowing)

- OMDb answers **HTTP 401 for both an invalid key and an exhausted quota** — Aperture tells them apart from the response body and treats them differently
- A **bad key latches for ten minutes** rather than burning one doomed request per library item; keys are trimmed on save and read
- OMDb also reports some errors as **HTTP 200 with an error body** — those are parsed, not trusted
- Failures surface in the [API errors](api-errors.md) panel under the OMDb provider; a successful **Test** clears auth/outage alerts (quota errors are never auto-cleared)

## Rating Freshness

OMDb is fetched **once per title**. Ongoing freshness (a rating that moves as votes accrue) is the separate **[Ratings Refresh](ratings-refresh.md)** integration.

---

**Related:** [TMDb](tmdb.md) · [Ratings refresh](ratings-refresh.md) · [API errors](api-errors.md)
