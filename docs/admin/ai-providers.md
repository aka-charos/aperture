# AI Providers

Configure every AI capability in one place. AI is organized by **role** — each role has its own provider, model, and keys, on one page of cards.

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

Each card holds **provider → model → API key**, plus whatever that role and model support:

- **API keys** are entered per card, and a role without a key of its own borrows the key of another role on the same provider. The Web Search and Title Analysis keys are never lent out, because they can spend Google grounding quota you may want kept on a separate project.
- **Spare API keys** (Web Search and Title Analysis) rotate in, in order, when the key above runs out of quota. For Google each must come from a different Google project, since keys in one project share one limit.
- **Custom models**: **Add Custom Model…** registers a model keyed to *(provider, role)*, so custom entries do not carry across roles. For LM Studio and Unsloth Studio it lists the models on the server; for an embeddings model it measures the vector width and picks the matching table. A model cannot be added until it tests successfully.
- **Reasoning effort** on the Text Generation and Title Analysis cards, when the chosen model offers it. The levels listed are the ones that model accepts; **Provider default** sends nothing. A reasoning model bills its scratchpad from the same output budget as the answer, so lowering this can stop answers being cut short.
- **Service tier** on the language roles (Chat, Text Generation, Exploration, Title Analysis) when the provider is OpenRouter: **Flex** is cheaper and slower and is never moved to standard capacity, so when the provider is busy a flex call fails rather than costing more. The card says whether the model has a flex endpoint.
- **Temperature** and **Top P** on the Title Analysis card, and only when the chosen model's catalogue entry declares them — many OpenRouter models do not accept temperature at all, so the fields appear per model rather than per provider. Empty means the provider default. The number in a grey field is a suggestion, not a stored value; move one of the two at a time, or a change cannot be attributed.
- **Fallback models** and **call spacing** on the Title Analysis card: models tried in order when the first fails, and a pause between calls for a rate-limited free plan (hidden for LM Studio, Unsloth Studio and Ollama, which have no rate limit).
- **Retrieval mode** (and, for a mode on OpenRouter, a pinned **upstream**) on the Embeddings card, for models that support one. Each mode is a separate set of vectors; see [Embedding models](embedding-models.md).
- **Test** sends a real (billable) request tagged as a settings test. For embeddings it reports the **measured vector width** and whether a matching storage table exists; on OpenRouter it also reports the model's reasoning levels and flex availability, and on flex sends one request to check which tier served it.

Model catalogs ship with the app: OpenAI, Anthropic, Google, Groq, Deepseek, OpenRouter, Z.AI, Hugging Face, Ollama, LM Studio (reads the installed models off the server), Unsloth Studio (the same, for the text roles; no embeddings), and generic OpenAI-compatible endpoints.

## Unsloth Studio

Unsloth Studio runs downloaded GGUF models behind an OpenAI-compatible API. Three settings in Unsloth decide whether Aperture can use it:

- **Where it listens.** Unsloth answers only on localhost unless started with `-H 0.0.0.0` (or LAN access is on), and its machine's firewall must let the port through. The default address is `http://localhost:8888/v1`.
- **Switch model by request** (Settings → API). On, a request naming a downloaded model loads it; off, only the model loaded by hand answers. Leave **Download missing models** off.
- **The API key.** Keyless access covers localhost and private addresses (10.x, 172.16–31.x, 192.168.x). Over Tailscale, a VPN or a public address, create a key under Settings → API (`sk-unsloth-…`) and enter it on the card.

Unsloth's `--secure` address (a Cloudflare quick tunnel) does not carry streamed replies, and title analysis streams, so reach Unsloth over your network or Tailscale for that role.

A model's context window is fixed when Unsloth loads it, so load it with enough room for a title analysis (about 20,000 tokens); **Test** shows the window of a loaded model. Unsloth normally keeps one chat model loaded, so roles pointed at different models reload one at every switch.

Unsloth's **Decision API** (`/v1/systemone`) can also serve the [decision model](decision-model.md): turn on **Serve requests** under Unsloth's Settings → API, then choose **Self-hosted**, enter the same address (and the key, where one is needed), and pick a named model (not `default`).

## Quotas and Free Tiers

- The Web Search card shows a **usage panel** with a quota that resets at **midnight US/Pacific**. **These keys are on the free tier** only decides which ceilings that panel draws; nothing is throttled either way, and keys rotate on real quota errors.
- Rate limits the provider actually reports override the built-in free-tier figures.

## Where the Money Goes

- **AI Spend** (`/admin/ai/spend`) — measured usage, with per-call cost metering for **OpenRouter** (billed) and **Z.AI** (estimated)
- **Cost estimate** (`/admin/ai/estimate`) — a projection from current configuration; unpriceable models are shown as unknown, never as $0

---

**Related:** [Chat models](chat-models.md) · [Embedding models](embedding-models.md) · [API errors](api-errors.md)
