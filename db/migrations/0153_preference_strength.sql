-- Make the preference nudge visible and tunable.
--
-- applyPreferenceAdjustment moves a candidate's final score toward 1.0 (or down
-- toward 0) in proportion to how much the viewer likes its franchise, genre and
-- stated interests. The share of the REMAINING gap it may close was a hardcoded
-- MAX_PREFERENCE_HEADROOM = 0.5 -- half the distance to a perfect match, which
-- is easily enough to reorder a list.
--
-- It was also the only input to the final score an admin could neither see nor
-- change. Since migration 0141 the insights panel shows the resulting jump
-- ("blended -> preferences -> match"), so the effect became visible per title
-- while its cause stayed invisible everywhere.
--
-- 0.50 preserves current behaviour exactly. 0 switches the nudge off and leaves
-- the blend as calculateBaseScore produced it.
--
-- Deliberately NOT read by discover/scorer.ts: discovery has its own config, and
-- an admin tuning recommendations must not silently change what gets requested
-- from Seerr.

ALTER TABLE recommendation_config
  ADD COLUMN IF NOT EXISTS movie_preference_strength  NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS series_preference_strength NUMERIC(3,2) NOT NULL DEFAULT 0.50;

COMMENT ON COLUMN recommendation_config.movie_preference_strength IS
  'Share of a candidate''s remaining gap to 1.0 that a maxed franchise/genre/interest signal may close. 0 disables the nudge.';
COMMENT ON COLUMN recommendation_config.series_preference_strength IS
  'Share of a candidate''s remaining gap to 1.0 that a maxed franchise/genre/interest signal may close. 0 disables the nudge.';
