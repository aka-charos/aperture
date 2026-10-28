# Translations

Edit **any interface string in any locale** — including the English defaults — or bulk-edit via CSV. Overrides apply to every user on their next page load, with no rebuild or restart. This is the app's own text; plots and film analyses are translated by [Synopsis translation](synopsis-translation.md).

## Where It Lives

Admin console → **Appearance** → **Translations** (`/admin/appearance/translations`).

## The Editor

- **Search** matches keys or English text
- **Audience filter**: All strings / **User-facing** / **Admin console** (classification is by namespace — `adminNav`, `settings*` etc. are admin-only)
- **Namespace filter** and an **"Only overridden"** checkbox
- Table: key · English default · an **Overrides `n/14`** chip (one per locale) · edit action
- **Row editor**: one multiline field per locale (English first), "Default:" shown as the baseline, per-locale **Reset to default**, and **interpolation-token warnings** — a translation missing `{{appName}}` or inventing `{{foo}}` is flagged against the English draft before it saves

New keys cannot be created — the editable universe is every key in the bundled locale files.

## Editing Text Where It Appears

You do not have to come to this page to fix one string. The **Edit text on screen** button in the app bar (the pencil-and-lines icon beside the admin menu, admins only, not on a phone) switches the whole app into an edit mode:

- **Hover** any text to outline it and see its key
- **Click** it to open a small editor with the **English** text and **one other language side by side** — the language you choose in the toolbar at the bottom, which starts as the language the app is in (or the first other enabled language when you use the app in English). Saving shows the new text at once, for you and for everyone on their next page load
- **Alt+click** uses the page as normal, so you can open menus and dialogs to reach the text inside them
- **Strings on this screen** in the toolbar lists everything the screen has drawn, including text you cannot click (tooltips, messages, a menu that has closed), filterable by key or text
- When one text comes from several keys (a "Cancel" shared by many dialogs) the editor offers each key; the one rendered most recently, almost always the one you clicked, is chosen first
- **All languages** opens this page searched to that key

The edit mode matches what you click by its text, never by changing the text itself, so nothing the app sends or stores is affected while it is on. Text drawn without the translation system (titles, names, synopses) is not editable this way.

## CSV Round-Trip

**Export CSV** exports exactly what the table is showing (filtered keys, effective values including overrides; one row per key, one column per locale, English first). **Import CSV** requires a `key` column, previews every row as *update / reset / unchanged / skipped (unknown key)*, flags interpolation mismatches, and commits in one transaction ("N updated, M reset").

## The Override Stack

Three layers, later wins:

1. **Bundled translations** (14 locales, ships with the app)
2. **File layer**: `overrides.<lang>.json` in `I18N_OVERRIDES_DIR` (default `/config/i18n`), bind-mountable, no rebuild
3. **This page's database overrides** — the DB layer wins on conflict

## When to Use It

Fix a mistranslation your users see daily, rename a term house-wide ("Media Graph" → your name for it), or hand a translator a CSV of the user-facing strings and import their work — without touching the codebase.

---

**Related:** [Language defaults](language-defaults.md) · [Instance name & logo](branding.md)
