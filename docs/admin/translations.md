# Translations

Edit **any interface string in any locale** — including the English defaults — or bulk-edit via CSV. Overrides apply to every user on their next page load, with no rebuild or restart.

## Where It Lives

Admin console → **Appearance** → **Translations** (`/admin/appearance/translations`).

## The Editor

- **Search** matches keys or English text
- **Audience filter**: All strings / **User-facing** / **Admin console** (classification is by namespace — `adminNav`, `settings*` etc. are admin-only)
- **Namespace filter** and an **"Only overridden"** checkbox
- Table: key · English default · an **Overrides `n/15`** chip · edit action
- **Row editor**: one multiline field per locale (English first), "Default:" shown as the baseline, per-locale **Reset to default**, and **interpolation-token warnings** — a translation missing `{{appName}}` or inventing `{{foo}}` is flagged against the English draft before it saves

New keys cannot be created — the editable universe is every key in the bundled locale files.

## CSV Round-Trip

**Export CSV** exports exactly what the table is showing (filtered keys, effective values including overrides; one row per key, one column per locale, English first). **Import CSV** requires a `key` column, previews every row as *update / reset / unchanged / skipped (unknown key)*, flags interpolation mismatches, and commits in one transaction ("N updated, M reset").

## The Override Stack

Four layers, later wins:

1. **Bundled translations** (15 locales, ships with the app)
2. **File layer**: `overrides.<lang>.json` in the `I18N_OVERRIDES_DIR` (default `/config/branding`'s sibling — `/config/i18n`), bind-mountable, no rebuild
3. **This page's database overrides** — the DB layer wins on conflict

## When to Use It

Fix a mistranslation your users see daily, rename a term house-wide ("Media Graph" → your name for it), or hand a translator a CSV of the user-facing strings and import their work — without touching the codebase.

---

**Related:** [Language defaults](language-defaults.md) · [Instance name & logo](branding.md)
