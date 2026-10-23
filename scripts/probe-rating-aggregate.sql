-- What does the unified quality rating change?
--
-- THE RULE, as ratings/unifiedRating.ts ships it (F-167). The quality term used
-- to be calculateRatingScore(community_rating); probe-rating-sources.sql
-- measured community_rating as effectively an IMDb copy (r = 0.995, about 0.1
-- point high on releases from the last two years, F-087). It is now:
--
--   audience = the refreshed IMDb rating; the media server's where IMDb is
--              missing; TMDb (rank-mapped) where both are
--   critics  = 0.6 Metacritic + 0.4 RT critic         (movies only)
--   rating   = 0.6 audience + 0.4 critics
--
-- Weights re-normalise over what a title HAS: a missing source never counts as
-- zero, and a title with no critic score is its audience figure. An RT score
-- more than :rt_guard points from the title's Metacritic is dropped (OMDb
-- matches titles by name and sometimes stores another film's RT).
--
-- WHY RANK-MAPPING. The sources are not on one scale: RT is a share of
-- positive reviews (sd 25.8, piles up at 100), Metacritic a weighted mean
-- (sd 17.1), IMDb a 0-10 mean (sd 9.4 on x10). So every source other than IMDb
-- is mapped onto IMDb by rank, among the titles that carry BOTH: a title at
-- the 80th percentile of Metacritic gets the IMDb rating at the 80th
-- percentile of the Metacritic-reviewed films. Not of the whole library: the
-- films critics reviewed are better known and better rated, and mapping onto
-- the library's IMDb would mark every reviewed film down. Ties take the middle
-- of their rank range; a value no paired title holds sits half a rank below
-- the next one up; the IMDb value is read by nearest rank. All of that is the
-- code's own arithmetic, so this measures what ships.
--
-- WHAT IT MEASURES
--   0. formula check -- the stored base_score rebuilt from the stored
--                       components and the run's stored weights; if this is
--                       not near zero the simulation below is not to be read
--   1. library-wide  -- old rating vs aggregate, and the rating SCORE spread
--   2. movers        -- the titles the aggregate moves most
--   3. pool spread   -- p90-p10 of the rating score in each run's pool, old vs
--                       new: RATING_TYPICAL_SPREAD was 0.46 on the old rating
--   4. per viewer    -- for each viewer's newest completed run, how much of the
--                       top N and of the MMR shortlist survives
--   5. titles        -- which titles enter and leave viewers' top N
--
-- LIMITS. Selection is MMR over a shortlist plus reserved slots, which SQL
-- cannot replay, so section 4 compares rankings by final_score: the top N
-- (what MMR mostly picks from) and the shortlist (max(150, 15 x N), what MMR
-- can pick from at all). Both sides are recomputed from TODAY's ratings, so a
-- rating that moved since the run does not register as an effect of the
-- aggregate. The preference nudge is carried over exactly (it is a fixed share
-- of the remaining headroom, so it is inverted from final - base and reapplied).
-- Two variants: A is what ships (the rating gain at 0.57 / 0.445); B
-- re-measures the gain from each pool's own new spread.
--
-- Read-only (temp functions, views and tables only). Weights are psql
-- variables, so a different split is a re-run, e.g.
--   psql ... -v w_critic=0.5 -f /tmp/agg.sql
--
-- Run (Windows host, cmd.exe):
--   docker cp scripts\probe-rating-aggregate.sql aperture-db:/tmp/agg.sql
--   docker exec aperture-db psql -U app -d aperture -f /tmp/agg.sql

\pset footer off
\if :{?w_mc}
\else
  \set w_mc 0.6
\endif
\if :{?w_rt}
\else
  \set w_rt 0.4
\endif
\if :{?w_audience}
\else
  \set w_audience 0.6
\endif
\if :{?w_critic}
\else
  \set w_critic 0.4
\endif
\if :{?rt_guard}
\else
  \set rt_guard 50
\endif
\echo 'weights: audience' :w_audience '/ critics' :w_critic '(mc' :w_mc ', rt' :w_rt ') / rt guard' :rt_guard

-- calculateRatingScore (packages/core/src/recommender/shared/scoring.ts), copied.
CREATE FUNCTION pg_temp.rating_score(r float8) RETURNS float8 LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN r IS NULL THEN 0.4
    WHEN least(greatest(r, 0), 10) >= 8 THEN 0.8 + (least(greatest(r, 0), 10) - 8) * 0.1
    WHEN r >= 7 THEN 0.6 + (r - 7) * 0.2
    WHEN r >= 6 THEN 0.4 + (r - 6) * 0.2
    WHEN r >= 5 THEN 0.2 + (r - 5) * 0.2
    ELSE greatest(r, 0) / 25
  END
$$;

-- presentMean (ratings/unifiedRating.ts): the weighted mean of whatever is present.
CREATE FUNCTION pg_temp.wmean(a float8, wa float8, b float8, wb float8) RETURNS float8
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN a IS NULL AND b IS NULL THEN NULL
    WHEN a IS NULL THEN b
    WHEN b IS NULL THEN a
    WHEN wa + wb <= 0 THEN NULL
    ELSE (wa * a + wb * b) / (wa + wb)
  END
$$;

-- RT is guarded here, before anything is mapped, as trustedRtScore does.
CREATE TEMP VIEW src AS
  SELECT media_type, id, title, year, community, imdb, imdb_votes, tmdb, mc, rt_raw,
         CASE WHEN rt_raw IS NOT NULL AND mc IS NOT NULL AND abs(rt_raw - mc) > :rt_guard
              THEN NULL ELSE rt_raw END AS rt
    FROM (
      SELECT 'movie'::text AS media_type, id, title, year,
             community_rating::float8 AS community, imdb_rating::float8 AS imdb, imdb_vote_count AS imdb_votes,
             tmdb_rating::float8 AS tmdb, rt_critic_score::float8 AS rt_raw, metacritic_score::float8 AS mc
        FROM movies
      UNION ALL
      SELECT 'series', id, title, year,
             community_rating::float8, imdb_rating::float8, imdb_vote_count,
             tmdb_rating::float8, rt_critic_score::float8, metacritic_score::float8
        FROM series
    ) raw;

CREATE TEMP VIEW src_long AS
  SELECT media_type, id, imdb, s.source, s.value
    FROM src CROSS JOIN LATERAL (VALUES ('tmdb', tmdb), ('rt', rt), ('mc', mc)) AS s(source, value)
   WHERE s.value IS NOT NULL;

-- Tables, not views: both are read once per title below, and a view would be
-- re-aggregated each time.
CREATE TEMP TABLE pair_counts AS
  SELECT media_type, source, value, COUNT(*) AS cnt,
         SUM(COUNT(*)) OVER (PARTITION BY media_type, source ORDER BY value) - COUNT(*) AS less
    FROM src_long WHERE imdb IS NOT NULL
   GROUP BY media_type, source, value;

CREATE TEMP TABLE pair_ref AS
  SELECT media_type, source, array_agg(imdb ORDER BY imdb) AS ref, COUNT(*) AS n
    FROM src_long WHERE imdb IS NOT NULL
   GROUP BY media_type, source;

-- percentileWithin + valueAtPercentile (ratings/unifiedRating.ts).
CREATE TEMP VIEW mapped AS
  SELECT l.media_type, l.id,
         max(CASE WHEN l.source = 'tmdb' THEN r.ref[1 + round(pc.p * (r.n - 1))::int] END) AS tmdb_m,
         max(CASE WHEN l.source = 'rt'   THEN r.ref[1 + round(pc.p * (r.n - 1))::int] END) AS rt_m,
         max(CASE WHEN l.source = 'mc'   THEN r.ref[1 + round(pc.p * (r.n - 1))::int] END) AS mc_m
    FROM src_long l
    JOIN pair_ref r USING (media_type, source)
    CROSS JOIN LATERAL (
      SELECT CASE WHEN r.n = 1 THEN 0.5 ELSE least(1, greatest(0,
               coalesce(
                 (SELECT c.less + (c.cnt - 1) / 2.0 FROM pair_counts c
                   WHERE c.media_type = l.media_type AND c.source = l.source AND c.value = l.value),
                 (SELECT coalesce(SUM(c.cnt), 0) - 0.5 FROM pair_counts c
                   WHERE c.media_type = l.media_type AND c.source = l.source AND c.value < l.value)
               ) / (r.n - 1))) END AS p
    ) pc
   GROUP BY l.media_type, l.id;

CREATE TEMP VIEW agg AS
  SELECT s.*, m.tmdb_m, m.rt_m, m.mc_m,
         coalesce(s.imdb, s.community, m.tmdb_m) AS audience,
         CASE WHEN s.media_type = 'movie' THEN pg_temp.wmean(m.mc_m, :w_mc, m.rt_m, :w_rt) END AS critic
    FROM src s LEFT JOIN mapped m USING (media_type, id);

CREATE TEMP VIEW scored AS
  SELECT a.*,
         pg_temp.wmean(a.audience, :w_audience, a.critic, :w_critic) AS aggregate,
         pg_temp.rating_score(a.community) AS old_score,
         pg_temp.rating_score(pg_temp.wmean(a.audience, :w_audience, a.critic, :w_critic)) AS new_score
    FROM agg a;

-- Every candidate of each viewer's newest completed run, with both rating scores.
CREATE TEMP VIEW pool AS
  WITH newest AS (
    SELECT DISTINCT ON (user_id, media_type)
           id AS run_id, user_id, media_type, selected_count,
           similarity_weight::float8 AS ws, novelty_weight::float8 AS wn, rating_weight::float8 AS wr
      FROM recommendation_runs
     WHERE status = 'completed' AND channel_id IS NULL
     ORDER BY user_id, media_type, created_at DESC
  )
  SELECT n.*, c.id AS cand_id, coalesce(c.movie_id, c.series_id) AS item_id,
         c.is_selected, c.score_breakdown,
         c.normalized_similarity::float8 AS ns, c.novelty_score::float8 AS nov,
         c.rating_score::float8 AS stored_rating, c.base_score::float8 AS base,
         c.final_score::float8 AS final,
         sc.old_score, sc.new_score
    FROM newest n
    JOIN recommendation_candidates c ON c.run_id = n.run_id
    JOIN scored sc ON sc.media_type = n.media_type AND sc.id = coalesce(c.movie_id, c.series_id)
   WHERE c.normalized_similarity IS NOT NULL AND c.base_score IS NOT NULL
     AND n.ws IS NOT NULL AND n.wn IS NOT NULL AND n.wr IS NOT NULL;

-- Spread of each pool's rating score, old and new, for variant B's gain.
CREATE TEMP VIEW pool_spread AS
  SELECT run_id,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY old_score)
       - percentile_cont(0.1) WITHIN GROUP (ORDER BY old_score) AS old_spread,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY new_score)
       - percentile_cont(0.1) WITHIN GROUP (ORDER BY new_score) AS new_spread
    FROM pool GROUP BY run_id;

-- final = base + k * headroom(base); k is inverted from the stored pair and
-- reapplied to the new base, which is exactly applyPreferenceAdjustment.
CREATE FUNCTION pg_temp.renudge(base float8, final float8, new_base float8) RETURNS float8
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN final > base AND base < 1 THEN new_base + (final - base) / (1 - base) * (1 - new_base)
    WHEN final < base AND base > 0 THEN new_base - (base - final) / base * new_base
    ELSE new_base
  END
$$;

CREATE TEMP VIEW sim AS
  SELECT p.*, ps.old_spread, ps.new_spread,
         greatest(150, 15 * p.selected_count) AS shortlist,
         pg_temp.renudge(p.base, p.final,
           (p.ws * greatest(p.ns, 0) + p.wn * p.nov + p.wr * p.old_score) / (p.ws + p.wn + p.wr)) AS final_old,
         pg_temp.renudge(p.base, p.final,
           (p.ws * greatest(p.ns, 0) + p.wn * p.nov + p.wr * (0.46 / 0.445) * p.new_score)
           / (p.ws + p.wn + p.wr * (0.46 / 0.445))) AS final_a,
         pg_temp.renudge(p.base, p.final,
           (p.ws * greatest(p.ns, 0) + p.wn * p.nov
            + p.wr * (0.46 / NULLIF(ps.new_spread, 0)) * p.new_score)
           / (p.ws + p.wn + p.wr * (0.46 / NULLIF(ps.new_spread, 0)))) AS final_b
    FROM pool p JOIN pool_spread ps USING (run_id);

CREATE TEMP VIEW ranks AS
  SELECT s.*,
         row_number() OVER (PARTITION BY run_id ORDER BY final_old DESC, cand_id) AS r_old,
         row_number() OVER (PARTITION BY run_id ORDER BY final_a   DESC, cand_id) AS r_a,
         row_number() OVER (PARTITION BY run_id ORDER BY final_b   DESC, cand_id) AS r_b,
         NOT (score_breakdown ? 'twinMatch' OR score_breakdown ? 'interestMatch'
              OR score_breakdown ? 'acclaimedMatch') AS ranked_pick
    FROM sim s;

\echo
\echo '=== 0. Formula check: stored base_score vs rebuilt from stored components (should be ~0)'
SELECT media_type, COUNT(*) AS candidates,
       ROUND(AVG(abs(base - (ws * greatest(ns, 0) + wn * nov + wr * stored_rating) / (ws + wn + wr)))::numeric, 5) AS mean_abs_err,
       ROUND(MAX(abs(base - (ws * greatest(ns, 0) + wn * nov + wr * stored_rating) / (ws + wn + wr)))::numeric, 5) AS max_abs_err,
       ROUND(AVG(abs(stored_rating - old_score))::numeric, 4) AS stored_vs_today_rating
  FROM pool GROUP BY media_type ORDER BY media_type;

\echo
\echo '=== 1a. Library: what the aggregate is built from'
SELECT media_type, COUNT(*) AS titles,
       COUNT(*) FILTER (WHERE critic IS NOT NULL) AS with_critic,
       COUNT(*) FILTER (WHERE aggregate IS NULL) AS no_rating,
       ROUND(corr(coalesce(community, imdb), aggregate)::numeric, 3) AS r_old_vs_aggregate,
       ROUND(corr(audience, critic)::numeric, 3) AS r_audience_vs_critic,
       ROUND(AVG(aggregate - coalesce(community, imdb))::numeric, 2) AS mean_shift_points
  FROM scored GROUP BY media_type ORDER BY media_type;

\echo
\echo '=== 1b. Library: rating SCORE (0-1, what the blend consumes), old vs new'
SELECT media_type, which,
       ROUND((percentile_cont(0.1) WITHIN GROUP (ORDER BY v))::numeric, 3) AS p10,
       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY v))::numeric, 3) AS median,
       ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY v))::numeric, 3) AS p90,
       ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY v)
            - percentile_cont(0.1) WITHIN GROUP (ORDER BY v))::numeric, 3) AS spread
  FROM (SELECT media_type, 'old' AS which, old_score AS v FROM scored
        UNION ALL SELECT media_type, 'new', new_score FROM scored) x
 GROUP BY media_type, which ORDER BY media_type, which DESC;

\echo
\echo '=== 2a. Biggest rises (aggregate - current rating), titles with 5,000+ IMDb votes'
SELECT media_type, title, year, ROUND(coalesce(community, imdb)::numeric, 1) AS now,
       ROUND(aggregate::numeric, 1) AS aggregate, ROUND(imdb::numeric, 1) AS imdb,
       ROUND(tmdb::numeric, 1) AS tmdb, rt::int AS rt, mc::int AS mc
  FROM scored WHERE imdb_votes >= 5000 AND aggregate IS NOT NULL
 ORDER BY aggregate - coalesce(community, imdb) DESC LIMIT 15;

\echo
\echo '=== 2b. Biggest falls, titles with 5,000+ IMDb votes'
SELECT media_type, title, year, ROUND(coalesce(community, imdb)::numeric, 1) AS now,
       ROUND(aggregate::numeric, 1) AS aggregate, ROUND(imdb::numeric, 1) AS imdb,
       ROUND(tmdb::numeric, 1) AS tmdb, rt::int AS rt, mc::int AS mc
  FROM scored WHERE imdb_votes >= 5000 AND aggregate IS NOT NULL
 ORDER BY aggregate - coalesce(community, imdb) ASC LIMIT 15;

\echo
\echo '=== 3. Rating-score spread inside each run''s pool (0.46 on the old rating, 0.445 shipped)'
SELECT p.media_type, COUNT(*) AS runs,
       ROUND(MIN(ps.old_spread)::numeric, 3) AS old_min,
       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY ps.old_spread))::numeric, 3) AS old_median,
       ROUND(MAX(ps.old_spread)::numeric, 3) AS old_max,
       ROUND(MIN(ps.new_spread)::numeric, 3) AS new_min,
       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY ps.new_spread))::numeric, 3) AS new_median,
       ROUND(MAX(ps.new_spread)::numeric, 3) AS new_max
  FROM pool_spread ps
  JOIN (SELECT DISTINCT run_id, media_type FROM pool) p USING (run_id)
 GROUP BY p.media_type ORDER BY p.media_type;

\echo
\echo '=== 4. Per viewer: how much of today''s ranking survives (A = shipped gain 0.57/0.445, B = per-pool gain)'
SELECT u.username, r.media_type, max(r.selected_count) AS n, COUNT(*) AS pool,
       COUNT(*) FILTER (WHERE r_old <= selected_count AND r_a <= selected_count) AS top_n_kept_a,
       COUNT(*) FILTER (WHERE r_old <= selected_count AND r_b <= selected_count) AS top_n_kept_b,
       ROUND(100.0 * COUNT(*) FILTER (WHERE r_old <= shortlist AND r_b <= shortlist)
             / NULLIF(COUNT(*) FILTER (WHERE r_old <= shortlist), 0), 1) AS shortlist_kept_b_pct,
       COUNT(*) FILTER (WHERE is_selected AND ranked_pick) AS ranked_picks,
       COUNT(*) FILTER (WHERE is_selected AND ranked_pick AND r_b > shortlist) AS picks_off_shortlist_b
  FROM ranks r JOIN users u ON u.id = r.user_id
 GROUP BY u.username, r.media_type
 ORDER BY r.media_type, u.username;

\echo
\echo '=== 5a. Titles entering viewers'' top N under B (by how many viewers)'
SELECT r.media_type, sc.title, sc.year, COUNT(*) AS viewers,
       ROUND(sc.aggregate::numeric, 1) AS aggregate, ROUND(coalesce(sc.community, sc.imdb)::numeric, 1) AS now,
       sc.rt::int AS rt, sc.mc::int AS mc
  FROM ranks r JOIN scored sc ON sc.media_type = r.media_type AND sc.id = r.item_id
 WHERE r.r_b <= r.selected_count AND r.r_old > r.selected_count
 GROUP BY r.media_type, sc.title, sc.year, sc.aggregate, sc.community, sc.imdb, sc.rt, sc.mc
 ORDER BY viewers DESC, sc.title LIMIT 20;

\echo
\echo '=== 5b. Titles leaving viewers'' top N under B'
SELECT r.media_type, sc.title, sc.year, COUNT(*) AS viewers,
       ROUND(sc.aggregate::numeric, 1) AS aggregate, ROUND(coalesce(sc.community, sc.imdb)::numeric, 1) AS now,
       sc.rt::int AS rt, sc.mc::int AS mc
  FROM ranks r JOIN scored sc ON sc.media_type = r.media_type AND sc.id = r.item_id
 WHERE r.r_old <= r.selected_count AND r.r_b > r.selected_count
 GROUP BY r.media_type, sc.title, sc.year, sc.aggregate, sc.community, sc.imdb, sc.rt, sc.mc
 ORDER BY viewers DESC, sc.title LIMIT 20;
