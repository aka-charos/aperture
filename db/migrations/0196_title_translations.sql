-- Machine translations of a title's synopsis text (the media-server/TMDb
-- `overview` and OMDb's `plot_full`) into the instance's enabled UI languages.
--
-- Title-scoped like title_analysis: nothing here depends on who is reading, so
-- one translation per (title, language, field) serves every viewer whose
-- interface is in that language.
--
-- `source_hash` is md5 of the EXACT source text that was translated, computed
-- in SQL from the same expression the pending selection and the detail read
-- use (core translation/pending.ts). That is what makes a changed blurb
-- re-translate on the next run and keeps a translation of an OLD blurb from
-- being shown beside a new one: a row whose hash no longer matches the live
-- column is simply not read, and is overwritten when the job reaches it.
--
-- A failed translation writes no row, so it stays pending and the next run
-- retries it — the title_analysis rule.

CREATE TABLE IF NOT EXISTS title_translations (
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  -- No foreign key: movies.id OR series.id depending on media_type, the same
  -- shape title_analysis uses. A removed title leaves an orphan row.
  media_id UUID NOT NULL,
  -- App locale code (packages/core lib/locales.ts APP_LOCALE_OPTIONS).
  language TEXT NOT NULL,
  -- 'overview' | 'plot_full'. Deliberately no CHECK: the vocabulary lives in
  -- code (TRANSLATABLE_FIELDS) and grows without a migration.
  field TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  -- Which model wrote it, as the endpoint named it — a model change is then
  -- visible in SQL without being a reason to discard anything.
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (media_type, media_id, language, field)
);

-- Per-language counts and clears on the settings card.
CREATE INDEX IF NOT EXISTS idx_title_translations_language
  ON title_translations (language);

COMMENT ON TABLE title_translations IS 'Machine translations of overview / plot_full per enabled UI language. Keyed by md5 of the source text so a changed source re-translates and a stale translation is never read.';
COMMENT ON COLUMN title_translations.source_hash IS 'md5 of the source text exactly as translated; must match md5 of the live column expression to be shown.';
