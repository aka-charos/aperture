-- Migration: 0178_search_title_key
-- Description: One accent- and punctuation-insensitive title key for library
-- search, with trigram indexes on it.
--
-- Global search compared the raw query against the raw title, so three kinds of
-- character made a title harder to find than it should be:
--   * accents: "amelie" ranked "Amelia's Children" above "Amélie";
--   * apostrophes: "dont look up" ranked "Dont Look Now" above "Don't Look Up",
--     because pg_trgm reads "don't" as the two words "don" and "t";
--   * everything else (":" "&" "-"): harmless to pg_trgm, which treats them as
--     separators, but they made an exact or prefix comparison impossible, since
--     "terminator 2: judgment day" does not start with "terminator 2 judgment".
--
-- aperture_search_key() is the one definition of "the same text". The search
-- route applies it to BOTH sides — the title here, the query through
-- `SELECT aperture_search_key($1)` — so the two can never be folded differently.
-- It lowercases, strips accents, deletes apostrophes (so "don't" = "dont"), turns
-- every other run of punctuation or whitespace into one space, and trims.
--
-- WHY IMMUTABLE ALTHOUGH unaccent() IS STABLE. A generated column must be
-- immutable. 0134 declined to index unaccented titles at assistant scale; global
-- search runs on every keystroke, and without stored keys every one of them would
-- unaccent the whole library. The usual caveat applies: if the unaccent rules file
-- ever changes, stored keys keep the old fold until their title is rewritten.
--
-- WHY THE BODY IS BUILT WITH format(). A function behind a generated column is
-- re-run when a plain pg_dump (which is what backups here are) restores the
-- table, and that restore runs with an empty search_path. So unaccent is
-- schema-qualified, and the schema is read from pg_extension rather than assumed
-- to be "public", since an external database may have installed its extensions
-- elsewhere. Everything else lives in pg_catalog, which is searched regardless.
--
-- Non-ASCII quotes and dashes are written as \uXXXX regex escapes, which the
-- regex engine decodes, so this file stays ASCII and cannot be mangled by an
-- editor or shell that mishandles UTF-8.

DO $$
DECLARE
  unaccent_schema text;
BEGIN
  SELECT n.nspname INTO unaccent_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'unaccent';

  IF unaccent_schema IS NULL THEN
    RAISE EXCEPTION 'extension unaccent is not installed (expected from migration 0134)';
  END IF;

  EXECUTE format(
    $f$
    CREATE OR REPLACE FUNCTION aperture_search_key(p_text text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE STRICT PARALLEL SAFE
    AS $body$
      SELECT pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(
            pg_catalog.lower(%1$I.unaccent(%2$L::regdictionary, p_text)),
            '[''‘’`´]', '', 'g'
          ),
          '[[:space:][:punct:]·•–—…“”„«»¿¡]+', ' ', 'g'
        )
      )
    $body$
    $f$,
    unaccent_schema,
    format('%I.unaccent', unaccent_schema)
  );
END
$$;

COMMENT ON FUNCTION aperture_search_key(text) IS
  'Search key for a title or a query: lowercase, unaccented, apostrophes removed, other punctuation collapsed to single spaces';

-- The keys are STORED, not computed per query. Folding a title costs about as
-- much as comparing it, and the search compares each candidate several times, so
-- a broad query ("the") spent most of its time re-folding the same titles. A
-- generated column is recomputed by Postgres whenever the title changes, so no
-- sync path can forget it.
ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS title_search_key text
    GENERATED ALWAYS AS (aperture_search_key(title)) STORED,
  ADD COLUMN IF NOT EXISTS original_title_search_key text
    GENERATED ALWAYS AS (aperture_search_key(original_title)) STORED;

ALTER TABLE series
  ADD COLUMN IF NOT EXISTS title_search_key text
    GENERATED ALWAYS AS (aperture_search_key(title)) STORED,
  ADD COLUMN IF NOT EXISTS original_title_search_key text
    GENERATED ALWAYS AS (aperture_search_key(original_title)) STORED;

-- word_similarity (<%) and similarity (%) against these are what the search
-- route filters on; both are served by gin_trgm_ops.
CREATE INDEX IF NOT EXISTS idx_movies_title_search_key
  ON movies USING GIN (title_search_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_movies_original_title_search_key
  ON movies USING GIN (original_title_search_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_series_title_search_key
  ON series USING GIN (title_search_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_series_original_title_search_key
  ON series USING GIN (original_title_search_key gin_trgm_ops);
