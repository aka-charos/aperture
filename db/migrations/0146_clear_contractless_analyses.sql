-- Clear analyses stored without the prompt's closing SOURCES line.
--
-- Those rows were written under a reading that treated a missing contract line
-- as a null grade and stored the response anyway. What that admitted, measured
-- on the first real pass: the writing model was a reasoning model that emits
-- its scratchpad as ordinary text, so all three stored "analyses" were the
-- model narrating the task to itself -- "Here's a thinking process: 1. Analyze
-- User Input..." -- truncated mid-sentence at the output ceiling, with the
-- analysis itself never written. The detail page rendered that under "About
-- this Film". Their sizes give the game away: 8,852 / 8,149 / 8,318 characters,
-- all pinned just under a 2,000-token cap, a uniformity no real answer has
-- since the prompt asks for length to follow the work.
--
-- THE PREDICATE IS EXACT RATHER THAN CAUTIOUS. A response that followed the
-- prompt ends with `SOURCES: substantial | reviews-only | almost-nothing`, and
-- `parseAnalysisResponse` stores that as `source_grade`. So a row with prose but
-- no grade is precisely a row kept without the one cheap proof that the thing
-- we stored is the thing we asked for, and no correctly-formed answer can match.
-- After the guard in `analysis/response.ts` no such row can be written again:
-- a missing contract line now throws, leaving the title pending for a rerun.
--
-- Declines are deliberately untouched (`analysis IS NOT NULL`). A declined row
-- legitimately has no grade -- the floor rejected it before any of this -- and
-- clearing it would re-spend retrieval and inference to reach the same verdict.
--
-- Deleting rather than nulling: no row at all is this schema's "never asked",
-- which is what puts the title back in the pending selection.
DELETE FROM title_analysis
 WHERE analysis IS NOT NULL
   AND source_grade IS NULL;
