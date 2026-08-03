-- Migration: 0128_i18n_overrides
-- Description: Admin-editable UI string overrides, one row per (locale, dot-path key).
--
-- This is the DB layer of the Translations editor. It sits above two existing,
-- lower-precedence override layers (see apps/api/src/routes/i18n/handlers/publicOverrides.ts):
-- the bundled JSON shipped in apps/web, and the operator-managed file at
-- I18N_OVERRIDES_DIR/overrides.<lng>.json. A row here always wins over both.
-- Deleting a row resets that key back to whatever the layers below it say.
--
-- A dedicated table (not packages/core/src/settings/systemSettings.ts's generic
-- key-value store) because this is ~3,800 keys x 15 locales of structured data,
-- not a handful of scalar settings.

CREATE TABLE IF NOT EXISTS i18n_overrides (
  locale TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (locale, key)
);

-- Supports "load every locale's value for one key" (the per-key edit dialog).
CREATE INDEX IF NOT EXISTS idx_i18n_overrides_key ON i18n_overrides (key);

COMMENT ON TABLE i18n_overrides IS 'Admin-edited UI string overrides, keyed by locale + dot-path key. Highest-precedence override layer; deep-merged over the bundled translation.json and the operator file overrides at request time.';
COMMENT ON COLUMN i18n_overrides.locale IS '2-letter code from packages/core APP_LOCALE_OPTIONS, including en (English source is editable too).';
COMMENT ON COLUMN i18n_overrides.key IS 'Dot-path into the nested translation.json, e.g. admin.dashboard.systemStatus.title. Segments restricted to [A-Za-z0-9_]+ and never __proto__/constructor/prototype (enforced at write time).';
COMMENT ON COLUMN i18n_overrides.value IS 'Override text. Every leaf in this app''s translation files is a string (no arrays), so no JSONB needed.';
