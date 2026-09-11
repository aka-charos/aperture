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

Only the **`main` shade** of each colour is yours — MUI derives the light/dark variants and contrast text, and the brand **gradients** (buttons, badges, highlights, header accents) are recomputed from your pair. Deliberately fixed: semantic colours (error/warning/success/info) and all backgrounds. The app is **dark-mode only**; "light/dark" in the derived shades does not mean a light theme.

---

**Related:** [Instance name & logo](branding.md) · [Poster display](poster-display.md)
