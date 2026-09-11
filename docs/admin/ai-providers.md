# AI Providers

Configure every AI capability in one place. AI is organized by **role** — each role has its own provider, model, and keys, on one page of cards.

![Admin Settings - AI/LLM](../images/admin/admin-settings-ai-llm.png)

## Where It Lives

Admin console → **AI models** → **Providers & roles** (`/admin/ai/roles`).

## The Six Roles

| Role | What it does |
|------|--------------|
| **Embeddings** | Vector generation for similarity, recommendations, search |
| **Chat Assistant** | The AI assistant — needs a model with reliable **tool calling** |
| **Text Generation** | Recommendation explanations, taste profiles, playlist text |
| **Exploration** | The semantic graph (Media Graph) |
| **Google Gemini Web Search** | Web grounding for the assistant's discovery turns — **Google only** (a second Gemini key is recommended; see quota below) |
| **Title Analysis** | The grounded critical essays on detail pages — the only role with **fallback models** and request pacing |

The setup wizard requires the first four to be configured before it will finish; the other two are optional features that unlock when configured.

## Per-Role Cards

Each card holds: **provider → model → API key** (per-role keys; a provider's key isn't shared between roles), plus:

- **Spare/fallback API keys** — extra keys per provider that rotate in when the primary hits a quota or auth error (web-search grounding depends on this: Gemini's free tier is what usually breaks)
- **Custom models** — "Add Custom Model…" registers a model keyed to *(provider, role)*, so custom entries don't leak across roles
- **Reasoning effort** (where the model supports it) and **retrieval mode** (input type) on the embeddings card
- **Temperature** and **Top P** on the Title analysis card, and only when the chosen model's catalogue entry declares them — 87 of OpenRouter's 439 models do not accept temperature at all, so the fields appear per model rather than per provider. Empty means the provider default, which is what every role used before these existed. The number in a grey field is a suggestion, not a stored value; move one of the two at a time, or a change cannot be attributed.
- **Test** — sends a real (billable) request tagged as a settings test; for embeddings it reports the **measured vector width** and whether a matching storage table exists

Model catalogs ship with the app — OpenAI, Anthropic, Google, Groq, Deepseek, OpenRouter, Z.AI, HuggingFace, Ollama, LM Studio (auto-discovers installed models), and generic OpenAI-compatible endpoints.

## Quotas and Free Tiers

- The web-search role shows a **free-tier usage panel** with a quota that resets at **midnight US/Pacific**; limits and per-key cooldowns are handled automatically
- A **free-tier toggle** on cards enables per-call pacing for rate-limited free plans

## Where the Money Goes

- **AI Spend** (`/admin/ai/spend`) — measured usage, with per-call cost metering for **OpenRouter** (billed) and **Z.AI** (estimated)
- **Cost estimate** (`/admin/ai/estimate`) — a projection from current configuration; unpriceable models are shown as unknown, never as $0

---

**Related:** [Chat models](chat-models.md) · [Embedding models](embedding-models.md) · [API errors](api-errors.md)
