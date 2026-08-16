-- Migration: 0141_candidate_score_provenance
-- Description: Record the two score values the insights panel needs to actually
--              explain a match, both of which were computed and thrown away.
--
-- `similarity_score` holds the RAW cosine to the taste centroid. The blend does
-- not read it: calculateBaseScore consumes normalizeSimilarity(), the raw value
-- rescaled against the run's own candidate pool, because raw cosine inside one
-- library occupies a cone about 0.04 wide between p10 and p90 and is therefore
-- not comparable with novelty or rating. That normalized value was never
-- persisted, so the panel headed "How We Calculated Your Match" showed a
-- similarity bar that is not an input to the number above it -- on a live
-- instance, 78 / 72 / 85 under a headline of 90, which no weighted average of
-- those three can produce.
--
-- `base_score` is the blend BEFORE applyPreferenceAdjustment. Franchise, genre
-- and interest affinities then nudge the result by up to half the remaining
-- headroom, so without it the three components cannot reconstruct final_score
-- even once similarity is on the right scale.
--
-- Both nullable and deliberately not backfilled: neither value is recoverable
-- from what was stored. normalizeSimilarity needs the pool's mean and standard
-- deviation, which a thinned run no longer has, and the preference adjustment
-- is not invertible. Rows from earlier runs read NULL and the panel falls back
-- to its previous behaviour for them; the next run fills both.

ALTER TABLE recommendation_candidates
  ADD COLUMN IF NOT EXISTS normalized_similarity NUMERIC(6, 4),
  ADD COLUMN IF NOT EXISTS base_score NUMERIC(6, 4);

COMMENT ON COLUMN recommendation_candidates.similarity_score IS
  'Raw cosine similarity to the taste centroid, as retrieved. Comparable between items, NOT comparable with the other score columns.';

COMMENT ON COLUMN recommendation_candidates.normalized_similarity IS
  'similarity_score rescaled against this run''s candidate pool. This is what the score blend consumed.';

COMMENT ON COLUMN recommendation_candidates.base_score IS
  'Weighted blend of normalized_similarity, novelty_score and rating_score, before franchise/genre/interest preference adjustment. final_score minus this is the preference nudge.';
