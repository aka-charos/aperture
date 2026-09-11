# Tavily Web Search

Optional web-search source for the AI assistant's **discovery turns** — it grounds discovery results **alongside (or instead of) Google**, and acts as a fallback when Google is rate-limited.

## Where It Lives

Admin console → **Integrations** → **Tavily** (`/admin/integrations/tavily`). Chip shows **Enabled** (key saved + switch on) or **Disabled**.

## Configuration

| Setting | Range / default | Notes |
|---------|-----------------|-------|
| **API Key** | — | `tvly-…` from [app.tavily.com](https://app.tavily.com); masked once saved |
| **Max results** | 1–20 (default 5) | Web results fetched per search |
| **Max characters per result** | 100–8,000 (default 1,000) | Truncates each snippet |
| **Search depth** | Basic (default) / Advanced | Advanced is deeper and **costs more credits** |
| **Topic** | General / News | News targets recent content |
| **Time range** | Any / day / week / month / year | |
| **Include synthesized answer** | default on | Requests Tavily's reasoned answer (`advanced` form) at no extra credit cost |
| **Enable Tavily as a web-search source** | off by default | The master switch |

**Test** runs a real sample search ("movies similar to The Matrix") and reports the result count.

## How It Combines with Google

Both sources run **concurrently and their results are combined, never raced** — all retrieved text feeds one structuring pass, so they compose and cover for one another:

- **Google grounding** (the Web Search role on the [AI providers](ai-providers.md) page) is Gemini searching natively, metered against the daily Gemini quota
- **Tavily** is a keyword API — it deliberately ignores the user's taste personalization (that's applied later, at structuring) but gets a reasoning cue so its synthesized answer explains *why* each title fits
- With **no Gemini configured**, a Tavily-only setup still works — the structuring pass falls back to the text-generation role, then the chat model

Failures are recorded to the [API errors](api-errors.md) panel under the Tavily provider (network outages included).

## Costs

Tavily is a paid API metered in credits — charged per search by depth. There is no quota machinery in Aperture for it; watch your Tavily account.

---

**Related:** [AI providers](ai-providers.md) · [fastCRW](crw.md) · [Chat models](chat-models.md)
