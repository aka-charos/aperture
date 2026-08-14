-- Clear omdb_enriched_at stamps that record a failure rather than an answer.
--
-- 0136 added omdb_enriched_at so the enrichment job could tell "OMDb already
-- answered about this title" from "OMDb was never asked". The stamp was written
-- whenever the call was attempted and did not throw — but the OMDb client
-- returned null for an HTTP 401 exactly as it does for a genuine "Movie not
-- found!", and never threw for a failed request at all. So an auth failure read
-- as a definitive answer: the job logged "OMDb: not found" for every title and
-- stamped every row it touched.
--
-- Observed on the live instance as a full pass of
--   OMDB ✗ tt0412080 (HTTP 401)
--   📽 The World's Fastest Indian: OMDb: not found | TMDb: 13 keywords
-- where the same id fetched correctly from omdbapi.com. Every row in that pass
-- is now marked OMDb-complete and would be excluded from every future run —
-- the same permanent exclusion 0136 was written to undo, arriving by a
-- different door.
--
-- The client now throws on any non-answer, so this cannot recur; what is left
-- is the rows already stamped.
--
-- Evidence test: awards_summary and languages are the only columns written
-- exclusively by the OMDb path. rt_critic_score and metacritic_score are also
-- written by mdblist/enrichment.ts, and production_countries by movies/sync.ts
-- on every sync, so none of those prove OMDb ran. This is the same test 0136
-- used to grant stamps, applied here in reverse to revoke them.
--
-- This also clears titles OMDb genuinely has no entry for, which carry no
-- evidence either and are indistinguishable after the fact. That costs one
-- extra request each on the next run and then re-stamps them for good. The
-- error is deliberately in that direction: an unnecessary retry is cheap, a
-- wrongly retired row is permanent.

UPDATE movies
   SET omdb_enriched_at = NULL
 WHERE omdb_enriched_at IS NOT NULL
   AND awards_summary IS NULL
   AND COALESCE(array_length(languages, 1), 0) = 0;

UPDATE series
   SET omdb_enriched_at = NULL
 WHERE omdb_enriched_at IS NOT NULL
   AND awards_summary IS NULL
   AND COALESCE(array_length(languages, 1), 0) = 0;
