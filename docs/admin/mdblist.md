# MDBList Integration

Connect to MDBList for curated scores (Letterboxd, MDBList ratings), streaming providers, keywords, and as a [Top Picks](top-picks.md) popularity source.

![Admin Settings - Integrations](../images/admin/admin-settings-setup-integrations.png)

## Accessing Settings

Admin console → **Integrations** → **MDBList** (`/admin/integrations/mdblist`).

## Getting an API Key

MDBList issues API keys to registered accounts — free accounts work, and a **supporter subscription** raises your rate limits (tell Aperture about it with the toggle below).

## Configuration

| Setting | Description |
|---------|-------------|
| **API Key** | Masked once saved |
| **Enable MDBList integration** | Master switch |
| **Supporter tier** | On if you subscribe — faster rate limits |

**Test Connection** reports the connected **user**, **account status**, and **how many API requests the test used** — so you can see the shape of your quota from one click.

## The List Selector

For Top Picks use, the built-in list selector searches your MDBList lists or accepts a **pasted list URL or ID**, showing item counts before you commit. A **Library Match Preview** shows how much of a candidate list your library already holds — the difference between "a list" and "a list worth using for Top Picks".

## The `enrich-mdblist` Job

A separate scheduled job — **daily at 07:00**, deliberately its own job rather than part of `enrich-metadata`. Adds **Letterboxd scores, MDBList scores, streaming providers, and keywords** to your titles. MDBList titles are also a [Discovery](../features/discovery.md) candidate source.

## Using MDBList for Top Picks

In [Top Picks](top-picks.md) settings:

- Choose **MDBList** as the popularity source and pick a list (selector above)
- Or choose **Hybrid** and blend local watch data against an external source with the single **local↔external slider** (default 50/50) — the external half can be MDBList **or** a TMDb chart

## Troubleshooting

- **Test fails with auth error** — key wrong or revoked; fix and re-test (a successful test clears the alert; quota errors never auto-clear)
- **Enrichment slow / stalled** — free-tier rate limits; the supporter toggle and off-peak scheduling both help
- **Scores missing on some titles** — MDBList only knows TMDb/IMDb-id titles it has data for; coverage gaps are normal, not failures

---

**Related:** [Top Picks](top-picks.md) · [TMDb](tmdb.md) · [Jobs overview](jobs-overview.md)
