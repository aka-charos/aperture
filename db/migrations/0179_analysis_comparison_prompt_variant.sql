-- Which prompt variant answered, for bench rows that ran one.
--
-- A variant is an alternative set of questions and rules for a version, for a
-- model that cannot hold that version's own (packages/core/src/analysis/
-- promptVariants.ts). It carries its base version rather than a number of its
-- own, so prompt_version alone cannot say which of the two a row answered --
-- and a stored run is read back long after the operator remembers what they
-- ticked.
--
-- NULL means the version's own prompt, which is every row written before this.
ALTER TABLE analysis_comparison_results
  ADD COLUMN IF NOT EXISTS prompt_variant TEXT;
