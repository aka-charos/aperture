-- What would correcting the discovery blend's realised spreads actually change?
--
-- THE QUESTION. DiscoveryConfig declares four weights -- similarity 0.5,
-- popularity 0.3, recency 0.2 and a fixed source term of 0.1 -- and the admin
-- panel presents them as shares of the blend (45.5 / 27.3 / 18.2 / 9.1 at the
-- defaults). F-058's argument is that a term's real influence is its weight
-- share times the range it actually uses, and measured on this instance the
-- four terms do NOT use comparable ranges:
--
--   term         sd (movie)   sd (series)
--   similarity      0.210        0.194
--   popularity      0.151        0.163
--   recency         0.348        0.294
--   source          0.194        0.194
--
-- So recency realises about 29% of the movement where the panel says 18%, and
-- popularity about 19% where it says 27%. F-059 fixes this class of problem by
-- putting a gain on the WEIGHT rather than on the component, so the displayed
-- component values stay meaningful.
--
-- WHY THIS IS A SIMULATION AND NOT A PATCH. F-060 is the precedent: the same
-- treatment applied to the recommender's selection band was simulated on live
-- data and REJECTED, because it handed similarity 93.6% of the realised
-- influence and changed 10-13 of every user's 20 picks. The arithmetic being
-- more honest did not make the output better. Nothing here writes.
--
-- WHAT IT CANNOT TELL YOU. Churn is a number; whether the titles that arrive
-- are BETTER is not. F-057's rule holds -- the metrics are a guard rail, never
-- a target, and the dump is the primary instrument. Report 4 exists to be read.
--
-- Run it:
--   docker cp scripts/probe-discovery-weights.sql aperture-db:/tmp/probe.sql
--   docker exec aperture-db psql -U app -d aperture -f /tmp/probe.sql
--
-- Read-only. Creates one temp view, which dies with the session.

\pset pager off

-- ---------------------------------------------------------------------------
-- The model, rebuilt from stored rows.
--
-- Components come from score_breakdown rather than the top-level NUMERIC(6,4)
-- columns, which hold the same values rounded to four places. final_score is
-- NUMERIC(6,4) too, so the reconstruction can only ever agree to about 5e-5 --
-- that bound is why report 1 checks against 0.00005 and not against zero.
--
-- The franchise nudge is recovered rather than recomputed, because
-- scoreBreakdown does not store the affinity. applyPreferenceAdjustment is
--
--   final = base + netPull * 0.5 * (netPull > 0 ? 1 - base : base)
--
-- with genre, interest and era all neutral in the discovery scorer, so netPull
-- is a pure function of the franchise preference and lies in
-- [-0.5/1.3, +0.5/1.3] = [-0.3846, +0.3846]. Recovering it and re-applying it
-- unchanged is what keeps the two rankings differing ONLY by the reweighting.
-- ---------------------------------------------------------------------------

CREATE TEMP VIEW sim AS
WITH cfg AS (
  SELECT
    COALESCE((SELECT (value::jsonb->>'similarityWeight')::numeric
                FROM system_settings WHERE key = 'discovery_config'), 0.5) AS ws,
    COALESCE((SELECT (value::jsonb->>'popularityWeight')::numeric
                FROM system_settings WHERE key = 'discovery_config'), 0.3) AS wp,
    COALESCE((SELECT (value::jsonb->>'recencyWeight')::numeric
                FROM system_settings WHERE key = 'discovery_config'), 0.2) AS wr,
    0.1::numeric AS wsrc
),
-- Newest run per viewer per media type. A viewer with several runs stored
-- contributes only their latest, so the pools are the ones live now.
latest AS (
  SELECT DISTINCT ON (user_id, media_type) run_id
    FROM discovery_candidates
   ORDER BY user_id, media_type, created_at DESC
),
raw AS (
  SELECT
    dc.run_id, dc.user_id, dc.media_type, dc.tmdb_id, dc.title,
    -- The SHIPPED position, not a recomputation. storeDiscoveryCandidates
    -- numbers rows from its own loop over a list sorted on the full-precision
    -- score, whereas final_score lands in the column rounded to four places --
    -- so re-sorting on the stored number can reorder rows that were never tied
    -- when the decision was made, and that difference would show up as churn
    -- this change did not cause.
    dc.rank AS rank_old,
    dc.final_score,
    (dc.score_breakdown->>'similarity')::numeric AS sim_s,
    (dc.score_breakdown->>'popularity')::numeric AS pop_s,
    (dc.score_breakdown->>'recency')::numeric    AS rec_s,
    (dc.score_breakdown->>'source')::numeric     AS src_s
  FROM discovery_candidates dc
  JOIN latest l ON l.run_id = dc.run_id
  WHERE dc.score_breakdown ? 'similarity'
    AND dc.score_breakdown ? 'popularity'
    AND dc.score_breakdown ? 'recency'
    AND dc.score_breakdown ? 'source'
),
old AS (
  SELECT r.*,
         (r.sim_s * c.ws + r.pop_s * c.wp + r.rec_s * c.wr + r.src_s * c.wsrc)
           / (c.ws + c.wp + c.wr + c.wsrc) AS base_old
    FROM raw r CROSS JOIN cfg c
),
pulled AS (
  SELECT o.*,
         CASE
           WHEN abs(o.final_score - o.base_old) < 0.00005 THEN 0
           WHEN o.final_score > o.base_old AND o.base_old < 1
             THEN (o.final_score - o.base_old) / (0.5 * (1 - o.base_old))
           WHEN o.final_score < o.base_old AND o.base_old > 0
             THEN (o.final_score - o.base_old) / (0.5 * o.base_old)
           ELSE 0
         END AS net_pull
    FROM old o
),
-- Spreads are a property of the POOL, so they are measured per run. Population
-- sd, not sample: this is the whole set that competed, not a sample of it.
sd AS (
  SELECT run_id,
         stddev_pop(sim_s) AS sd_sim,
         stddev_pop(pop_s) AS sd_pop,
         stddev_pop(rec_s) AS sd_rec,
         stddev_pop(src_s) AS sd_src
    FROM pulled
   GROUP BY run_id
),
-- The gain is 1/sd, rescaled so the total weight is unchanged -- the
-- correction REDISTRIBUTES influence, it does not add any. Discovery has no
-- analogue of the recommender's TARGET_COMPONENT_SPREAD (no term here is
-- normalised onto a known scale), so the correction is relative: equalise the
-- terms against each other rather than onto an anchor.
gain AS (
  SELECT s.run_id, c.ws, c.wp, c.wr, c.wsrc,
         s.sd_sim, s.sd_pop, s.sd_rec, s.sd_src,
         (c.ws + c.wp + c.wr + c.wsrc) /
           NULLIF(
             c.ws   * CASE WHEN s.sd_sim > 0 THEN 1 / s.sd_sim ELSE 1 END +
             c.wp   * CASE WHEN s.sd_pop > 0 THEN 1 / s.sd_pop ELSE 1 END +
             c.wr   * CASE WHEN s.sd_rec > 0 THEN 1 / s.sd_rec ELSE 1 END +
             c.wsrc * CASE WHEN s.sd_src > 0 THEN 1 / s.sd_src ELSE 1 END, 0) AS scale
    FROM sd s CROSS JOIN cfg c
),
eff AS (
  SELECT g.run_id, g.sd_sim, g.sd_pop, g.sd_rec, g.sd_src,
         g.ws, g.wp, g.wr, g.wsrc,
         g.ws   * CASE WHEN g.sd_sim > 0 THEN 1 / g.sd_sim ELSE 1 END * g.scale AS w_sim,
         g.wp   * CASE WHEN g.sd_pop > 0 THEN 1 / g.sd_pop ELSE 1 END * g.scale AS w_pop,
         g.wr   * CASE WHEN g.sd_rec > 0 THEN 1 / g.sd_rec ELSE 1 END * g.scale AS w_rec,
         g.wsrc * CASE WHEN g.sd_src > 0 THEN 1 / g.sd_src ELSE 1 END * g.scale AS w_src
    FROM gain g
),
newscore AS (
  SELECT p.*, e.sd_sim, e.sd_pop, e.sd_rec, e.sd_src,
         e.ws, e.wp, e.wr, e.wsrc, e.w_sim, e.w_pop, e.w_rec, e.w_src,
         (p.sim_s * e.w_sim + p.pop_s * e.w_pop + p.rec_s * e.w_rec + p.src_s * e.w_src)
           / NULLIF(e.w_sim + e.w_pop + e.w_rec + e.w_src, 0) AS base_new
    FROM pulled p
    JOIN eff e ON e.run_id = p.run_id
),
applied AS (
  SELECT n.*,
         CASE
           WHEN n.net_pull > 0 THEN n.base_new + n.net_pull * 0.5 * (1 - n.base_new)
           WHEN n.net_pull < 0 THEN n.base_new + n.net_pull * 0.5 * n.base_new
           ELSE n.base_new
         END AS final_new
    FROM newscore n
)
SELECT a.*,
       u.username,
       -- rank_old is carried from the stored column. Only the NEW order has to
       -- be computed, and tmdb_id breaks its ties so it is deterministic --
       -- without that, churn would partly measure sort instability rather than
       -- the reweighting.
       row_number() OVER (PARTITION BY a.run_id ORDER BY a.final_new DESC, a.tmdb_id) AS rank_new
  FROM applied a
  LEFT JOIN users u ON u.id = a.user_id;


\echo ''
\echo '=== 1. HARNESS CHECK -- does the model reproduce what was stored? ==='
\echo 'neutral_rows should be most of them, and max_err at or under 0.00005'
\echo '(final_score is NUMERIC(6,4), so that bound is its own rounding).'
\echo 'pull_min/pull_max must lie inside -0.385 .. +0.385, or the recovery is wrong.'
\echo ''

SELECT
  username, media_type, count(*) AS n,
  count(*) FILTER (WHERE net_pull = 0) AS neutral_rows,
  round(max(abs(final_score - base_old)) FILTER (WHERE net_pull = 0), 7) AS max_err,
  round(min(net_pull), 3) AS pull_min,
  round(max(net_pull), 3) AS pull_max
FROM sim
GROUP BY username, media_type
ORDER BY media_type, username;


\echo ''
\echo '=== 2. CONFIGURED vs REALISED share, before and after ==='
\echo 'after_* should land on cfg_* by construction -- if it does not, the gain'
\echo 'algebra is wrong. before_* is the discrepancy being argued about.'
\echo ''

SELECT
  username, media_type,
  round(100 * ws   / (ws+wp+wr+wsrc), 1) AS cfg_sim,
  round(100 * wp   / (ws+wp+wr+wsrc), 1) AS cfg_pop,
  round(100 * wr   / (ws+wp+wr+wsrc), 1) AS cfg_rec,
  round(100 * ws*sd_sim / NULLIF(ws*sd_sim+wp*sd_pop+wr*sd_rec+wsrc*sd_src,0), 1) AS before_sim,
  round(100 * wp*sd_pop / NULLIF(ws*sd_sim+wp*sd_pop+wr*sd_rec+wsrc*sd_src,0), 1) AS before_pop,
  round(100 * wr*sd_rec / NULLIF(ws*sd_sim+wp*sd_pop+wr*sd_rec+wsrc*sd_src,0), 1) AS before_rec,
  round(100 * w_sim*sd_sim / NULLIF(w_sim*sd_sim+w_pop*sd_pop+w_rec*sd_rec+w_src*sd_src,0), 1) AS after_sim,
  round(100 * w_pop*sd_pop / NULLIF(w_sim*sd_sim+w_pop*sd_pop+w_rec*sd_rec+w_src*sd_src,0), 1) AS after_pop,
  round(100 * w_rec*sd_rec / NULLIF(w_sim*sd_sim+w_pop*sd_pop+w_rec*sd_rec+w_src*sd_src,0), 1) AS after_rec
FROM (SELECT DISTINCT ON (run_id) * FROM sim ORDER BY run_id) one_per_run
ORDER BY media_type, username;


\echo ''
\echo '=== 3. CHURN -- how much of each list actually moves ==='
\echo 'F-060 rejected its change at 10-13 of 20. This is the comparable number.'
\echo ''

SELECT
  username, media_type, count(*) AS candidates,
  count(*) FILTER (WHERE rank_new <= 20 AND rank_old > 20) AS in_top20,
  count(*) FILTER (WHERE rank_new <= 50 AND rank_old > 50) AS in_top50,
  round(100.0 * count(*) FILTER (WHERE rank_new <= 50 AND rank_old > 50)
        / NULLIF(least(50, count(*)), 0), 1) AS pct_top50,
  max(abs(rank_new - rank_old)) FILTER (WHERE rank_old <= 50) AS worst_move_in_top50
FROM sim
GROUP BY username, media_type
ORDER BY in_top50 DESC, username;


\echo ''
\echo '=== 4. THE TITLES -- read this one, the numbers above cannot judge it ==='
\echo 'Entering = would newly reach the top 20. Leaving = would drop out of it.'
\echo 'Limited to the three runs with the most movement.'
\echo ''

WITH worst AS (
  SELECT run_id
    FROM sim
   GROUP BY run_id
   ORDER BY count(*) FILTER (WHERE rank_new <= 20 AND rank_old > 20) DESC
   LIMIT 3
)
SELECT s.username, s.media_type,
       CASE WHEN s.rank_new <= 20 THEN 'ENTERS' ELSE 'leaves' END AS move,
       s.rank_old, s.rank_new, s.title,
       round(s.rec_s, 2) AS recency, round(s.pop_s, 2) AS popularity,
       round(s.sim_s, 2) AS taste
  FROM sim s
  JOIN worst w ON w.run_id = s.run_id
 WHERE (s.rank_new <= 20) <> (s.rank_old <= 20)
 ORDER BY s.username, s.media_type, s.rank_new
 LIMIT 60;


\echo ''
\echo '=== 5. AGGREGATE -- read AFTER the per-viewer rows above, never instead ==='
\echo 'F-067: a per-user figure averaged across users can show a trend present'
\echo 'in no user. This line is a summary of report 3, not a substitute for it.'
\echo ''

SELECT
  media_type,
  count(*) AS runs,
  round(avg(entered), 1) AS avg_into_top50,
  min(entered) AS min_into_top50,
  max(entered) AS max_into_top50
FROM (
  SELECT run_id, media_type,
         count(*) FILTER (WHERE rank_new <= 50 AND rank_old > 50) AS entered
    FROM sim GROUP BY run_id, media_type
) per_run
GROUP BY media_type;
