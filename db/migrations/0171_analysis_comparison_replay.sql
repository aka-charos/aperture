-- A bench run can replay another run's sources under the current prompt.
--
-- 0169's bench compares MODELS: it retrieves once and hands every model one
-- prompt. Comparing PROMPT VERSIONS needs the same control across two runs made
-- days apart, and a fresh retrieval would give the newer prompt different pages
-- - so a difference in the answers could come from the pages rather than the
-- prompt, the exact confound the bench was built to remove.
--
-- A replay therefore retrieves nothing. It reads the documents back out of the
-- stored prompt of the run it replays (see extractPromptSources), builds the
-- current prompt from them, and records which run it came from here so the
-- report can print both runs' answers side by side.
--
-- SET NULL rather than CASCADE: deleting the baseline must not delete a replay
-- that has already been paid for. The replay then reads as an ordinary run.

ALTER TABLE analysis_comparison_runs
  ADD COLUMN IF NOT EXISTS replay_of UUID
    REFERENCES analysis_comparison_runs(id) ON DELETE SET NULL;
