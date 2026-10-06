-- What the optional decision-model source filter took out of a bench run's
-- retrieval, so the report can say so.
--
-- ITS OWN COLUMN RATHER THAN A FLAG ON EACH `sources` ENTRY, because the
-- documents it dropped are precisely the ones NOT in `sources` — they never
-- reach the prompt, and a list of what survived cannot carry them.
--
-- NULL IS THE NORMAL STATE AND IT MEANS "NOT ASKED": the switch is off, the
-- run predates this, or there were too few documents for the floor to allow a
-- drop. It is deliberately distinguishable from an empty `dropped` list, which
-- means the model read every document and ruled none of them out — the second
-- is evidence about the pages and the first is not. Nothing is backfilled for
-- the same reason.
ALTER TABLE analysis_comparison_runs
  ADD COLUMN IF NOT EXISTS judged_sources JSONB;

COMMENT ON COLUMN analysis_comparison_runs.judged_sources IS
  'Decision-model source filter outcome: { dropped: [{domain,title,score,chars}], floored }. NULL means it was not asked.';
