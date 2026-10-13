-- Migration: 0201_origin_countries_repair
-- Description: Repair origin_countries written by 0200's first writer, and
-- record that a stamp with no origin means "asked, TMDb gave nothing".
--
-- The first writer passed codes the country canonicaliser does not resolve
-- straight through, so TMDb's codes for states that no longer exist were
-- stored raw: 'SU' instead of 'Soviet Union', likewise XC, YU, XG, CS, and NA
-- (which the canonicaliser refuses because in free text it usually means "not
-- available"). A raw code matches no country the Browse picker offers, and
-- since a non-empty origin overrides the first production country, a Soviet
-- film stopped matching "Soviet Union" at all.
--
-- The writer now maps those codes and drops anything still unresolved
-- (core tmdb/originCountries.ts). This brings stored rows to the same state:
-- map the known codes, then remove any remaining bare two-letter code (no
-- canonical name is two letters), keeping order. A row left empty becomes
-- '{}', which falls back to the first production country.
--
-- Runs only over rows that hold a bare code, so it is a no-op where the
-- backfill had not run yet.

UPDATE movies m
SET origin_countries = COALESCE((
  SELECT array_agg(d.name ORDER BY d.ord)
  FROM (
    SELECT DISTINCT ON (mapped.name) mapped.name, mapped.ord
    FROM (
      SELECT CASE u.code
               WHEN 'SU' THEN 'Soviet Union'
               WHEN 'XC' THEN 'Czechoslovakia'
               WHEN 'YU' THEN 'Yugoslavia'
               WHEN 'XG' THEN 'East Germany'
               WHEN 'CS' THEN 'Serbia and Montenegro'
               WHEN 'NA' THEN 'Namibia'
               WHEN 'BU' THEN 'Myanmar'
               ELSE u.code
             END AS name,
             u.ord
      FROM unnest(m.origin_countries) WITH ORDINALITY AS u(code, ord)
    ) mapped
    WHERE mapped.name !~ '^[A-Z]{2}$'
    ORDER BY mapped.name, mapped.ord
  ) d
), '{}'::text[])
WHERE m.origin_countries IS NOT NULL
  AND EXISTS (SELECT 1 FROM unnest(m.origin_countries) AS x(code) WHERE x.code ~ '^[A-Z]{2}$');

UPDATE series s
SET origin_countries = COALESCE((
  SELECT array_agg(d.name ORDER BY d.ord)
  FROM (
    SELECT DISTINCT ON (mapped.name) mapped.name, mapped.ord
    FROM (
      SELECT CASE u.code
               WHEN 'SU' THEN 'Soviet Union'
               WHEN 'XC' THEN 'Czechoslovakia'
               WHEN 'YU' THEN 'Yugoslavia'
               WHEN 'XG' THEN 'East Germany'
               WHEN 'CS' THEN 'Serbia and Montenegro'
               WHEN 'NA' THEN 'Namibia'
               WHEN 'BU' THEN 'Myanmar'
               ELSE u.code
             END AS name,
             u.ord
      FROM unnest(s.origin_countries) WITH ORDINALITY AS u(code, ord)
    ) mapped
    WHERE mapped.name !~ '^[A-Z]{2}$'
    ORDER BY mapped.name, mapped.ord
  ) d
), '{}'::text[])
WHERE s.origin_countries IS NOT NULL
  AND EXISTS (SELECT 1 FROM unnest(s.origin_countries) AS x(code) WHERE x.code ~ '^[A-Z]{2}$');

COMMENT ON COLUMN movies.origin_countries_fetched_at IS
  'When TMDb was last asked for origin_countries (0200/0201). NULL = never asked. Set with origin_countries NULL = asked and TMDb gave no answer (no match, or the request failed); re-asked after a few days.';
COMMENT ON COLUMN series.origin_countries_fetched_at IS
  'When TMDb was last asked for origin_countries (0200/0201). NULL = never asked. Set with origin_countries NULL = asked and TMDb gave no answer (no match, or the request failed); re-asked after a few days.';
COMMENT ON COLUMN movies.origin_countries IS
  'TMDb origin_country as canonical names (0200/0201); unresolvable codes are dropped. NULL = no answer yet; {} = TMDb names none recognisable. Browse treats it as the primary country, falling back to production_countries[1] when NULL or empty.';
COMMENT ON COLUMN series.origin_countries IS
  'TMDb origin_country as canonical names (0200/0201); unresolvable codes are dropped. NULL = no answer yet; {} = TMDb names none recognisable. Browse treats it as the primary country, falling back to production_countries[1] when NULL or empty.';
