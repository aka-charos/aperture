-- A bench run can put several prompt versions beside each other.
--
-- 0169 stored one prompt per run and every result answered it. The bench now
-- builds one prompt per selected version from the SAME retrieval, and every
-- selected model answers each, so the version belongs to the result and the
-- run holds one prompt per version.
--
-- Both columns are nullable and absent on older rows, where absence keeps the
-- old meaning: a result with no prompt_version answered its run's
-- prompt_version, and a run with no prompts JSONB has its single prompt in
-- `prompt`. `prompt` is still written - it holds the newest version's prompt -
-- because replay reads the documents back out of it (0171).

ALTER TABLE analysis_comparison_results
  ADD COLUMN IF NOT EXISTS prompt_version INTEGER;

-- { "8": "<prompt>", "9": "<prompt>" } — identical up to the TASK line.
ALTER TABLE analysis_comparison_runs
  ADD COLUMN IF NOT EXISTS prompts JSONB;
