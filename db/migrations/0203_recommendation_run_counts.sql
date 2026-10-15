-- Migration: 0203_recommendation_run_counts
-- Description: Record on each recommendation run how many input and output rows
-- it saw, so the activity gate can see a DELETION.
--
-- Every other gate signal is the newest timestamp in a table, and a deleted
-- row leaves none. That was invisible while the watch-history sync restamped
-- every row on every pass (the gate then regenerated everyone); once the sync
-- stopped rewriting unchanged rows, removals needed their own signal. Counting
-- covers every way a row can go, ON DELETE CASCADE from a title removed from
-- the library included, without each delete site having to remember.
--
-- input_counts is written in the statement that creates the run (the moment
-- created_at is fixed); output_counts (the run's picks and their evidence) when
-- the run is finalized. NULL means the run predates this column, which the
-- gate reads as "cannot compare" and so regenerates: one extra run per viewer
-- after the deploy. Shapes are built by recommender/gateCounts.ts.

ALTER TABLE recommendation_runs
  ADD COLUMN IF NOT EXISTS input_counts JSONB,
  ADD COLUMN IF NOT EXISTS output_counts JSONB;

COMMENT ON COLUMN recommendation_runs.input_counts IS 'Row counts of the viewer''s recommendation inputs when the run was created (gateCounts.ts). NULL on runs before 0203.';
COMMENT ON COLUMN recommendation_runs.output_counts IS 'Picks and evidence rows the run stored, counted at finalize (gateCounts.ts). NULL on runs before 0203.';
