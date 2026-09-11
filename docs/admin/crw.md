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

## Service Configuration

| Field | Default | Notes |
|-------|---------|-------|
| **Use the retrieval service** | off | Master switch |
| **Service URL** | `http://host.docker.internal:3000` | **Never localhost** — Compose containers reach the host differently; the helper explains the addressing |
| **API key** | optional | Clearing the field and saving removes the stored key |
| **Search engine cascade** | three ordered selects | google / duckduckgo / bing + "None"; tried in order until one returns results |
| **Results per title** | 6 (1–20) | |
| **Timeout** | 90 s (5–300) | One page can take >80 s; check `ladder_min_ms` in the service's boot log |
| **Source text per analysis** | 16,000 chars (2k–200k) | ~4 chars/token; size to the model's context window |
| **Analysis output limit** | 8,000 tokens (0 = none) | Runaway backstop, not a length control |
| **Max text per page** | 12,000 chars (1k–100k) | Safety valve |

**Test** performs a real one-result search ("film criticism") and names which engine answered — deliberately not a health ping, which a half-started container can pass.

## Engine Health

The cascade self-heals: **five consecutive empty answers park an engine at the back of the queue for 30 minutes**, then it's retried. Engines are never dropped permanently. A 200-with-zero-results-and-warnings response is treated as "engine blocked", not "nothing on the web".

## How Title Analysis Uses It

The manual `generate-title-analysis` job refuses to start when the mode isn't ready. Per title: engines are tried in health order, the first with results wins; the fetched text is budgeted to the configured character cap; both the retrieval mode and the sources count are recorded per analysis so results are comparable. A grounded call that returns **zero** grounding citations is thrown away — the model answered from memory, which is exactly what this feature exists to prevent.

Failures land in the [API errors](api-errors.md) panel under the fastCRW provider.

---

**Related:** [Title analysis (user doc)](../features/title-analysis.md) · [AI providers](ai-providers.md) · [Tavily](tavily.md)
