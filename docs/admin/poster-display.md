# Poster Display

The **default for the community-rating badge on library posters** — set it here; users can override it for themselves.

## Where It Lives

Admin console → **Appearance** → **Poster display** (`/admin/appearance/posters`).

## The Setting

One switch: **"Show rating badge on library posters"** (default on). Caption: *"Turn this off if your server burns ratings into the artwork. Discover and other TMDb covers always show their rating."*

Scope is **library posters only** — covers Aperture sources from TMDb (Discover, streaming charts, discovery cards) always show their badge regardless.

## Server Default vs User Override

The relationship, in order:

1. **User's explicit choice** (User Settings → Preferences → Poster Display) wins
2. Otherwise the **instance default set here** applies
3. The user's "Reset to default" returns them to *this* setting

Users' effective value is computed server-side and cached client-side to avoid a badge flash on first paint. Changes here apply to every user who hasn't made their own choice.

---

**Related:** [Theme colours](theme-colors.md) · [Language defaults](language-defaults.md)
