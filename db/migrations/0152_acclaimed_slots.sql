-- Reserved slots for widely-acclaimed titles.
--
-- Measured on a live instance: The Shawshank Redemption (9.3) scored 0.640
-- similarity against All Quiet on the Western Front (7.8) at 0.895. The rating
-- term correctly favoured Shawshank, 0.930 to 0.760, and still lost -- at the
-- default blend similarity outvotes rating about 5:1. Solving for the weight
-- that would flip it gives w_rating > 0.60, i.e. rating would have to be more
-- than half the entire blend, applied to every pick, to rescue a handful.
--
-- So acclaim gets bounded reserved slots instead, like interests and twins, and
-- the scoring blend is left alone.
--
-- Default 0 slots: the feature ships OFF. An upgrade must not silently change
-- what anyone is recommended.
--
-- The vote floor is a GATE, never a score term. Across a 12,589-film library,
-- titles under 500 votes average 5.95 against a library mean of 6.52 -- so
-- shrinking ratings toward the mean by vote count would PROMOTE 2,294 obscure
-- poorly-rated films. The same number works perfectly as an eligibility test,
-- which is what keeps a 9.3 built on 13,250 votes out of a slot meant for one
-- built on 2.9 million. Same lesson as idf in twinAffinity.ts: a measure can be
-- sound as a gate and worthless as a score.

ALTER TABLE recommendation_config
  ADD COLUMN IF NOT EXISTS movie_acclaimed_max_slots  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS movie_acclaimed_min_rating NUMERIC(3,1) NOT NULL DEFAULT 8.3,
  ADD COLUMN IF NOT EXISTS movie_acclaimed_min_votes  INTEGER NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS series_acclaimed_max_slots  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS series_acclaimed_min_rating NUMERIC(3,1) NOT NULL DEFAULT 8.3,
  ADD COLUMN IF NOT EXISTS series_acclaimed_min_votes  INTEGER NOT NULL DEFAULT 50000;

COMMENT ON COLUMN recommendation_config.movie_acclaimed_max_slots IS
  'Picks reserved for acclaimed films; 0 disables. Spends from selected_count alongside twin and interest slots.';
COMMENT ON COLUMN recommendation_config.movie_acclaimed_min_votes IS
  'Votes a rating must be built on to qualify. An eligibility gate only -- vote count must never enter the quality score.';
