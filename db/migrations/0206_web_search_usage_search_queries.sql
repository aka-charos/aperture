-- Record how many Google searches each grounding request ran.
--
-- One grounded request is not one search: Gemini decides, per request, how many
-- Google searches to run (usually several), and the assistant's grounding
-- prompt now asks for searches in a second language when a request is about a
-- particular country's cinema, which roughly doubles them for those requests.
-- Some paid plans bill grounding per search rather than per request, so a meter
-- counting only rows could show the same figure for four searches and eight.
--
-- NULL means NOT RECORDED, never zero: every row written before this column
-- existed, and any call that failed before Gemini answered. A request that ran
-- no search at all (the discovery structuring pass, or a grounded call where
-- Gemini chose not to search) writes a real 0.

ALTER TABLE web_search_usage
  ADD COLUMN IF NOT EXISTS search_queries INTEGER;

COMMENT ON COLUMN web_search_usage.search_queries IS
  'Google searches this request ran (groundingMetadata.webSearchQueries); NULL = not recorded, 0 = none ran';
