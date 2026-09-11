# Language Defaults

Which **interface and AI output languages** users can select, and the default for each.

## Where It Lives

Admin console → **Appearance** → **Language defaults** (`/admin/appearance/language`).

## The Four Controls

| Section | Control |
|---------|---------|
| **Interface (UI)** | **Available UI languages** (multi-select allowlist) + **Default UI language** (restricted to the allowlist) |
| **AI output** | **Available AI languages** + **Default AI language** |

Fifteen locales ship: en, es, de, fr, it, pt, nl, ru, ja, zh, ko, hi, ar, he, el (Arabic and Hebrew render right-to-left). An **empty allowlist is rejected** — at least one language must stay enabled — and the active default is always kept selectable; deselecting the current default auto-moves it to the first enabled locale.

The locale list endpoint is public (the login page needs it pre-session).

## What the AI Language Actually Drives

The **AI Summaries language** is the language AI-written text is generated in: taste synopses, recommendation explanations, playlist/collection names and descriptions, and assistant replies — independent of the UI language, useful when a household browses in one language and reads summaries in another.

## Per-User Overrides

Users pick both languages in [Preferences](../features/user-settings/preferences.md) — offered **only the locales you enabled**, cleared field = server default, and the card shows the effective values. A saved user override that you later remove from the allowlist falls back to the server default automatically. Right-to-left locales flip the whole interface direction, not just the text.

---

**Related:** [Translations](translations.md) · [Preferences (user doc)](../features/user-settings/preferences.md)
