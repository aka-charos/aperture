-- Migration: 0177_job_max_items_per_run
-- Description: A per-job cap on how many items one run may work through.
--
-- `generate-title-analysis` was manual-only with its cap fixed in code
-- (DEFAULT_MAX_TITLES_PER_RUN, 200). It can be scheduled now, and a schedule is
-- only useful if an operator can size each run to the gap before the next one:
-- a title costs a search, several page fetches and a model call, so 200 titles
-- is an overnight pass on local hardware and an hourly schedule wants far fewer.
--
-- WHY A job_config COLUMN RATHER THAN A system_settings KEY. The cap is a
-- property of a run, and it is edited in the same dialog as the cadence it has
-- to fit inside. It applies to manual runs as well as scheduled ones.
--
-- NULL means "the job's own default", which the job definition declares
-- (`JobDefinition.runLimit` in apps/api). Only jobs that declare one read this
-- column; the route refuses a value for any other job, so a stored number can
-- never sit on a job that ignores it. Zero and negatives are refused here too:
-- a run of nothing is what "manual only" is for.

ALTER TABLE job_config ADD COLUMN IF NOT EXISTS max_items_per_run INTEGER;

ALTER TABLE job_config
  DROP CONSTRAINT IF EXISTS job_config_max_items_per_run_check;
ALTER TABLE job_config
  ADD CONSTRAINT job_config_max_items_per_run_check
  CHECK (max_items_per_run IS NULL OR max_items_per_run > 0);

COMMENT ON COLUMN job_config.max_items_per_run IS
  'Items one run may attempt, for jobs that declare a run limit; NULL = the job''s default';
