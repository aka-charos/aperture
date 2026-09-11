# Channel & Collection Web Expansion

Let [playlists and collections](../features/playlists.md) draw on **web picks** — titles similar to a channel's seeds, found by the Web Search AI role and kept only when they resolve against your library.

## Where It Lives

Admin console → **Recommendations** → **Channel web expansion** (`/admin/recommendations/channels`). One switch:

**"Include web search in scheduled auto-refresh"** — off by default.

## What Expansion Does

For a channel's seed/example titles, the grounding-capable Web Search model is asked for similar titles; only ones that **resolve against your local library** are kept. It is entirely **additive and best-effort**: it returns nothing (cleanly) when the Web Search role is unconfigured, there are no seeds, or nothing new resolves.

## When It Runs

| Path | Web expansion? |
|------|----------------|
| Manual **Generate** on a playlist/collection | **Always** (when the Web Search role is configured) — unless you approved an explicit item list in the preview |
| **Scheduled auto-refresh** | Only when this switch is on |

## Why It's Off by Default

The scheduled path makes **recurring Google grounding calls** — metered against the Web Search role's daily quota (see [AI providers](ai-providers.md)). Enabling it means every scheduled channel refresh across every user spends grounding quota; that's a cost decision left to you.

---

**Related:** [Playlists (user doc)](../features/playlists.md) · [Collections (user doc)](../features/collections.md) · [AI providers](ai-providers.md)
