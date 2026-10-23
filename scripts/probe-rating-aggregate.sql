-- What would an aggregated quality rating change?
--
-- THE PROPOSAL. Today the quality term is calculateRatingScore(community_rating),
-- and probe-rating-sources.sql measured community_rating as effectively an IMDb
-- copy (r = 0.995, about 0.1 point high on releases from the last year or two,
-- F-087). The proposal replaces the rating fed to calculateRatingScore with:
--
--   audience = 0.75 IMDb + 0.25 TMDb
--   critics  = 0.6 Metacritic + 0.4 RT critic         (movies only)
--   rating   = 0.6 audience + 0.4 critics
--
-- Weights re-normalise over what a title HAS: a missing source never counts as
-- zero, and a title with no critic score is its audience figure. Series get the
-- audience half only, since RT/Metacritic cover about 1% of shows.
--
-- WHY RANK-MAPPING. The sources are not on one scale: RT is a share of
-- positive reviews (sd 25.8, piles up at 100), Metacritic a weighted mean
-- (sd 17.1), IMDb a 0-10 mean (sd 9.4 on x10). A weighted mean of raw numbers
-- would let RT dominate by having the widest spread. So every source other
-- than IMDb is mapped onto IMDb's own distribution by rank: a title at the
-- 80th percentile of Metacritic gets the IMDb rating that sits at IMDb's 80th
-- percentile. The aggregate therefore stays on the 0-10 scale
-- calculateRatingScore expects, and "Quality 82%" keeps meaning 8.2.
-- Ties take the midpoint of their rank range (every RT 100 maps to the middle
-- of the 100s, not the top), per media type.
--
-- WHAT IT MEASURES
--   0. formula check -- the stored base_score rebuilt from the stored
--                       components and the run's stored weights; if this is
--                       not near zero the simulation below is not to be read
--   1. library-wide  -- old rating vs aggregate, and the rating SCORE spread
--   2. movers        -- the titles the aggregate moves most
--   3. pool spread   -- p90-p10 of the rating score in each run's pool, old vs
--                       new: RATING_TYPICAL_SPREAD (0.46) is the old figure,
--                       and the new median is what it would become
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
-- Two variants: A keeps the current rating gain (0.57 / 0.46); B re-measures
-- the gain from each pool's new spread, which is what a re-measured
-- RATING_TYPICAL_SPREAD would do.
--
-- Read-only (temp functions and views only). Weights are psql variables, so a
-- different split is a re-run, e.g. psql ... -v w_critic=0.5 -f /tmp/agg.sql
--
-- Run (Windows host, cmd.exe):
--   docker cp scripts\probe-rating-aggregate.sql aperture-db:/tmp/agg.sql
--   docker exec aperture-db psql -U app -d aperture -f /tmp/agg.sql

\pset footer off
\if :{?w_imdb}
\else
  \set w_imdb 0.75
\endif
\if :{?w_tmdb}
\else
  \set w_tmdb 0.25
\endif
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
\echo 'weights: audience' :w_audience '(imdb' :w_imdb ', tmdb' :w_tmdb ') / critics' :w_critic '(mc' :w_mc ', rt' :w_rt ')'

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

-- The weighted mean of whatever is present; NULL when nothing is.
CREATE FUNCTION pg_temp.wmean(a float8, wa float8, b float8, wb float8) RETURNS float8
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN a IS NULL AND b IS NULL THEN NULL
    WHEN a IS NULL THEN CASE WHEN wb > 0 THEN b END
    WHEN b IS NULL THEN CASE WHEN wa > 0 THEN a END
    WHEN wa + wb <= 0 THEN NULL
    ELSE (wa * a + wb * b) / (wa + wb)
  END
$$;

CREATE TEMP VIEW src AS
  SELECT 'movie'::text AS media_type, id, title, year,
         community_rating::float8 AS community, imdb_rating::float8 AS imdb, imdb_vote_count AS imdb_votes,
         tmdb_rating::float8 AS tmdb, rt_critic_score::float8 AS rt, metacritic_score::float8 AS mc
    FROM movies
  UNION ALL
  SELECT 'series', id, title, year,
         community_rating::float8, imdb_rating::float8, imdb_vote_count,
         tmdb_rating::float8, rt_critic_score::float8, metacritic_score::float8
    FROM series;

-- IMDb's distribution per media type, as 1001 quantiles.
CREATE TEMP VIEW imdb_q AS
  SELECT media_type,
         percentile_disc(ARRAY(SELECT g / 1000.0 FROM generate_series(0, 1000) g)::float8[])
           WITHIN GROUP (ORDER BY imdb) AS q
    FROM src WHERE imdb IS NOT NULL
   GROUP BY media_type;

CREATE TEMP VIEW mapped AS
  WITH long AS (
    SELECT media_type, id, s.source, s.value
      FROM src CROSS JOIN LATERAL (VALUES ('tmdb', tmdb), ('rt', rt), ('mc', mc)) AS s(source, value)
     WHERE s.value IS NOT NULL
  ), ranked AS (
    SELECT media_type, id, source,
           (rank() OVER w - 1 + (count(*) OVER (PARTITION BY media_type, source, value) - 1) / 2.0)
             / NULLIF(count(*) OVER (PARTITION BY media_type, source) - 1, 0) AS p
      FROM long
    WINDOW w AS (PARTITION BY media_type, source ORDER BY value)
  )
  SELECT r.media_type, r.id,
         max(CASE WHEN source = 'tmdb' THEN q.q[1 + round(coalesce(r.p, 0.5) * 1000)::int] END) AS tmdb_m,
         max(CASE WHEN source = 'rt'   THEN q.q[1 + round(coalesce(r.p, 0.5) * 1000)::int] END) AS rt_m,
         max(CASE WHEN source = 'mc'   THEN q.q[1 + round(coalesce(r.p, 0.5) * 1000)::int] END) AS mc_m
    FROM ranked r JOIN imdb_q q USING (media_type)
   GROUP BY r.media_type, r.id;

CREATE TEMP VIEW agg AS
  SELECT s.*, m.tmdb_m, m.rt_m, m.mc_m,
         -- the refreshed IMDb figure; the media server's copy only where IMDb is missing
         pg_temp.wmean(coalesce(s.imdb, s.community), :w_imdb, m.tmdb_m, :w_tmdb) AS audience,
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
           (p.ws * greatest(p.ns, 0) + p.wn * p.nov + p.wr * p.new_score) / (p.ws + p.wn + p.wr)) AS final_a,
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
\echo '=== 3. Rating-score spread inside each run''s pool (RATING_TYPICAL_SPREAD is 0.46 today)'
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
\echo '=== 4. Per viewer: how much of today''s ranking survives (A = current gain, B = re-measured gain)'
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
