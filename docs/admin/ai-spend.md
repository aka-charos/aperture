# AI Spend

What model calls **actually cost** — measured, not projected. The projection lives on [Cost estimate](cost-estimate.md); this page is the ledger.

## Where It Lives

Admin console → **AI models** → **Spend** (`/admin/ai/spend`). The page **renders only when at least one AI role points at a metered provider** — currently **OpenRouter** and **Z.AI**; with any other provider configured everywhere, there's nothing to measure and the page hides itself.

## Reading the Numbers

- **OpenRouter** rows are **billed** — the provider reports the credits actually charged
- **Z.AI** rows are **estimated** from its published pricing; the UI marks them "≈" and states the caveat
- Calls with no reported cost are **excluded from totals** and counted separately as "unpriced calls" — a missing cost is never treated as zero
- Gemini **grounding quota is not here** — that's the per-card **free-tier usage panel** on [AI providers](ai-providers.md) (resets midnight US/Pacific)

## What's On the Page

| Section | Contents |
|---------|----------|
| **OpenRouter account** (when configured) | Free-tier chip, credits left vs limit, spent today/week/month/all-time |
| **Stat tiles** | Window spend, today, calls + avg/call, tokens (+ cached share), error rate (colour-coded at 2% / 10%) |
| **Daily spend chart** | Bar chart over the chosen window |
| **Where it goes** | Breakdown by **Feature / Model / Role / Provider** (toggle), per-row mini bars |
| **Assistant conversations** | Per-conversation totals — title, user, calls, tokens, cost, last activity. One chat turn fans out into several model calls, so the conversation is the real unit of cost |
| **Recent calls** | Last 25 calls — model, feature, tokens, latency, cost; errors tinted red with status chips |

## Controls

- **Window**: 7 / 30 / 90 days (default 30)
- **Refresh** button plus auto-poll every 60 s

## Under the Hood

Every LLM call writes to the `llm_inference_calls` ledger (pruned after **120 days**) — capture happens in the provider layer, so no call site needs instrumenting. Job- and chat-scoped attribution rides the execution context; unwrapped work records as `unattributed`.

---

**Related:** [Cost estimate](cost-estimate.md) · [AI providers](ai-providers.md) · [Chat models](chat-models.md)
