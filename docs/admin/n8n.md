# n8n Automation

Send events from the AI assistant to [n8n](https://n8n.io) workflows — two hooks, each an independent webhook.

## Where It Lives

Admin console → **Integrations** → **n8n** (`/admin/integrations/n8n`). An **Active** chip appears when either webhook is enabled.

## The Two Webhooks

### Web search tool

> "Model calls this when it needs live web data. Receives `{ type: 'search', query }`."

When enabled, the assistant gains a `search_web` tool that POSTs `{ type: 'search', query, maxResults }` (default 5) to your workflow and feeds the response back to the model. Your workflow decides where to search — this is the BYO-search-engine hook. If the webhook fails or times out, the model receives the error as a tool result and can answer without it; the chat stream never dies.

### Pre-processing hook

> "Runs on every chat message. May return `{ messages, system }` to modify the request."

POSTs `{ type: 'preProcess', userId, isAdmin, messages }` before the assistant answers (10-second timeout). Your workflow may rewrite the message list (validated as UI messages before use) and/or append a string to the system prompt. It **fails open** — a timeout, error, or malformed response means the original request proceeds untouched.

## Per-Webhook Fields

| Field | Notes |
|-------|-------|
| **Enable** switch | |
| **Webhook URL** | `https://…` (required to enable; validated) |
| **Auth header name / value** | Optional custom auth header (value masked) |
| **Timeout (ms)** | 1,000–120,000 (default 15,000) |
| **Test** | Sends a realistic sample payload and shows the response or the underlying error |

Configuration is stored as one JSON blob (`n8n_integration`) in `system_settings`. n8n failures do **not** appear in the [API errors](api-errors.md) panel — they are fail-open by design.

---

**Related:** [AI providers](ai-providers.md) · [Chat models](chat-models.md) · [Tavily](tavily.md)
