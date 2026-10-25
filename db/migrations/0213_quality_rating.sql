-- Migration: 0213_quality_rating
-- Description: Stores each title's unified quality rating and what it is made of
--              (F-167), so the recommender, the title page and any later
--              surface read one stored answer instead of each computing it.
--
-- The rule is packages/core/src/ratings/unifiedRating.ts: movies 0.6 refreshed
-- IMDb + 0.4 critics (Metacritic / Rotten Tomatoes, rank-mapped onto IMDb
-- against the titles carrying both), series IMDb alone. It needs percentiles
-- over the whole table, so it cannot be a generated column; core
-- ratings/qualityRatings.ts writes it, after every job that changes a rating
-- and before a recommendation run that finds a title without one.
--
-- Two columns because the page says what the number is made of, and the label
-- and the number must come from the same computation: a label worked out from
-- the live columns beside a number computed earlier named sources the number
-- did not contain.
--
-- NULL sources means NOT COMPUTED YET (a title synced since the last refresh,
-- or every title before the first one): readers fall back to community_rating,
-- the media server's own, which is what they read before this existed. An
-- empty array with a NULL rating means computed, and no source rates the title.
-- Writing these columns does not re-embed anything: embedding staleness reads
-- enriched_at, never updated_at.

ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS quality_rating NUMERIC(4, 2),
  ADD COLUMN IF NOT EXISTS quality_rating_sources TEXT[];

ALTER TABLE series
  ADD COLUMN IF NOT EXISTS quality_rating NUMERIC(4, 2),
  ADD COLUMN IF NOT EXISTS quality_rating_sources TEXT[];

COMMENT ON COLUMN movies.quality_rating IS
  'Unified quality rating (0-10) the recommender scores on (F-167). Read only beside quality_rating_sources: NULL sources = not computed, fall back to community_rating.';
COMMENT ON COLUMN movies.quality_rating_sources IS
  'What quality_rating is made of (imdb, mediaServer, tmdb, metacritic, rt). NULL = not computed yet; empty = no source rates the title.';
COMMENT ON COLUMN series.quality_rating IS
  'Unified quality rating (0-10) the recommender scores on (F-167). Read only beside quality_rating_sources: NULL sources = not computed, fall back to community_rating.';
COMMENT ON COLUMN series.quality_rating_sources IS
  'What quality_rating is made of (imdb, mediaServer, tmdb). NULL = not computed yet; empty = no source rates the title.';
