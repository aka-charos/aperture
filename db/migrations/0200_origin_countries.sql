-- Migration: 0200_origin_countries
-- Description: TMDb's country of origin for movies and series.
--
-- `production_countries` lists every co-producer, in whatever order the media
-- server's metadata gave it. The Browse country filter reads its FIRST entry as
-- the country a title belongs to, and measured on a live library that order is
-- meaningful for most titles and alphabetical for roughly one multi-country
-- title in four or five: the share of rows already in A-Z order sat at 63% for
-- two countries (chance 50%), 36% for three (17%), 26% for four (4%), 20% for
-- five (1%), a near-constant ~20-25% excess, which is what a sorted minority
-- produces. For those rows "first" is merely the alphabetically earliest, so a
-- Greek-Cypriot co-production filed as Cypriot.
--
-- TMDb answers the actual question in its own field, `origin_country`, on both
-- `/movie/{id}` and `/tv/{id}` — a response enrichment already fetches and
-- discarded this from. Stored as canonical country NAMES (core
-- countries/canonical.ts), the vocabulary production_countries uses, so the two
-- compare directly.
--
-- Its own column because the library sync rewrites production_countries on
-- every pass from the media server; anything written there would be gone
-- within hours.
--
-- NULL origin_countries = not fetched yet (or the details did not load), and
-- the filter falls back to the first production country. '{}' = TMDb answered
-- and names no origin, which falls back the same way but is not asked again.
-- Not backfilled here: enrich-metadata fills the backlog, TMDb only.

ALTER TABLE movies ADD COLUMN IF NOT EXISTS origin_countries TEXT[];
ALTER TABLE movies ADD COLUMN IF NOT EXISTS origin_countries_fetched_at TIMESTAMPTZ;
ALTER TABLE series ADD COLUMN IF NOT EXISTS origin_countries TEXT[];
ALTER TABLE series ADD COLUMN IF NOT EXISTS origin_countries_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN movies.origin_countries IS
  'TMDb origin_country as canonical names (0200). NULL = not fetched; {} = TMDb names none. Browse treats it as the primary country, falling back to production_countries[1].';
COMMENT ON COLUMN movies.origin_countries_fetched_at IS
  'When TMDb answered for origin_countries (0200). NULL = still pending for the enrich-metadata backfill.';
COMMENT ON COLUMN series.origin_countries IS
  'TMDb origin_country as canonical names (0200). NULL = not fetched; {} = TMDb names none. Browse treats it as the primary country, falling back to production_countries[1].';
COMMENT ON COLUMN series.origin_countries_fetched_at IS
  'When TMDb answered for origin_countries (0200). NULL = still pending for the enrich-metadata backfill.';
