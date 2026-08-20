-- Migration: 0147_run_score_weights
-- Description: Record the three blend weights each recommendation run used, so
--              the insights panel can show the arithmetic instead of asserting
--              a total the reader cannot check.
--
-- The panel headed "How We Calculated Your Match" shows Taste Match, Discovery
-- and Quality, then a match percentage. Those four numbers only reconcile if
-- you know the weights, and nothing on the page stated them -- so a live card
-- reading 75 / 76 / 28 under a headline of 63 looked like arithmetic that had
-- gone wrong, when in fact 0.50/0.25/0.25 produces exactly that.
--
-- Read from the RUN rather than from current config, for two independent
-- reasons either of which alone would be sufficient:
--
--   1. Weights are resolved per user by loadConfigForUser, so two people's runs
--      on the same afternoon can blend differently. There is no single global
--      answer to "what weights applied here".
--   2. An admin can move a slider at any time. `scoring_updated_at` makes the
--      activity gate regenerate everyone eventually, but until each user's next
--      run their stored scores predate the change.
--
-- Showing today's config beside a stored score would repeat precisely the fault
-- migration 0141 fixed: a number rendered next to a score it did not produce.
--
-- Nullable and deliberately not backfilled -- the weights that applied to an
-- existing run were never recorded and are not recoverable from the stored
-- components (three unknowns, one equation). Rows from earlier runs read NULL
-- and the panel omits the weight line for them, exactly as it already omits the
-- preference chain when base_score is NULL. The next run fills them.
--
-- NUMERIC(3,2) matches the source columns on recommendation_config.

ALTER TABLE recommendation_runs
  ADD COLUMN IF NOT EXISTS similarity_weight NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS novelty_weight NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS rating_weight NUMERIC(3, 2);

COMMENT ON COLUMN recommendation_runs.similarity_weight IS
  'Similarity weight this run blended with, as resolved for this user. NULL for runs predating migration 0147.';

COMMENT ON COLUMN recommendation_runs.novelty_weight IS
  'Novelty weight this run blended with, as resolved for this user. NULL for runs predating migration 0147.';

COMMENT ON COLUMN recommendation_runs.rating_weight IS
  'Rating weight this run blended with, as resolved for this user. NULL for runs predating migration 0147. Note the three are NOT normalized here: calculateBaseScore divides by their sum, so the displayed share is weight/total.';
