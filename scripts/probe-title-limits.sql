-- What the assistant's stated limits (F-183) do on a real library. Read-only.
--   psql -f scripts/probe-title-limits.sql
--
-- The active embedding table is not knowable from SQL here (system_settings is
-- closed to a read-only role): section 3 assumes embeddings_3072. Section 2 says
-- which tables hold what; change the name if another one is in use.

-- 1. How often is a limit's fact unknown? Unknown fails the limit, so a low coverage
--    here means maxRuntime comes back empty a lot.
SELECT 'movies' AS media, count(*) AS total,
       count(*) FILTER (WHERE runtime_minutes > 0) AS has_runtime,
       count(*) FILTER (WHERE year IS NOT NULL) AS has_year,
       count(*) FILTER (WHERE genres <> '{}') AS has_genre,
       count(*) FILTER (WHERE (CASE WHEN quality_rating_sources IS NULL THEN community_rating ELSE quality_rating END) IS NOT NULL) AS has_rating
  FROM movies
UNION ALL
SELECT 'series', count(*),
       (SELECT count(DISTINCT series_id) FROM episodes WHERE season_number > 0 AND runtime_minutes > 0),
       count(*) FILTER (WHERE year IS NOT NULL),
       count(*) FILTER (WHERE genres <> '{}'),
       count(*) FILTER (WHERE (CASE WHEN quality_rating_sources IS NULL THEN community_rating ELSE quality_rating END) IS NOT NULL)
  FROM series;

-- The genre names limits are matched against.
SELECT 'movies' AS media, genre, count(*) FROM movies, unnest(genres) AS genre GROUP BY 2
UNION ALL
SELECT 'series', genre, count(*) FROM series, unnest(genres) AS genre GROUP BY 2
ORDER BY 1, 3 DESC;

-- 2. Which sets share a table. A narrow limit walks at most hnsw.max_scan_tuples
--    (20,000) tuples across ALL of them, so more than that in one table can come
--    back short of what the library holds.
SELECT 'embeddings_3072' AS tbl, model, count(*) FROM embeddings_3072 GROUP BY 2;

-- 3. The plan for a narrow limit. The risk to read for: Limit > Sort > Hash Join
--    over the index scan (no LIMIT reaches the index, so it walks until exhausted or
--    max_scan_tuples) against Limit > Nested Loop (stops when full). Compare the
--    execution time with the broad query below it.
BEGIN;
SET LOCAL hnsw.iterative_scan = strict_order;
EXPLAIN (ANALYZE, BUFFERS)
SELECT m.id
  FROM embeddings_3072 e
  JOIN movies m ON m.id = e.movie_id
 WHERE e.model = (SELECT model FROM embeddings_3072 LIMIT 1)
   AND m.runtime_minutes > 0 AND m.runtime_minutes <= 60
   AND m.year >= 1990 AND m.year <= 1999
 ORDER BY e.embedding <=> (SELECT embedding FROM embeddings_3072 LIMIT 1)
 LIMIT 20;
EXPLAIN (ANALYZE, BUFFERS)
SELECT m.id
  FROM embeddings_3072 e
  JOIN movies m ON m.id = e.movie_id
 WHERE e.model = (SELECT model FROM embeddings_3072 LIMIT 1)
   AND m.year >= 1990
 ORDER BY e.embedding <=> (SELECT embedding FROM embeddings_3072 LIMIT 1)
 LIMIT 20;
ROLLBACK;

-- 4. The read a series maximum costs per tool call.
EXPLAIN (ANALYZE)
SELECT series_id FROM episodes
 WHERE season_number > 0 AND runtime_minutes > 0
 GROUP BY series_id
HAVING percentile_cont(0.5) WITHIN GROUP (ORDER BY runtime_minutes) <= 30;
