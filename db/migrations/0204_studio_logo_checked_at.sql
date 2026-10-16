-- Migration: 0204_studio_logo_checked_at
-- Description: Record when the studio logo job last looked a studio/network up
-- on TMDb, so a row TMDb has no logo for is not asked again on every run.
--
-- Before this the job selected every row with no logo, which meant re-asking
-- TMDb about thousands of companies it had already answered "no logo" for, on
-- every run. updated_at cannot stand in: populateStudiosFromMedia upserts every
-- row at the start of each run and the trigger restamps it.
--
-- NULL means "never checked by the current lookup rules", and those rows are
-- checked whether or not they hold a logo: the earlier lookup accepted the
-- first company search result when no name matched exactly, and searched
-- networks as companies, so a stored logo from before this column may belong to
-- a different company or network. Each row is looked at once more, and every
-- answer after that is stamped here.

ALTER TABLE studios_networks
  ADD COLUMN IF NOT EXISTS logo_checked_at TIMESTAMPTZ;
