-- Migration: 0148_ratings_refresh
-- Description: Records when each title last had its IMDb rating checked against
--              IMDb's own published dataset, and registers the refresh job.
--
-- WHY THIS EXISTS. Enrichment was built for metadata, and metadata does not
-- move: a plot, a cast list, a country of production are written once and are
-- correct forever. Ratings are not like that, and putting both behind the same
-- predicate meant the field that never changes set the policy for the field
-- that changes weekly. `needsEnrichmentSql` selects a row that has never been
-- enriched, or whose schema version is behind -- there is no TTL anywhere -- so
-- a rating fetched once is frozen for the life of the install.
--
-- Measured on this instance, film "The Drama" (tt33071426), all on 2026-08-21:
--
--   stored imdb_vote_count (written 2026-08-16)     81,611   rating 7.2
--   OMDb, called live                               81,611   rating 7.2
--   NFO on disk                                    108,798   rating 7.1
--   IMDb's own dataset                             112,851   rating 7.1
--
-- OMDb had not moved in five days, and was 31,240 votes -- 28% of the current
-- total -- behind the source. That matters beyond tidiness because the error is
-- BIASED, not random: a new release's rating starts high on early-adopter
-- enthusiasm and decays as the vote base widens, which is exactly the 7.2 -> 7.1
-- above. A frozen copy therefore systematically overrates recent films, and the
-- rating score is a quarter of the recommendation blend at default weights.
--
-- Note also that everything downstream of OMDb inherits this. The rating-sync
-- Emby plugin reads OMDb and MDBList, so `movies.community_rating` -- which
-- looks like an independent second opinion, and is refreshed on every sync --
-- carries the same stale number by a longer road.
--
-- WHY A STAMP AT ALL, when one pass touches every row. Because a title with no
-- votes yet does not appear in title.ratings.tsv at all, so absence is a real
-- answer. Without a stamp there is no way to tell "we looked and IMDb has
-- nothing for this" from "the job has never run". Same reasoning as
-- `omdb_enriched_at`: what is recorded is that the source was ASKED.
--
-- It is therefore stamped on every row we searched for, not only on the rows we
-- found -- see refreshImdbRatings, which stamps the misses in a second pass.

ALTER TABLE movies ADD COLUMN IF NOT EXISTS imdb_ratings_refreshed_at TIMESTAMPTZ;
ALTER TABLE series ADD COLUMN IF NOT EXISTS imdb_ratings_refreshed_at TIMESTAMPTZ;

COMMENT ON COLUMN movies.imdb_ratings_refreshed_at IS
  'When IMDb''s published dataset was last consulted for this title. Set even when the title was absent from the file, because absence is an answer. NULL means the refresh job has never run over this row.';

COMMENT ON COLUMN series.imdb_ratings_refreshed_at IS
  'When IMDb''s published dataset was last consulted for this title. Set even when the title was absent from the file, because absence is an answer. NULL means the refresh job has never run over this row.';

CREATE INDEX IF NOT EXISTS idx_movies_imdb_id_present ON movies(imdb_id) WHERE imdb_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_series_imdb_id_present ON series(imdb_id) WHERE imdb_id IS NOT NULL;

-- Daily, and early enough to be in place before the recommendation run at 04:00
-- picks up the scores. Disabled by default is NOT expressed here: the job is
-- enabled but every SOURCE inside it is opt-in (system_settings
-- `ratings_refresh`), so a scheduled run with nothing switched on logs that it
-- has no work and exits. IMDb's dataset carries a personal/non-commercial
-- licence, and that is the operator's decision to make knowingly rather than to
-- discover.
INSERT INTO job_config (job_name, schedule_type, schedule_hour, schedule_minute, is_enabled)
VALUES ('refresh-ratings', 'daily', 2, 30, true)
ON CONFLICT (job_name) DO NOTHING;
