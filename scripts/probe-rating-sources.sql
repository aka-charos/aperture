-- What do the rating sources on this library actually look like?
--
-- THE QUESTION. The recommender's quality term is one number,
-- calculateRatingScore(community_rating) -- the media server's own rating,
-- which Emby's rating plugin fills from OMDb/MDBList (F-087), so in practice an
-- IMDb copy of uncertain age. The proposal is an aggregate over the sources we
-- already store (IMDb, TMDb, RT critic + audience, Metacritic, Letterboxd),
-- weighted rather than averaged. Before choosing weights this measures, per
-- media type:
--
--   1. coverage    -- how many titles carry each source, and how many sources
--                     a title typically has (a weighted mean must re-normalise
--                     over the sources PRESENT, so this decides how often it does)
--   2. spread      -- each source on a common 0-100 scale; a source that never
--                     leaves a narrow band carries little ranking signal
--                     whatever weight it is given (F-058)
--   3. agreement   -- pairwise correlation; two sources at 0.95 are one source
--                     counted twice, two at 0.4 measure different things
--   4. community_rating vs imdb_rating -- is the number scoring reads today
--                     the same as the IMDb figure refresh-ratings keeps fresh?
--                     split by release age, since F-087 says staleness is
--                     biased upward on recent releases
--   5. mdblist_score -- MDBList already ships its own aggregate; how close is it
--                     to the sources it is built from?
--   6. disagreements -- titles where audience and critics part most, to read
--
-- SCALES. imdb/tmdb/community are 0-10 (x10), letterboxd is 0-5 (x20), RT,
-- Metacritic and MDBList are 0-100. Check section 2's min/max: a source whose
-- max is not near its scale's top means the scale assumption is wrong.
--
-- Read-only. Every row in movies/series is counted, including titles in
-- libraries switched off in Aperture.
--
-- Run (Windows host, cmd.exe):
--   docker cp scripts\probe-rating-sources.sql aperture-db:/tmp/probe.sql
--   docker exec aperture-db psql -U app -d aperture -f /tmp/probe.sql

\pset footer off

CREATE TEMP VIEW rating_rows AS
  SELECT 'movie'::text AS media_type, id, title, year,
         community_rating::float8 * 10 AS community,
         imdb_rating::float8 * 10      AS imdb,
         imdb_vote_count               AS imdb_votes,
         tmdb_rating::float8 * 10      AS tmdb,
         tmdb_vote_count               AS tmdb_votes,
         rt_critic_score::float8       AS rt_critic,
         rt_audience_score::float8     AS rt_audience,
         metacritic_score::float8      AS metacritic,
         letterboxd_score::float8 * 20 AS letterboxd,
         mdblist_score::float8         AS mdblist
    FROM movies
  UNION ALL
  SELECT 'series', id, title, year,
         community_rating::float8 * 10, imdb_rating::float8 * 10, imdb_vote_count,
         tmdb_rating::float8 * 10, tmdb_vote_count,
         rt_critic_score::float8, rt_audience_score::float8, metacritic_score::float8,
         letterboxd_score::float8 * 20, mdblist_score::float8
    FROM series;

-- One row per (title, source, value). A stored 0 is kept as a value: whether a
-- source writes 0 for "no score" shows up as a spike at min = 0 in section 2.
CREATE TEMP VIEW rating_long AS
  SELECT r.media_type, r.id, s.source, s.value
    FROM rating_rows r
   CROSS JOIN LATERAL (VALUES
     ('community',   r.community),
     ('imdb',        r.imdb),
     ('tmdb',        r.tmdb),
     ('rt_critic',   r.rt_critic),
     ('rt_audience', r.rt_audience),
     ('metacritic',  r.metacritic),
     ('letterboxd',  r.letterboxd),
     ('mdblist',     r.mdblist)
   ) AS s(source, value)
   WHERE s.value IS NOT NULL;

\echo
\echo '=== 1a. Coverage per source (share of titles carrying it)'
SELECT r.media_type,
       COUNT(*)                                                     AS titles,
       ROUND(100.0 * COUNT(r.community)   / COUNT(*), 1) AS community_pct,
       ROUND(100.0 * COUNT(r.imdb)        / COUNT(*), 1) AS imdb_pct,
       ROUND(100.0 * COUNT(r.tmdb)        / COUNT(*), 1) AS tmdb_pct,
       ROUND(100.0 * COUNT(r.rt_critic)   / COUNT(*), 1) AS rt_critic_pct,
       ROUND(100.0 * COUNT(r.rt_audience) / COUNT(*), 1) AS rt_aud_pct,
       ROUND(100.0 * COUNT(r.metacritic)  / COUNT(*), 1) AS metacritic_pct,
       ROUND(100.0 * COUNT(r.letterboxd)  / COUNT(*), 1) AS letterboxd_pct,
       ROUND(100.0 * COUNT(r.mdblist)     / COUNT(*), 1) AS mdblist_pct
  FROM rating_rows r
 GROUP BY r.media_type
 ORDER BY r.media_type;

\echo
\echo '=== 1b. How many of the six aggregate candidates a title has (imdb, tmdb, rt_critic, rt_audience, metacritic, letterboxd)'
SELECT media_type, sources_present, COUNT(*) AS titles,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY media_type), 1) AS pct
  FROM (
    SELECT media_type,
           (imdb IS NOT NULL)::int + (tmdb IS NOT NULL)::int
         + (rt_critic IS NOT NULL)::int + (rt_audience IS NOT NULL)::int
         + (metacritic IS NOT NULL)::int + (letterboxd IS NOT NULL)::int AS sources_present
      FROM rating_rows
  ) x
 GROUP BY media_type, sources_present
 ORDER BY media_type, sources_present;

\echo
\echo '=== 1c. Critic-side coverage: titles with at least one critic source (RT critic or Metacritic)'
SELECT media_type,
       COUNT(*) FILTER (WHERE rt_critic IS NOT NULL OR metacritic IS NOT NULL) AS with_critic,
       COUNT(*) FILTER (WHERE rt_critic IS NOT NULL AND metacritic IS NOT NULL) AS with_both,
       COUNT(*) FILTER (WHERE imdb IS NOT NULL AND rt_critic IS NULL AND metacritic IS NULL) AS audience_only,
       COUNT(*) FILTER (WHERE imdb IS NULL AND tmdb IS NULL AND community IS NULL) AS no_audience_figure
  FROM rating_rows
 GROUP BY media_type
 ORDER BY media_type;

\echo
\echo '=== 2. Spread per source, common 0-100 scale'
SELECT media_type, source, COUNT(*) AS n,
       ROUND(MIN(value)::numeric, 1)  AS min,
       ROUND((percentile_cont(0.10) WITHIN GROUP (ORDER BY value))::numeric, 1) AS p10,
       ROUND((percentile_cont(0.50) WITHIN GROUP (ORDER BY value))::numeric, 1) AS median,
       ROUND((percentile_cont(0.90) WITHIN GROUP (ORDER BY value))::numeric, 1) AS p90,
       ROUND(MAX(value)::numeric, 1)  AS max,
       ROUND(stddev_samp(value)::numeric, 1) AS sd,
       COUNT(*) FILTER (WHERE value = 0) AS zeros
  FROM rating_long
 GROUP BY media_type, source
 ORDER BY media_type, source;

\echo
\echo '=== 3. Pairwise Pearson correlation (and Spearman-style on ranks), titles carrying both'
WITH ranked AS (
  SELECT media_type, id, source, value,
         percent_rank() OVER (PARTITION BY media_type, source ORDER BY value) AS pr
    FROM rating_long
)
SELECT a.media_type, a.source AS source_a, b.source AS source_b,
       COUNT(*) AS n_both,
       ROUND(corr(a.value, b.value)::numeric, 3) AS pearson,
       ROUND(corr(a.pr, b.pr)::numeric, 3)       AS rank_corr,
       ROUND(AVG(a.value - b.value)::numeric, 1) AS mean_a_minus_b
  FROM ranked a
  JOIN ranked b ON b.media_type = a.media_type AND b.id = a.id AND b.source > a.source
 GROUP BY a.media_type, a.source, b.source
HAVING COUNT(*) >= 30
 ORDER BY a.media_type, pearson DESC;

\echo
\echo '=== 4a. community_rating (what scoring reads) vs imdb_rating (what refresh-ratings maintains), both x10'
SELECT media_type,
       COUNT(*) FILTER (WHERE community IS NOT NULL AND imdb IS NOT NULL) AS n_both,
       COUNT(*) FILTER (WHERE community IS NOT NULL AND imdb IS NULL)     AS community_only,
       COUNT(*) FILTER (WHERE community IS NULL AND imdb IS NOT NULL)     AS imdb_only,
       ROUND(100.0 * COUNT(*) FILTER (WHERE abs(community - imdb) < 0.5)
             / NULLIF(COUNT(*) FILTER (WHERE community IS NOT NULL AND imdb IS NOT NULL), 0), 1) AS identical_pct,
       ROUND(100.0 * COUNT(*) FILTER (WHERE abs(community - imdb) >= 3)
             / NULLIF(COUNT(*) FILTER (WHERE community IS NOT NULL AND imdb IS NOT NULL), 0), 1) AS off_by_0_3_plus_pct,
       ROUND(AVG(community - imdb)::numeric, 2)       AS mean_comm_minus_imdb,
       ROUND(AVG(abs(community - imdb))::numeric, 2)  AS mean_abs_diff,
       ROUND(corr(community, imdb)::numeric, 3)       AS pearson
  FROM rating_rows
 GROUP BY media_type
 ORDER BY media_type;

\echo
\echo '=== 4b. The same gap by release age (F-087: a stale copy should overrate RECENT titles)'
SELECT media_type,
       (ARRAY['0-1 yrs', '2-4 yrs', '5-14 yrs', '15+ yrs', 'unknown'])[bucket] AS age,
       COUNT(*) AS n_both,
       ROUND(AVG(community - imdb)::numeric, 2)      AS mean_comm_minus_imdb,
       ROUND(AVG(abs(community - imdb))::numeric, 2) AS mean_abs_diff
  FROM (
    SELECT media_type, community, imdb,
           CASE WHEN year IS NULL THEN 5
                WHEN year >= EXTRACT(YEAR FROM now())::int - 1  THEN 1
                WHEN year >= EXTRACT(YEAR FROM now())::int - 4  THEN 2
                WHEN year >= EXTRACT(YEAR FROM now())::int - 14 THEN 3
                ELSE 4 END AS bucket
      FROM rating_rows
     WHERE community IS NOT NULL AND imdb IS NOT NULL
  ) x
 GROUP BY media_type, bucket
 ORDER BY media_type, bucket;

\echo
\echo '=== 4c. Largest community vs IMDb gaps (x10 scale)'
SELECT media_type, title, year,
       ROUND((community / 10)::numeric, 1) AS community,
       ROUND((imdb / 10)::numeric, 1)      AS imdb,
       imdb_votes
  FROM rating_rows
 WHERE community IS NOT NULL AND imdb IS NOT NULL
 ORDER BY abs(community - imdb) DESC, imdb_votes DESC NULLS LAST
 LIMIT 15;

\echo
\echo '=== 5. MDBList score vs a plain mean of the sources present (does MDBList already aggregate the way we would?)'
WITH m AS (
  SELECT media_type, mdblist,
         (SELECT AVG(v) FROM unnest(ARRAY[imdb, tmdb, rt_critic, rt_audience, metacritic, letterboxd]) AS v) AS plain_mean
    FROM rating_rows
   WHERE mdblist IS NOT NULL
)
SELECT media_type, COUNT(*) AS n,
       ROUND(corr(mdblist, plain_mean)::numeric, 3) AS pearson,
       ROUND(AVG(mdblist - plain_mean)::numeric, 1) AS mean_mdblist_minus_mean,
       ROUND(stddev_samp(mdblist)::numeric, 1)      AS sd_mdblist,
       ROUND(stddev_samp(plain_mean)::numeric, 1)   AS sd_plain_mean
  FROM m
 WHERE plain_mean IS NOT NULL
 GROUP BY media_type
 ORDER BY media_type;

\echo
\echo '=== 6a. Critics far ABOVE the audience (RT critic - IMDb x10), well-voted titles only'
SELECT media_type, title, year,
       ROUND((imdb / 10)::numeric, 1) AS imdb, imdb_votes,
       rt_critic::int AS rt_critic, rt_audience::int AS rt_aud, metacritic::int AS mc
  FROM rating_rows
 WHERE rt_critic IS NOT NULL AND imdb IS NOT NULL AND imdb_votes >= 5000
 ORDER BY rt_critic - imdb DESC
 LIMIT 15;

\echo
\echo '=== 6b. Audience far ABOVE the critics (IMDb x10 - RT critic), well-voted titles only'
SELECT media_type, title, year,
       ROUND((imdb / 10)::numeric, 1) AS imdb, imdb_votes,
       rt_critic::int AS rt_critic, rt_audience::int AS rt_aud, metacritic::int AS mc
  FROM rating_rows
 WHERE rt_critic IS NOT NULL AND imdb IS NOT NULL AND imdb_votes >= 5000
 ORDER BY imdb - rt_critic DESC
 LIMIT 15;
