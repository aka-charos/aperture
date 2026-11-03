-- Migration: 0216_candidate_scored_rating
-- Description: Record the rating each candidate's Quality score was computed from.
--
-- A run stored rating_score and not the rating behind it, while the insights
-- panel draws that score under a headline showing the title's rating NOW. When
-- the rating moved after the run the two disagreed, and the panel could only
-- guess the old rating by running the score curve backwards -- which names the
-- wrong number the moment the curve is retuned, since nothing records which
-- curve a run used. This column is the rating the scorer actually read
-- (scoringRating: the stored unified rating, or the media server's while a
-- title is not computed).
--
-- NULL for a title that had no rating at all (it scored the neutral default)
-- and for every row written before this migration. Deliberately not
-- backfilled: the rating a past run read is not recoverable from what was
-- stored. Readers fall back to reading the score back through the current curve
-- (apps/api lib/qualityRating.ts) for rows without it.
--
-- Unconstrained NUMERIC on purpose: the scorer reads whatever the rating
-- columns hold, and a bad value there (a 101 from the media server, which the
-- score curve clamps) must not overflow a NUMERIC(4, 2) and fail the whole
-- run's insert.

ALTER TABLE recommendation_candidates
  ADD COLUMN IF NOT EXISTS scored_rating NUMERIC;

COMMENT ON COLUMN recommendation_candidates.scored_rating IS
  'The rating (0-10) the Quality score in rating_score was computed from. NULL when the title had no rating, or the row predates 0216.';
