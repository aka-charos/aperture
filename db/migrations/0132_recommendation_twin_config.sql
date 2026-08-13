-- Taste-twin recommendations: borrow a small number of picks from the watch
-- history of another viewer whose taste demonstrably overlaps.
--
-- The twin relation is behavioural, not semantic. Measured on this instance,
-- user taste-profile embeddings sit between 0.898 and 0.993 cosine of one
-- another -- a range too narrow to separate a real match from a stranger,
-- because a profile centroid is the mean of up to 150 item vectors that already
-- occupy a narrow cone (see taste-profile/clustering.ts). Rarity-weighted
-- overlap of watch histories has no such problem: a title everyone has seen
-- carries idf 0 and contributes nothing, while a title two people share carries
-- the maximum, so the measure is dominated by exactly the niche agreement that
-- makes a twin worth having.
--
-- Both settings change *what* gets recommended, so both belong in
-- SCORING_FIELDS (lib/recommendationConfig.ts) -- otherwise editing them would
-- not bump scoring_updated_at, the activity gate would conclude nothing had
-- changed, and the new value would sit unused until max_run_age_days fired.

ALTER TABLE recommendation_config
  ADD COLUMN IF NOT EXISTS movie_twin_threshold_k NUMERIC(3,1) NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS series_twin_threshold_k NUMERIC(3,1) NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS movie_twin_max_slots INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS series_twin_max_slots INTEGER NOT NULL DEFAULT 4;

ALTER TABLE recommendation_config
  DROP CONSTRAINT IF EXISTS recommendation_config_twin_check;

ALTER TABLE recommendation_config
  ADD CONSTRAINT recommendation_config_twin_check
  CHECK (
    movie_twin_threshold_k >= 1.0 AND movie_twin_threshold_k <= 4.0 AND
    series_twin_threshold_k >= 1.0 AND series_twin_threshold_k <= 4.0 AND
    movie_twin_max_slots >= 0 AND movie_twin_max_slots <= 10 AND
    series_twin_max_slots >= 0 AND series_twin_max_slots <= 10
  );

-- k multiplies the median absolute deviation of the pairwise affinity
-- distribution, so the bar is re-derived from the population on every run
-- rather than being a constant. That is load-bearing: as viewers are enabled
-- the user count grows, every idf shifts, and a stored threshold would quietly
-- start firing at the wrong point.
COMMENT ON COLUMN recommendation_config.movie_twin_threshold_k IS
  'How closely another viewer must match before their movie picks are borrowed, as a multiple of the median absolute deviation. Higher is stricter';
COMMENT ON COLUMN recommendation_config.series_twin_threshold_k IS
  'How closely another viewer must match before their series picks are borrowed, as a multiple of the median absolute deviation. Higher is stricter';

-- Reserved slots come *out of* selected_count rather than extending it, so each
-- one is a normally-ranked recommendation given up. 0 disables the feature
-- outright, which is why there is no separate on/off flag.
COMMENT ON COLUMN recommendation_config.movie_twin_max_slots IS
  'Ceiling on movie recommendations drawn from a taste twin (0 disables). The actual count also scales with selected_count';
COMMENT ON COLUMN recommendation_config.series_twin_max_slots IS
  'Ceiling on series recommendations drawn from a taste twin (0 disables). The actual count also scales with selected_count';

-- === Recommendations per user: default 12 -> 20 ===
-- Only affects instances created from here on. The row seeded by migration 0018
-- already holds a value, and deliberately keeps it: how many recommendations
-- existing viewers receive is an admin decision made visibly in Settings, not
-- one a schema migration should make on their behalf.
ALTER TABLE recommendation_config
  ALTER COLUMN movie_selected_count SET DEFAULT 20,
  ALTER COLUMN series_selected_count SET DEFAULT 20;

COMMENT ON COLUMN recommendation_config.movie_selected_count IS
  'Number of movie recommendations per user (default: 20)';
COMMENT ON COLUMN recommendation_config.series_selected_count IS
  'Number of series recommendations per user (default: 20)';
