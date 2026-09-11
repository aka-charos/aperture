# Text Generation Models

Configure which AI model writes recommendation explanations, taste profiles, and playlist text.

![Admin Settings - AI/LLM](../images/admin/admin-settings-ai-llm.png)

## Where It Lives

Admin console → **AI models** → **Providers & roles** → the **Text Generation** card (`/admin/ai/roles`).

## What Uses This Role

- **Recommendation explanations** — the "Why Aperture picked this for you" notes (see [AI Explanations](ai-explanations.md))
- **Taste profiles** — the "Analyze Watch History" prose and profile building (`rebuild-taste-profiles` job)
- **Playlist/collection text** — AI-generated names, descriptions, and per-item reasons
- A separate **Title Analysis** role exists for the detail-page essays — point it at a different model if you want essays on a separate budget

## Batch Behaviour

Explanations are generated as **batches of 10 in one call**. The token budget depends on the provider tier:

| Provider tier | Batch size | Max tokens per call |
|---------------|-----------|---------------------|
| Large-context (OpenAI, Anthropic, Google, Deepseek, OpenRouter, Z.AI) | 10 | **16,000** |
| Groq | 5 | 1,500 |
| Ollama | 3 | 1,000 |

The large-context ceiling is deliberately generous: reasoning models spend part of the budget on their own scratchpad, and `maxTokens` is a cap, not a reservation. A response that isn't valid JSON is **salvaged entry-by-entry** rather than retried wholesale; responses cut off by the length limit are logged (`finishReason: length`) in the job logs.

## Costs

Two surfaces, deliberately separate:

- **Cost estimate** (`/admin/ai/estimate`) — projects per-run cost from the current config
- **AI Spend** (`/admin/ai/spend`) — measured reality (metered for OpenRouter and Z.AI)

Model-specific price tables are not maintained in this doc — the estimator reads the live catalogs, and unknown pricing is shown as unknown.

## Job Entry Points

- Explanations generate during `generate-movie/series-recommendations`
- **`refresh-recommendation-explanations`** — re-runs explanations *without* re-scoring; cancellable, manual

---

**Related:** [AI providers](ai-providers.md) · [AI explanations](ai-explanations.md) · [Algorithm tuning](algorithm-tuning.md)
