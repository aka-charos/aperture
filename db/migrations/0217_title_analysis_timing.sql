-- Migration: 0217_title_analysis_timing
-- Description: Record how long each title analysis took, one figure per phase.
--
-- Two columns because the phases answer different questions. Fetching says how
-- the retrieval service behaved; writing says how the model behaved, and is the
-- only one of the two that means anything when comparing models. A single total
-- could not do that, and it could not hold an offsite import at all, where the
-- two phases ran apart.
--
-- retrieval_ms: the search and page fetches before the model. NULL in grounding
-- mode (the model searches for itself, inside writing) and on offsite imports
-- (retrieval ran when the batch was built, and nothing timed it).
--
-- write_ms: the model answering, retries and fallback models included, pacing
-- waits excluded, since a wait measures the provider's rate limit rather than
-- the model. On an offsite import this is the runner's elapsed_ms.
--
-- NULL means not measured, never instant. Rows written before this stay NULL.
ALTER TABLE title_analysis
  ADD COLUMN IF NOT EXISTS retrieval_ms INTEGER,
  ADD COLUMN IF NOT EXISTS write_ms INTEGER;

COMMENT ON COLUMN title_analysis.retrieval_ms IS
  'Milliseconds fetching sources. NULL = not measured or no separate phase (older rows, grounding mode, offsite imports).';
COMMENT ON COLUMN title_analysis.write_ms IS
  'Milliseconds the model took, retries included, pacing waits excluded. NULL = not measured (older rows, offsite results without elapsed_ms).';
