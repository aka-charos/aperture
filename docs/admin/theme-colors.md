# Theme Colours

The **two brand colours** used across the interface — primary and secondary.

## Where It Lives

Admin console → **Appearance** → **Theme colours** (`/admin/appearance/colors`).

## The Controls

- Two colour pickers (swatch + hex field) for **Primary** and **Secondary** (`#rrggbb`; invalid input is rejected, not clamped)
- A **live preview** box rendering the brand gradient
- **Save** applies immediately — every open session re-themes on its next load, and your own page re-themes on save, no reload
- **Reset to default**: primary `#6366f1` (indigo), secondary `#8b5cf6` (purple)

## What Actually Changes

Only the **`main` shade** of each colour is yours — MUI derives the lighter and darker variants and contrast text, and the brand **gradients** (buttons, badges, highlights, header accents) are recomputed from your pair. Deliberately fixed: semantic colours (error/warning/success/info) and all backgrounds.

## Light and Dark Appearances

The app has two appearances, and each viewer picks one for their browser (the sun/moon button in the top bar, or Settings → Display). The dark one is the default.

- With the **default pair** (indigo and purple), the light appearance uses its own accents instead, a slate teal and a deep mauve chosen to read on its gray canvas.
- **Save any other pair** and both appearances use it exactly as saved. Check that your colours read on both a dark and a light background; a colour bright enough for the dark canvas can be too pale on the light one.

**Reset to default** puts the default pair back, which also gives the light appearance its own accents again.

---

**Related:** [Instance name & logo](branding.md) · [Poster display](poster-display.md)
