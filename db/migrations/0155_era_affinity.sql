-- Decade preference as an explicit, bounded ranking signal.
--
-- Release year used to live inside the embedded text ("The Matrix (1999)"),
-- which made era a semantic property of every title. Removing it (text_version
-- 3) fixed a measured amplification -- one viewer's picks went from 80% 2020s
-- against a 40.4% history down to 32% -- but it left era with no representation
-- anywhere. That is not the same as leaving it alone: the signal stayed
-- emergent, and it swung +40pp to -8pp as a side effect of a change that was
-- not about era at all.
--
-- This is the replacement, and it is deliberately NOT semantic. It reads
-- movies.year / series.year, compares what a viewer watched against what the
-- library offered them, and feeds applyPreferenceAdjustment as a fourth
-- dimension beside franchise, genre and stated interests. No canonical text
-- changes, no vector moves, no re-embed.
--
-- Measured across nine viewers on a 12,589-film library, the shapes genuinely
-- differ, which is why this is a per-decade preference rather than a recency
-- curve:
--
--   afro  (337 films)  1960s 0.21 ... 2020s 2.30   recency ramp
--   k1a  (1563 films)  2000s 1.46, 2020s 0.89      peaks mid-era
--   ecl   (384 films)  1970s 1.42, 2010s 0.61      peaks in the 1970s
--
-- k1a has five times the median history on that instance and sits BELOW neutral
-- on the 2020s. A recency model would have pushed recent films at exactly the
-- viewers who avoid them.
--
-- Default 0: the feature ships OFF. Because the nudge normalises by the total
-- of the weights it is handed, a zero here restores the other three dimensions
-- to their exact pre-era shares of 1.3 -- so this is a true off switch, not an
-- attenuator, and deploying it changes nobody's recommendations until an admin
-- raises it. 0.5 puts era on a par with franchise and genre.
--
-- Deliberately NOT read by discover/scorer.ts. An era affinity is built from
-- what a viewer watched against what they were offered, and neither half of
-- that comparison exists for a title the library does not hold.

ALTER TABLE recommendation_config
  ADD COLUMN IF NOT EXISTS movie_era_weight  NUMERIC(3,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS series_era_weight NUMERIC(3,2) NOT NULL DEFAULT 0.00;

COMMENT ON COLUMN recommendation_config.movie_era_weight IS
  'Strength of the decade-preference dimension in the preference nudge, against franchise 0.5 / genre 0.5 / interest 0.3. 0 disables it and restores the other three to their exact pre-era shares.';
COMMENT ON COLUMN recommendation_config.series_era_weight IS
  'Strength of the decade-preference dimension in the preference nudge, against franchise 0.5 / genre 0.5 / interest 0.3. 0 disables it and restores the other three to their exact pre-era shares.';
