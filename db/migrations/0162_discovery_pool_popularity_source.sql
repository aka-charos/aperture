-- 0162: record WHICH source supplied a pool row's popularity figure.
--
-- `discovery_pool.popularity` does not hold one quantity. It holds TMDb's
-- unbounded popularity metric for the TMDb sources, a Trakt watcher count (an
-- integer in the tens or hundreds) for trakt_trending, and a hardcoded 0 --
-- NULLIF'd away on write -- for trakt_popular, whose payload carries no
-- popularity at all.
--
-- `popularityScoresBySource` normalises the field within the group named by the
-- candidate's `source`, which for a pool row is `sources[1]`. That array is
-- maintained by
--
--     sources = ARRAY(SELECT DISTINCT unnest(sources || EXCLUDED.sources))
--
-- and SELECT DISTINCT with no ORDER BY guarantees nothing about order, while
-- `popularity` is separately COALESCE'd from whichever source last supplied a
-- non-null value. So the UNIT and the LABEL are maintained independently and
-- can disagree.
--
-- Measured on a live instance, and the same source set appears in both orders,
-- which is the non-determinism showing up directly in the data:
--
--   sources                        rows   popularity
--   {tmdb_discover}                 222   28.01 - 901.11
--   {tmdb_discover,trakt_trending}   38   28.71 - 104.79
--   {trakt_trending,tmdb_discover}   15   28.88 -  33.01
--   {tmdb_discover,trakt_popular}     3   28.02 -  54.76
--   {trakt_popular,tmdb_discover}     1   53.60
--
-- Every one of those figures is on TMDb's decimal scale -- TMDb Discover is
-- first in fetchGlobalCandidates' concatenation and the dedupe keeps the first
-- occurrence, so a title both sources return enters as the TMDb candidate. But
-- 16 of 279 movies list a Trakt source first, so the scorer files a TMDb-scaled
-- number in a group of 15 spanning 4.13 points and min-max stretches it across
-- the full 0-1: a title at popularity 33.01 scores 1.00 there against 0.006 in
-- the 873-point tmdb_discover group it belongs to. Popularity carries 27% of
-- the blend, so that is most of a term, handed out by an arbitrary array order.
--
-- The fix is to record the provenance of the NUMBER rather than of the row.
-- Ordering the DISTINCT would only make the wrong answer deterministic.

ALTER TABLE discovery_pool
  ADD COLUMN IF NOT EXISTS popularity_source TEXT;

COMMENT ON COLUMN discovery_pool.popularity_source IS
  'Which source supplied the value in `popularity`, and therefore what unit it is in. Written in the same statement as `popularity` so the two cannot drift. NULL means unknown, which the scorer groups separately rather than guessing.';

-- Backfill is provable rather than inferred: every row currently in the pool
-- lists tmdb_discover among its sources (there is not one Trakt-only row), and
-- TMDb Discover is the only global source that supplies a non-null popularity
-- at all -- trakt_popular sends 0, which NULLIF turns into NULL. So a row with
-- a popularity and a tmdb_discover source got that number from TMDb.
--
-- Anything else keeps NULL. There are no such rows today; if one appears, the
-- scorer treats an unknown unit as its own group rather than assuming.
UPDATE discovery_pool
   SET popularity_source = 'tmdb_discover'
 WHERE popularity IS NOT NULL
   AND 'tmdb_discover' = ANY(sources)
   AND popularity_source IS NULL;

DO $$ BEGIN RAISE NOTICE '[0162] Done.'; END $$;
