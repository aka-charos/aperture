# Instance Name & Logo

What this instance calls itself — everywhere.

## Where It Lives

Admin console → **Appearance** → **Instance name & logo** (`/admin/appearance/branding`).

## The Name

One field, up to **40 characters**, blank = back to the default ("Aperture"). **Reset to Aperture** restores it. The name flows into:

- The **browser tab title** and the **sidebar wordmark**, and the **login card**
- **Every translated string** containing `{{appName}}`, in all 15 locales — including *"Why {{appName}} picked this for you"* on recommendation panels and the AI-explanation preference copy
- The **NFO credit lines** written into your media server ("🎯 Why {name} picked this for you:" in the `<plot>` of AI Picks library items) — the renamed instance brands the metadata in Emby/Jellyfin too

## Logo & Favicon

Artwork is **bind-mounted, not uploaded**. The page shows the compose snippet:

```yaml
environment:
  BRANDING_DIR: /config/branding
volumes:
  - ./data/branding:/config/branding:ro
```

Drop `logo.svg` and `favicon.svg` into that folder (PNG/WebP/JPG and `.ico` also accepted; square artwork). Replaced files take effect on the **next request** — no restart. The page reports whether it's "using `logo.svg`" or the bundled artwork.

The name/logo endpoint is deliberately **public** — the login page needs it before any session exists.

---

**Related:** [Theme colours](theme-colors.md) · [Language defaults](language-defaults.md)
