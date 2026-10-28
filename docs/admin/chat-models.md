# Chat Models

Configure which AI model powers the AI assistant (the chat in the corner of every page).

## Where It Lives

Admin console → **AI models** → **Providers & roles** → the **Chat Assistant** card (`/admin/ai/roles`). Card text: *"Needs tool calling to search your library and make recommendations."*

## Choosing a Model

The hard requirement is **reliable tool calling** — the assistant answers by calling tools (library search, history, ratings, discovery), so models without solid function-calling produce bad answers no matter how fluent they are. The card warns when a selected model doesn't support it, with specific advice for local setups (e.g. Ollama models to prefer).

Everything else is preference:

- **Cloud models** — any of the OpenAI, Anthropic, Google, Deepseek, OpenRouter, Z.AI, Groq catalogs. There is deliberately no reasoning-effort control on this card (the assistant is interactive, and thinking is often the point); on OpenRouter the **Flex** service tier is offered, but a chat turn that fails on a busy flex endpoint fails for the user
- **Local models** — Ollama, LM Studio and Unsloth Studio (auto-discovery of installed models) work for privacy-conscious deployments; quality depends on the model's tool-calling
- The card takes its own API key, or borrows the key of another role on the same provider

## What Chat Costs

Every turn is **metered** — token counts and cost land in `llm_inference_calls`, and the **AI Spend** dashboard (`/admin/ai/spend`) has a per-conversation view, so there's no need to hand-estimate: look at what it actually spent. Cost is only known for metered providers (OpenRouter, Z.AI); other providers show calls without cost figures.

## Disabling Chat

Leave the chat role unconfigured — the sparkle button disappears and the assistant page reports the assistant is unavailable. To withhold it from particular users instead, switch off their **Assistant** permission on the [Users](user-permissions.md) page (admins always have it). The system prompt itself is code-defined; there is no admin prompt editor.

---

**Related:** [AI providers](ai-providers.md) · [AI assistant (user doc)](../features/ai-assistant.md) · [AI spend](ai-spend.md)
