-- Track whether OMDb specifically has been asked about a row.
--
-- `enrichment_version` records which schema version was current when a row was
-- last touched — NOT which sources answered it. enrichMovie/enrichSeries stamp
-- it (and enriched_at) on every pass, whether OMDb ran, was disabled, was
-- skipped for a missing imdb_id, errored, or found nothing. The selection
-- query then excludes the row forever:
--
--   WHERE enriched_at IS NULL OR COALESCE(enrichment_version, 0) < $current
--
-- So a library enriched before OMDb was configured is permanently stamped
-- "fully enriched", and adding the key afterwards does nothing at all. Measured
-- on the instance where this was found: movies.languages populated for 88 of
-- 12,584 rows (0.7%), with rt_critic_score, metacritic_score and awards_summary
-- equally bare — while getEnrichmentVersionStatus reported zero items outdated,
-- because by its own definition they were.
--
-- omdb_enriched_at is stamped only when the OMDb call was actually ATTEMPTED
-- and did not throw. "Not found" counts as attempted: OMDb genuinely has no
-- entry for some titles, and retrying those every pass would never end. An
-- error does not count, so a transient outage retries on the next run.

ALTER TABLE movies ADD COLUMN IF NOT EXISTS omdb_enriched_at TIMESTAMPTZ;
ALTER TABLE series ADD COLUMN IF NOT EXISTS omdb_enriched_at TIMESTAMPTZ;

-- Backfill from evidence, so rows OMDb has already answered are not re-fetched.
--
-- awards_summary and languages are the only columns written exclusively by the
-- OMDb path. rt_critic_score and metacritic_score are NOT usable as evidence
-- because mdblist/enrichment.ts writes them too, and production_countries is
-- written by the media-server sync on every pass.
--
-- Deliberately conservative: a title OMDb answered with neither an award nor a
-- language is re-fetched, costing one redundant request. The opposite error
-- would re-freeze the gap this migration exists to open, so it is the wrong
-- direction to be clever in.
UPDATE movies
   SET omdb_enriched_at = enriched_at
 WHERE enriched_at IS NOT NULL
   AND omdb_enriched_at IS NULL
   AND (awards_summary IS NOT NULL OR COALESCE(array_length(languages, 1), 0) > 0);

UPDATE series
   SET omdb_enriched_at = enriched_at
 WHERE enriched_at IS NOT NULL
   AND omdb_enriched_at IS NULL
   AND (awards_summary IS NOT NULL OR COALESCE(array_length(languages, 1), 0) > 0);

-- No index on purpose. The pending predicate is an OR across three branches
-- (never enriched / outdated version / never asked OMDb), so a partial index on
-- one branch cannot drive the query, and at this table size the seq scan is a
-- few milliseconds inside a job that spends minutes on HTTP.

COMMENT ON COLUMN movies.omdb_enriched_at IS
  'When OMDb was last successfully ASKED about this row (not when it last returned data). NULL means never asked, which is what makes an OMDb backfill selectable; enrichment_version cannot express this because it records the schema, not the sources.';
COMMENT ON COLUMN series.omdb_enriched_at IS
  'When OMDb was last successfully ASKED about this row (not when it last returned data). NULL means never asked, which is what makes an OMDb backfill selectable; enrichment_version cannot express this because it records the schema, not the sources.';
