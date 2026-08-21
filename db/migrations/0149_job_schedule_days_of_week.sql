-- Weekly schedules on more than one day.
--
-- `schedule_day_of_week` holds a single integer, so a job could run every
-- Sunday or every Thursday but never both -- while the cron field it feeds
-- accepts a list (`0,3`) and has all along. This adds the set.
--
-- WHY A NEW COLUMN RATHER THAN REUSING THE SCALAR. A bitmask in the existing
-- integer would need no migration and would be unreadable in psql, which is
-- where scheduling questions actually get answered. An array says what it
-- means.
--
-- THE SCALAR IS KEPT AND STILL WRITTEN, set to the earliest selected day. It is
-- not a second source of truth -- every reader goes through
-- `resolveScheduleDays`, which prefers the array -- but an image rolled back to
-- a build that predates this column then finds a sane single day instead of a
-- NULL that silently means Sunday.
--
-- BIWEEKLY IS DELIBERATELY EXCLUDED at the write layer, not here. Cron cannot
-- express "every other week", so a biweekly job carries the weekly expression
-- and `isScheduledRunDue` drops any firing whose last completed run is under
-- BIWEEKLY_MIN_DAYS (13) old. Two firings in one week are 3-4 days apart, so
-- the second is always dropped: picking Monday and Thursday would quietly mean
-- "every other Monday". `normalizeScheduleDays` truncates a biweekly selection
-- to one day rather than letting the setting lie.

ALTER TABLE job_config ADD COLUMN IF NOT EXISTS schedule_days_of_week INTEGER[];

-- `<@` is "contained by", so this rejects any element outside 0-6 without
-- naming them twice. An empty array is rejected too: absent is NULL, and
-- allowing both would give the fallback two different "nothing selected"
-- states to tell apart.
ALTER TABLE job_config
  DROP CONSTRAINT IF EXISTS job_config_days_of_week_check;
ALTER TABLE job_config
  ADD CONSTRAINT job_config_days_of_week_check
  CHECK (
    schedule_days_of_week IS NULL
    OR (
      array_length(schedule_days_of_week, 1) BETWEEN 1 AND 7
      AND schedule_days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
    )
  );

-- Backfill from the scalar so an existing weekly job reads identically through
-- the new column, and psql shows one answer rather than two.
UPDATE job_config
   SET schedule_days_of_week = ARRAY[schedule_day_of_week]
 WHERE schedule_day_of_week IS NOT NULL
   AND schedule_days_of_week IS NULL;
