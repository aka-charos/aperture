-- Migration: 0201_origin_countries_repair
-- Description: Send origin_countries written by 0200's first writer back to be
-- asked again, and record what a stamp without an origin means.
--
-- The first writer passed codes the country canonicaliser does not resolve
-- straight through, so TMDb's codes for states that no longer exist were
-- stored raw: 'SU' instead of 'Soviet Union', likewise XC, YU, XG, CS, and NA
-- (which the canonicaliser refuses because in free text it usually means "not
-- available"). A raw code matches no country the Browse picker offers, and
-- since a non-empty origin overrides the first production country, a Soviet
-- film stopped matching "Soviet Union" at all.
--
-- The writer now maps those codes (core tmdb/originCountries.ts, the ONE copy
-- of the table) and treats a list it cannot resolve as no answer. Rather than
-- repeat that table here, where it could never follow a later edit, this
-- clears any row holding a bare two-letter code (no canonical country name is
-- two letters) so the next enrich-metadata backfill asks TMDb again and writes
-- it through the current writer. It is one TMDb request per affected title,
-- and a no-op where the backfill had not run yet.

UPDATE movies
SET origin_countries = NULL, origin_countries_fetched_at = NULL
WHERE origin_countries IS NOT NULL
  AND EXISTS (SELECT 1 FROM unnest(origin_countries) AS x(code) WHERE x.code ~ '^[A-Z]{2}$');

UPDATE series
SET origin_countries = NULL, origin_countries_fetched_at = NULL
WHERE origin_countries IS NOT NULL
  AND EXISTS (SELECT 1 FROM unnest(origin_countries) AS x(code) WHERE x.code ~ '^[A-Z]{2}$');

COMMENT ON COLUMN movies.origin_countries IS
  'TMDb origin_country as canonical names (0200/0201). NULL = no answer yet; {} = TMDb lists none. Browse treats it as the primary country, falling back to production_countries[1] when NULL or empty.';
COMMENT ON COLUMN series.origin_countries IS
  'TMDb origin_country as canonical names (0200/0201). NULL = no answer yet; {} = TMDb lists none. Browse treats it as the primary country, falling back to production_countries[1] when NULL or empty.';
COMMENT ON COLUMN movies.origin_countries_fetched_at IS
  'When TMDb was last asked for origin_countries (0200/0201). NULL = never asked. Set with origin_countries NULL = asked and got no usable answer (no match, a failed request, or only unrecognised codes); asked again after a few days.';
COMMENT ON COLUMN series.origin_countries_fetched_at IS
  'When TMDb was last asked for origin_countries (0200/0201). NULL = never asked. Set with origin_countries NULL = asked and got no usable answer (no match, a failed request, or only unrecognised codes); asked again after a few days.';
