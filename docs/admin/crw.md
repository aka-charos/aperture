# Retrieval Service (fastCRW)

Self-hosted web search and scraping that gives [Title Analysis](../features/title-analysis.md) its sources — one call returns clean page text, and there is **no API quota: the limits are your hardware**.

## Where It Lives

Admin console → **Integrations** → **fastCRW** (`/admin/integrations/crw`). Chips: **Enabled** or "Configured, off".

## Retrieval Mode

The page's mode selector chooses **where analysis gets its sources**:

| Mode | Behaviour |
|------|-----------|
| **Self-hosted retrieval** (default) | Sources come from your fastCRW service — no quota, so a local/cheap model suffices for the writing |
| **Model built-in search** (grounding) | Gemini searches itself via the Web Search role — **metered per day per Google project** ("on a free tier that is a few dozen titles a day"); requires Google selected for the Title Analysis role |

A readiness warning appears when the current mode can't run (Title Analysis model unset / grounding without a Gemini model / service unconfigured), with the exact reason. Switching to grounding keeps the service fields saved but unused.

## Running the Service

Aperture does not ship the service; you run it beside Aperture. The repo has a ready-made compose file, [`docker-compose.crw.yml`](https://github.com/aka-charos/aperture/blob/dev/docker-compose.crw.yml), that starts the whole stack — fastCRW (`crw-camofox`), LightPanda, Camofox and Byparr — with the settings Aperture works best with. It is standalone: download that one file, nothing else.

```bash
docker compose -f docker-compose.crw.yml up -d
docker compose -f docker-compose.crw.yml ps
```

`ps` should list four running services, with `camofox` healthy. The first start pulls several images and takes a few minutes.

Then set the **Service URL** in Aperture. Aperture runs in its own container, so the address is the one *that container* uses to reach the host, never `localhost`:

| Aperture runs on | Service URL |
|------------------|-------------|
| Docker Desktop (Windows, Mac) | `http://host.docker.internal:3000` |
| Linux, same machine | `http://<the machine's LAN address>:3000` (or add `extra_hosts: ["host.docker.internal:host-gateway"]` to Aperture's service) |
| Another machine | `http://<that machine's address>:3000` |

If port 3000 is taken, put `CRW_HOST_PORT=3010` in a `.env` file beside the compose file and use that port. Press **Test**: it names the engine that answered.

What the file changes from the image's defaults, and why:

- **One search per title per engine** (`CRW_SEARCH__QUERY_EXPAND=false`). The image triples the searches for each title; search engines block on request rate, and Aperture builds its own prompt from the raw results.
- **A Firefox user agent** on the plain HTTP tier, which otherwise announces itself as `CRW/0.0.1` and is blocked by simple CDN rules.
- **Two render tabs** and the **10 requests per second cap** restored, so one title's pages do not arrive as a burst.
- **Memory limits and a restart policy** on every service. Byparr and Camofox are real browsers; an exit code of 137 in `docker compose ps` means a limit killed one, so raise it.

Keep these in mind:

- **Do not publish the service to the internet.** It has no login in this setup; anyone who can reach port 3000 can make your machine fetch pages. Byparr and Camofox are deliberately not published at all.
- **All four services are required.** The image sends walled pages to Byparr and searches through Camofox.
- **Updating is deliberate.** Change the tag on the `crw` image, then `pull` and `up -d`. A tag, `latest` included, never updates itself.
- A datacenter IP is the commonest reason pages come back walled. The file has a commented `CRW_CRAWLER__PROXY` line for a proxy; it covers the HTTP tier only, not the search or the browsers.

## Service Configuration

| Field | Default | Notes |
|-------|---------|-------|
| **Use the retrieval service** | off | Master switch |
| **Service URL** | `http://host.docker.internal:3000` | **Never localhost** — Compose containers reach the host differently; the helper explains the addressing |
| **API key** | optional | Clearing the field and saving removes the stored key |
| **Search engine cascade** | google, duckduckgo, bing | Three ordered selects, each with "None"; tried in order until one returns results. Each is a separate request, so drop an engine that is permanently blocked |
| **Results per title** | 6 (1–20) | Pages searched and fetched by the general search |
| **Extra criticism results** | 4 (0–20) | A second search limited to the **Criticism publications** below, **added to** the results above rather than taken from them. 0 switches it off |
| **Criticism publications** | built-in list | The sites the extra search asks, as hosts (optionally with a path, e.g. `mubi.com/en/notebook`). Choose publications that print argued criticism; empty uses the built-in list |
| **Time per page** | 45 s (5–60) | How long the service may spend fetching one result page. Pages behind a bot check need the time; the service itself gives a page 15 s if this is not sent |
| **Timeout** | 180 s (5–300) | One search call: the search, then fetching every result. Must be at least 60 s above the time per page, and saving refuses a pair that does not fit |
| **Source text per analysis** | 16,000 chars (2k–200k) | ~4 chars/token; size to the model's context window. More documents divide this budget, they do not grow it |
| **Analysis output limit** | 8,000 tokens (0 = none) | Runaway backstop, not a length control |
| **Maximum text per page** | 12,000 chars (1k–100k) | Safety valve |

**Test** performs a real one-result search ("film criticism") and names which engine answered — deliberately not a health ping, which a half-started container can pass. It uses the fields as they stand; the saved API key is only sent to the URL it was saved for.

## Engine Health

The cascade self-heals: **five consecutive empty answers park an engine at the back of the queue for 30 minutes**, then it's retried. Engines are never dropped permanently. A 200-with-zero-results-and-warnings response is treated as "engine blocked", not "nothing on the web".

## How Title Analysis Uses It

The `generate-title-analysis` job (manual by default, schedulable, with a configurable titles-per-run limit) refuses to start when the mode isn't ready. Per title: engines are tried in health order, the first with results wins, and the criticism search runs beside it. Before anything reaches the prompt, pages that are bot walls, empty fetches, listings with no prose, pages that never name the title, and repeats of a page already kept are dropped, at most one page per site is kept, and navigation menus and plot sections are stripped from what is left. Optionally, the [decision model](decision-model.md#weeding-title-analysis-sources) then drops pages that carry no writing about the title. The remaining text is budgeted to the configured character cap. The retrieval mode and the sources are recorded per analysis so results are comparable. A grounded call that returns **zero** grounding citations is thrown away — the model answered from memory, which is exactly what this feature exists to prevent.

## The Assistant's Web Search

When the service is enabled, the assistant also searches it for recommendations, beside Google and [Tavily](tavily.md). The switch **Use in the assistant's web search** on the card (on by default) leaves it out of the chat without turning it off for title analysis.

The chat asks for much less than an analysis does: one engine (the first that isn't parked, with no cascade), up to 5 pages, 15 seconds per page and about 25 seconds for the whole search. Bot walls and pages with no real text are dropped, menus are stripped, and each page is trimmed before it is combined with the other sources. If nothing worth keeping comes back, the chat carries on with the other sources.

Searches queue on the service, so while a title analysis job is running a chat search can wait behind it and run out of time. Turn the switch off if that matters more than the extra source.

Failures land in the [API errors](api-errors.md) panel under the fastCRW provider.

---

**Related:** [Title analysis (user doc)](../features/title-analysis.md) · [AI providers](ai-providers.md) · [Tavily](tavily.md)
