# Cost Estimate

Projected spend **before committing to a model** — published per-million prices × assumed call volumes. Contrast with [AI Spend](ai-spend.md), which reports what was actually measured.

## Where It Lives

Admin console → **AI models** → **Cost estimate** (`/admin/ai/estimate`).

## The Three Price States

Every configured role is priced into one of three states:

| State | Display |
|-------|---------|
| **Priced** | Per-million input/output price from the catalog |
| **Local** | Self-hosted (Ollama, LM Studio) — free, shown with a green **Local** chip |
| **Unknown** | An em-dash with a tooltip — **"No published price for this model"** |

Unknown pricing triggers a warning: totals are an **undercount**, and unpriced roles are *not counted as free*. Unknown is never rendered as $0.

## Your Inputs

Editable growth assumptions (saved for next time): **movies/week** (default 5), **shows/week** (3), **episodes/week** (20), **chat messages per user per week** (50).

## The Two Tables

**Initial embedding costs** — priced over the titles still *pending* embedding (token constants: 400/movie, 480/series, 240/episode). Empty state: "Everything is embedded — nothing left to pay for."

**Weekly recurring costs** — new-content embeddings, taste synopses, recommendation explanations, assistant suggestions, and chat (2000 in / 500 out tokens per assumed message), scaled by your growth inputs and the jobs' actual schedules.

Summary tiles: **Initial setup**, **Weekly**, and **Monthly** (weekly × 4.33). Any self-hosted role earns a "this part is free" note.

## Pricing Catalog

Prices come from the **Helicone LLM-costs API**, cached for 24 hours; a status/refresh control exists for the cache. Internal provider/model ids are mapped to catalog entries — models that don't map are the "unknown" rows above.

---

**Related:** [AI Spend](ai-spend.md) · [AI providers](ai-providers.md) · [Text generation models](text-models.md)
