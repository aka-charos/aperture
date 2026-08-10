-- Make the recommendation activity gate configurable, and teach the scheduler
-- about a two-week cadence.
--
-- The gate (recommender/activityGate.ts) shipped with hardcoded constants: 25
-- new titles before the catalogue counts as changed, and a 30-day maximum run
-- age. Both are policy, not physics — a small library wants a lower threshold
-- than a large one — so they move into recommendation_config alongside the
-- rest of the recommender's tuning, per media type.

-- === Gate thresholds ===
-- Series default lower than movies: shows arrive far less often, so waiting for
-- the same batch size would mean the catalogue signal effectively never fires.
ALTER TABLE recommendation_config
  ADD COLUMN IF NOT EXISTS movie_new_candidate_threshold INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS series_new_candidate_threshold INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS movie_max_run_age_days INTEGER NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS series_max_run_age_days INTEGER NOT NULL DEFAULT 35;

ALTER TABLE recommendation_config
  DROP CONSTRAINT IF EXISTS recommendation_config_gate_check;

ALTER TABLE recommendation_config
  ADD CONSTRAINT recommendation_config_gate_check
  CHECK (
    movie_new_candidate_threshold >= 1 AND
    series_new_candidate_threshold >= 1 AND
    movie_max_run_age_days >= 1 AND
    series_max_run_age_days >= 1
  );

COMMENT ON COLUMN recommendation_config.movie_new_candidate_threshold IS
  'Newly-available movies required before the catalogue counts as changed for the activity gate';
COMMENT ON COLUMN recommendation_config.series_new_candidate_threshold IS
  'Newly-available series required before the catalogue counts as changed for the activity gate';
COMMENT ON COLUMN recommendation_config.movie_max_run_age_days IS
  'Regenerate movie recommendations regardless once the last run is this old';
COMMENT ON COLUMN recommendation_config.series_max_run_age_days IS
  'Regenerate series recommendations regardless once the last run is this old';

-- === Separate "scoring changed" from "any row change" ===
-- The gate treats a change to this table as a reason to regenerate everyone,
-- and an updated_at trigger fires on every UPDATE. Without a second column,
-- editing the gate's own thresholds would force the exact full regeneration
-- the gate exists to avoid. scoring_updated_at is bumped only by the setters
-- that touch weights and pool sizes.
ALTER TABLE recommendation_config
  ADD COLUMN IF NOT EXISTS scoring_updated_at TIMESTAMPTZ;

-- The SET expression reads the pre-update row, so this carries the existing
-- timestamp across rather than resetting the clock (the trigger still moves
-- updated_at, which nothing compares against any more).
UPDATE recommendation_config
   SET scoring_updated_at = updated_at
 WHERE scoring_updated_at IS NULL;

ALTER TABLE recommendation_config
  ALTER COLUMN scoring_updated_at SET DEFAULT NOW();

ALTER TABLE recommendation_config
  ALTER COLUMN scoring_updated_at SET NOT NULL;

COMMENT ON COLUMN recommendation_config.scoring_updated_at IS
  'Last change to settings that affect what gets recommended; the activity gate compares against this, not updated_at';

-- === Biweekly schedules ===
-- Cron cannot express "every other week", so a biweekly job carries the same
-- weekly cron expression and the scheduler skips a firing when the job already
-- ran inside the window (see isBiweeklyRunDue in core jobs/jobConfig.ts).
ALTER TABLE job_config
  DROP CONSTRAINT IF EXISTS job_config_schedule_type_check;

ALTER TABLE job_config
  ADD CONSTRAINT job_config_schedule_type_check
  CHECK (schedule_type IN ('daily', 'weekly', 'biweekly', 'interval', 'manual'));
