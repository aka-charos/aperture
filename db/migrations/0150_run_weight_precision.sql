-- Widen the stored per-run blend weights so a CORRECTED weight is
-- representable.
--
-- 0147 typed these NUMERIC(3,2) to match their source columns on
-- recommendation_config, which is right for a value copied straight off a
-- slider. They are no longer copied: each configured weight is now multiplied
-- by a gain that corrects for how much of the 0-1 range its term actually uses
-- (see effectiveBlendWeights in recommender/shared/scoring.ts), and a rating
-- weight of 0.25 x 1.2391 is 0.3098, which 2 decimal places stores as 0.31.
--
-- That rounding is not cosmetic. The whole point of 0147 is that the insights
-- panel can multiply these back out against the component scores and land on
-- the match percentage it is printing underneath -- three weights each rounded
-- to 2dp make that arithmetic miss by up to half a percent, which is exactly
-- the "these numbers do not add up" complaint the migration was written to
-- answer.
--
-- The column's MEANING is unchanged: "the weight this run blended with". A run
-- made before the correction blended with the configured value and stored the
-- configured value; a run made after blends with the corrected value and
-- stores that. Both are true, and no backfill is possible or wanted -- the
-- gain depends on the novelty spread of a candidate pool that no longer
-- exists.
--
-- 99.9999 is far more headroom than needed (the largest reachable weight is a
-- configured 1.0 against the 1.5 novelty gain ceiling), but scale is what
-- matters here and precision is free.

ALTER TABLE recommendation_runs
  ALTER COLUMN similarity_weight TYPE NUMERIC(6, 4),
  ALTER COLUMN novelty_weight TYPE NUMERIC(6, 4),
  ALTER COLUMN rating_weight TYPE NUMERIC(6, 4);

COMMENT ON COLUMN recommendation_runs.similarity_weight IS
  'Similarity weight this run blended with, as resolved for this user. NULL for runs predating migration 0147. Since 0150 this is the EFFECTIVE weight -- the configured one after the spread correction in effectiveBlendWeights.';

COMMENT ON COLUMN recommendation_runs.novelty_weight IS
  'Novelty weight this run blended with, as resolved for this user. NULL for runs predating migration 0147. Since 0150 this is the EFFECTIVE weight, and it is the one that varies per run: the novelty gain is derived from the candidate pool''s own novelty spread.';

COMMENT ON COLUMN recommendation_runs.rating_weight IS
  'Rating weight this run blended with, as resolved for this user. NULL for runs predating migration 0147. Since 0150 this is the EFFECTIVE weight. Note the three are NOT normalized here: calculateBaseScore divides by their sum, so the displayed share is weight/total.';
