# Chat Models

Configure which AI model powers the AI assistant (the chat in the corner of every page).

![Admin Settings - AI/LLM](../images/admin/admin-settings-ai-llm.png)

## Where It Lives

Admin console → **AI models** → **Providers & roles** → the **Chat Assistant** card (`/admin/ai/roles`). Card text: *"Needs tool calling to search your library and make recommendations."*

## Choosing a Model

The hard requirement is **reliable tool calling** — the assistant answers by calling tools (library search, history, ratings, discovery), so models without solid function-calling produce bad answers no matter how fluent they are. The card warns when a selected model doesn't support it, with specific advice for local setups (e.g. Ollama models to prefer).

Everything else is preference:

- **Cloud models** — any of the OpenAI, Anthropic, Google, Deepseek, OpenRouter, Z.AI, Groq catalogs; reasoning effort is configurable per card
- **Local models** — Ollama and LM Studio (auto-discovery of installed models) work for privacy-conscious deployments; quality depends on the model's tool-calling
- Each role (chat included) holds its **own API key** plus spare/fallback keys

## What Chat Costs

Every turn is **metered** — token counts and cost land in `llm_inference_calls`, and the **AI Spend** dashboard (`/admin/ai/spend`) has a per-conversation view, so there's no need to hand-estimate: look at what it actually spent. Cost is only known for metered providers (OpenRouter, Z.AI); other providers show calls without cost figures.

## Disabling Chat

Leave the chat role unconfigured — the sparkle button disappears and the assistant page reports the assistant is unavailable. The system prompt itself is code-defined; there is no admin prompt editor.

---

**Related:** [AI providers](ai-providers.md) · [AI assistant (user doc)](../features/ai-assistant.md) · [AI spend](ai-providers.md)
