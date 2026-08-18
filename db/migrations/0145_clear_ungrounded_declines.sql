-- Delete declines written by a grounded call that never retrieved anything.
--
-- `checkModeReadiness` refuses `grounding` on a non-Google provider, precisely
-- so a model that cannot search is never asked to write about a film from
-- memory. Nothing on the execution path called it — only the settings page, to
-- draw a badge — so the guard described the configuration without governing it.
--
-- What that produced, measured live: retrieval left on `grounding` while the
-- Title Analysis role pointed at an OpenRouter model. Every call logged
-- `webSearchQueries: 0, groundingChunks: 0`, the model wrote several thousand
-- characters out of its own memory, the source floor correctly judged that
-- unsupported and stored `thin_sources` — which retires the title until
-- ANALYSIS_PROMPT_VERSION moves. Roughly one title a minute, permanently, from
-- a search that never happened.
--
-- The rows are identifiable exactly: a grounding-mode row that kept no analysis
-- and counted no sources. `source_count` holds the grounding chunk count in
-- that mode, so 0 means the model was handed nothing.
--
--   analysis IS NULL      -> it was declined
--   retrieval_mode = 'grounding'
--   source_count = 0      -> nothing was retrieved to decline ON
--
-- A genuine grounded decline has chunks and is left alone: the model searched,
-- found little, and said so. That is a real result and re-asking it costs
-- quota. Deleting rather than nulling a column because "no row" is this
-- feature's word for "never attempted", which is what these titles now are.
--
-- The generator now throws instead of storing this shape, so the migration is
-- a one-off cleanup rather than a recurring sweep.

DELETE FROM title_analysis
WHERE analysis IS NULL
  AND retrieval_mode = 'grounding'
  AND COALESCE(source_count, 0) = 0;
