-- Export the written recommendation explanations with everything around them,
-- one JSON object per line, for reading outside the app. Read-only.
--
-- Three kinds of line:
--   viewer       the taste block each explanation writer opened its prompt with
--                (top genres, the ten favourites, the Watcher Identity)
--   analysis     a pick's stored title analysis; the writer saw only its
--                work/tradition paragraphs, clipped to 350 characters each
--   explanation  the text; the pick; its evidence rows with similarity, stored
--                decision-model verdict and any pair label; the decision
--                model's four explanation checks; any explanation label
--
-- What the WRITER saw of each title is narrower than what is exported here:
-- for the pick, genres, up to 3 directors (films only), the first 10 keywords,
-- network/status (series only) and 600 characters of plot; for each evidence
-- title, only title, year, favourite/watched and 220 characters of plot.
-- The extra fields are here so a claim can be checked against the truth.
--
-- Viewers are numbered, never named. A taste twin's donor is not exported.
--
-- On the Docker host (cmd.exe), from the folder holding this file:
--   docker cp export-explanation-checks.sql aperture-db:/tmp/x.sql
--   docker exec aperture-db psql -U app -d aperture -At -f /tmp/x.sql > explanations.jsonl

WITH latest AS (
  SELECT DISTINCT ON (user_id, media_type) id, media_type, user_id, created_at
  FROM recommendation_runs
  WHERE status = 'completed' AND channel_id IS NULL
  ORDER BY user_id, media_type, created_at DESC
),
viewers AS (
  SELECT user_id, dense_rank() OVER (ORDER BY user_id) AS viewer
  FROM (SELECT DISTINCT user_id FROM latest) u
),
titles AS NOT MATERIALIZED (
  SELECT 'movie'::text AS media_type, m.id, json_build_object(
           'title', m.title, 'year', m.year, 'genres', m.genres,
           'directors', m.directors, 'franchise', m.collection_name,
           'keywords', m.keywords[1:20], 'overview', left(m.overview, 1500)) AS facts
  FROM movies m
  UNION ALL
  SELECT 'series'::text, s.id, json_build_object(
           'title', s.title, 'year', s.year, 'genres', s.genres,
           'creators', COALESCE(NULLIF(s.directors, '{}'::text[]), s.tmdb_creators, '{}'::text[]),
           'network', s.network, 'status', s.status,
           'keywords', s.keywords[1:20], 'overview', left(s.overview, 1500))
  FROM series s
),
picks AS (
  SELECT rc.id AS candidate_id, l.media_type, v.viewer, l.created_at AS run_at,
         COALESCE(rc.movie_id, rc.series_id) AS pick_id,
         rc.selected_rank, rc.final_score, rc.similarity_score, rc.novelty_score, rc.rating_score,
         rc.score_breakdown, rc.ai_explanation,
         left(encode(sha256(convert_to(btrim(rc.ai_explanation, E' \t\r\n'), 'UTF8')), 'hex'), 40) AS hash
  FROM latest l
  JOIN viewers v ON v.user_id = l.user_id
  JOIN recommendation_candidates rc ON rc.run_id = l.id AND rc.is_selected = true
  WHERE rc.ai_explanation IS NOT NULL AND length(trim(rc.ai_explanation)) > 0
),
viewer_lines AS (
  SELECT json_build_object(
           'kind', 'viewer', 'viewer', v.viewer, 'media_type', 'movie',
           'titles_in_taste', (SELECT count(*) FROM watch_history wh
                               WHERE wh.user_id = v.user_id AND wh.movie_id IS NOT NULL
                                 AND (wh.played = true OR wh.is_favorite = true)),
           'top_genres', (SELECT json_agg(g.genre ORDER BY g.n DESC) FROM (
               SELECT unnest(m.genres) AS genre, count(*) AS n
               FROM watch_history wh JOIN movies m ON m.id = wh.movie_id
               WHERE wh.user_id = v.user_id AND (wh.played = true OR wh.is_favorite = true)
               GROUP BY 1 ORDER BY 2 DESC LIMIT 8) g),
           'favourites', (SELECT json_agg(f.t ORDER BY f.ord) FROM (
               SELECT m.title || ' (' || COALESCE(m.year::text, 'N/A') || ')' AS t,
                      row_number() OVER (ORDER BY wh.is_favorite DESC, wh.play_count DESC,
                                                  wh.last_played_at DESC NULLS LAST) AS ord
               FROM watch_history wh JOIN movies m ON m.id = wh.movie_id
               WHERE wh.user_id = v.user_id AND (wh.played = true OR wh.is_favorite = true)
               ORDER BY ord LIMIT 10) f),
           'taste_profile', (SELECT up.taste_synopsis FROM user_preferences up WHERE up.user_id = v.user_id)
         )::text AS line,
         1 AS part, v.viewer, 'movie'::text AS media_type, 0 AS selected_rank
  FROM viewers v
  WHERE EXISTS (SELECT 1 FROM latest l WHERE l.user_id = v.user_id AND l.media_type = 'movie')
  UNION ALL
  SELECT json_build_object(
           'kind', 'viewer', 'viewer', v.viewer, 'media_type', 'series',
           'titles_in_taste', (SELECT count(DISTINCT e.series_id) FROM watch_history wh
                               JOIN episodes e ON e.id = wh.episode_id
                               WHERE wh.user_id = v.user_id AND wh.media_type = 'episode'
                                 AND (wh.played = true OR wh.is_favorite = true)),
           'top_genres', (SELECT json_agg(g.genre ORDER BY g.n DESC) FROM (
               SELECT unnest(s.genres) AS genre, count(*) AS n
               FROM watch_history wh
               JOIN episodes e ON e.id = wh.episode_id
               JOIN series s ON s.id = e.series_id
               WHERE wh.user_id = v.user_id AND wh.media_type = 'episode'
                 AND (wh.played = true OR wh.is_favorite = true)
               GROUP BY 1 ORDER BY 2 DESC LIMIT 8) g),
           'favourites', (SELECT json_agg(f.t ORDER BY f.ord) FROM (
               SELECT s.title || ' (' || COALESCE(s.year::text, 'N/A') || ')' AS t,
                      row_number() OVER (ORDER BY count(wh.id) DESC,
                                                  max(wh.last_played_at) DESC NULLS LAST) AS ord
               FROM watch_history wh
               JOIN episodes e ON e.id = wh.episode_id
               JOIN series s ON s.id = e.series_id
               WHERE wh.user_id = v.user_id AND wh.media_type = 'episode'
                 AND (wh.played = true OR wh.is_favorite = true)
               GROUP BY s.id, s.title, s.year
               ORDER BY ord LIMIT 10) f),
           'taste_profile', (SELECT up.series_taste_synopsis FROM user_preferences up WHERE up.user_id = v.user_id)
         )::text,
         1, v.viewer, 'series'::text, 0
  FROM viewers v
  WHERE EXISTS (SELECT 1 FROM latest l WHERE l.user_id = v.user_id AND l.media_type = 'series')
),
analysis_lines AS (
  SELECT json_build_object(
           'kind', 'analysis', 'media_type', a.media_type, 'pick_id', a.pick_id,
           'title', (SELECT t.facts->>'title' FROM titles t WHERE t.media_type = a.media_type AND t.id = a.pick_id),
           'analysis', left(ta.analysis, 4000)
         )::text AS line,
         2 AS part, 0::bigint AS viewer, a.media_type, 0 AS selected_rank
  FROM (SELECT DISTINCT media_type, pick_id FROM picks) a
  JOIN title_analysis ta ON ta.media_type = a.media_type AND ta.media_id = a.pick_id
  WHERE ta.analysis IS NOT NULL
),
explanation_lines AS (
  SELECT json_build_object(
           'kind', 'explanation',
           'hash', p.hash,
           'media_type', p.media_type,
           'viewer', p.viewer,
           'run_at', p.run_at,
           'rank', p.selected_rank,
           'pick_id', p.pick_id,
           'scores', json_build_object('final', p.final_score, 'similarity', p.similarity_score,
                                       'novelty', p.novelty_score, 'rating', p.rating_score),
           'interest', p.score_breakdown->'interestMatch'->>'interestText',
           'interest_slot', COALESCE(jsonb_typeof(p.score_breakdown->'interestMatch'), 'null') <> 'null',
           'twin_slot', COALESCE(jsonb_typeof(p.score_breakdown->'twinMatch'), 'null') <> 'null',
           'acclaimed_slot', COALESCE(jsonb_typeof(p.score_breakdown->'acclaimedMatch'), 'null') <> 'null',
           'twin_shared', (
             SELECT json_agg(t.facts->>'title' ORDER BY y.ord)
             FROM (
               SELECT x.id::uuid AS id, x.ord
               FROM jsonb_array_elements_text(
                      CASE WHEN jsonb_typeof(p.score_breakdown->'twinMatch'->'sharedIds') = 'array'
                           THEN p.score_breakdown->'twinMatch'->'sharedIds' ELSE '[]'::jsonb END
                    ) WITH ORDINALITY AS x(id, ord)
               WHERE x.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             ) y
             JOIN titles t ON t.media_type = p.media_type AND t.id = y.id),
           'pick', (SELECT t.facts FROM titles t WHERE t.media_type = p.media_type AND t.id = p.pick_id),
           'evidence', (
             SELECT json_agg(json_build_object(
                      'similarity', re.similarity,
                      'type', re.evidence_type,
                      'verdict', re.judged_connection,
                      'verdict_model', re.judged_model,
                      'your_label', el.label,
                      'facts', t.facts) ORDER BY re.similarity DESC)
             FROM recommendation_evidence re
             JOIN titles t ON t.media_type = p.media_type
                          AND t.id = COALESCE(re.similar_movie_id, re.similar_series_id)
             LEFT JOIN evidence_labels el ON el.media_type = p.media_type AND el.pick_id = p.pick_id
                                         AND el.watched_id = COALESCE(re.similar_movie_id, re.similar_series_id)
             WHERE re.candidate_id = p.candidate_id),
           'explanation', p.ai_explanation,
           'check', (
             SELECT json_build_object(
                      'heading', c.heading,
                      'context_as_reason', c.claims_context_as_reason,
                      'unsupported_link', c.unsupported_link,
                      'invented_fact', c.invented_fact,
                      'spoiler', c.spoiler,
                      'model', c.answered_model,
                      'checked_at', c.checked_at)
             FROM explanation_checks c WHERE c.explanation_hash = p.hash),
           'label', (SELECT l.label FROM explanation_labels l WHERE l.explanation_hash = p.hash)
         )::text AS line,
         3 AS part, p.viewer, p.media_type, p.selected_rank
  FROM picks p
)
SELECT line FROM (
  SELECT * FROM viewer_lines
  UNION ALL SELECT * FROM analysis_lines
  UNION ALL SELECT * FROM explanation_lines
) x
ORDER BY part, viewer, media_type, selected_rank;
