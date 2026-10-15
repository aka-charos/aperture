-- Activity gate check: for every viewer and media type, what would make their
-- next scheduled recommendation run regenerate, or empty if the gate would skip.
-- Lists EVERY reason that applies (the gate stops at the first). Mirrors
-- readSignals in packages/core/src/recommender/activityGate.ts; the count
-- expressions are generated from recommender/gateCounts.ts and pinned against
-- it by gateCounts.test.ts. Not covered: the embedding half of new-candidates.
WITH last AS (
  SELECT DISTINCT ON (user_id, media_type) id, user_id, media_type, created_at, input_counts, output_counts
    FROM recommendation_runs
   WHERE status = 'completed'
   ORDER BY user_id, media_type, created_at DESC
), cfg AS (
  SELECT movie_max_run_age_days, series_max_run_age_days,
         movie_new_candidate_threshold, series_new_candidate_threshold,
         (SELECT MAX(scoring_updated_at) FROM recommendation_config) AS config
    FROM recommendation_config LIMIT 1
), sig AS (
  SELECT r.*, u.username, cfg.config,
    CASE WHEN r.media_type = 'movie' THEN cfg.movie_max_run_age_days ELSE cfg.series_max_run_age_days END AS max_age,
    CASE WHEN r.media_type = 'movie' THEN cfg.movie_new_candidate_threshold ELSE cfg.series_new_candidate_threshold END AS threshold,
    CASE WHEN r.media_type = 'movie'
      THEN (SELECT MAX(updated_at) FROM watch_history w WHERE w.user_id = r.user_id AND w.media_type = 'movie')
      ELSE GREATEST(
        (SELECT MAX(updated_at) FROM watch_history w WHERE w.user_id = r.user_id AND w.media_type = 'episode'),
        (SELECT MAX(added_at) FROM user_watching_series s WHERE s.user_id = r.user_id))
    END AS watch_history,
    (SELECT MAX(updated_at) FROM user_ratings ur WHERE ur.user_id = r.user_id
        AND CASE WHEN r.media_type = 'movie' THEN ur.movie_id IS NOT NULL ELSE ur.series_id IS NOT NULL END) AS ratings,
    (SELECT GREATEST(auto_updated_at, user_modified_at) FROM user_taste_profiles tp
      WHERE tp.user_id = r.user_id AND tp.media_type = r.media_type) AS taste_profile,
    GREATEST(
      (SELECT MAX(updated_at) FROM user_preferences p WHERE p.user_id = r.user_id),
      (SELECT MAX(updated_at) FROM user_settings st WHERE st.user_id = r.user_id),
      (SELECT MAX(updated_at) FROM user_franchise_preferences f
        WHERE f.user_id = r.user_id AND (f.media_type = r.media_type OR f.media_type = 'both')),
      (SELECT MAX(updated_at) FROM user_genre_weights g WHERE g.user_id = r.user_id),
      (SELECT MAX(created_at) FROM user_custom_interests ci WHERE ci.user_id = r.user_id)
    ) AS preferences,
    CASE WHEN r.media_type = 'movie'
      THEN (SELECT COUNT(*) FROM movies m WHERE m.created_at > r.created_at)
      ELSE (SELECT COUNT(*) FROM series sr WHERE sr.created_at > r.created_at)
    END AS new_titles,
    CASE WHEN r.media_type = 'movie'
      THEN jsonb_build_object('watch_history', (SELECT COUNT(*) FROM watch_history WHERE user_id = r.user_id AND media_type = 'movie')::int, 'ratings', (SELECT COUNT(*) FROM user_ratings WHERE user_id = r.user_id AND movie_id IS NOT NULL)::int, 'taste_profile', (SELECT COUNT(*) FROM user_taste_profiles WHERE user_id = r.user_id AND media_type = 'movie')::int, 'preferences', (SELECT COUNT(*) FROM user_preferences WHERE user_id = r.user_id)::int, 'settings', (SELECT COUNT(*) FROM user_settings WHERE user_id = r.user_id)::int, 'franchise_preferences', (SELECT COUNT(*) FROM user_franchise_preferences WHERE user_id = r.user_id AND media_type IN ('movie', 'both'))::int, 'genre_weights', (SELECT COUNT(*) FROM user_genre_weights WHERE user_id = r.user_id)::int, 'custom_interests', (SELECT COUNT(*) FROM user_custom_interests WHERE user_id = r.user_id)::int)
      ELSE jsonb_build_object('watch_history', (SELECT COUNT(*) FROM watch_history WHERE user_id = r.user_id AND media_type = 'episode')::int, 'ratings', (SELECT COUNT(*) FROM user_ratings WHERE user_id = r.user_id AND series_id IS NOT NULL)::int, 'taste_profile', (SELECT COUNT(*) FROM user_taste_profiles WHERE user_id = r.user_id AND media_type = 'series')::int, 'preferences', (SELECT COUNT(*) FROM user_preferences WHERE user_id = r.user_id)::int, 'settings', (SELECT COUNT(*) FROM user_settings WHERE user_id = r.user_id)::int, 'franchise_preferences', (SELECT COUNT(*) FROM user_franchise_preferences WHERE user_id = r.user_id AND media_type IN ('series', 'both'))::int, 'genre_weights', (SELECT COUNT(*) FROM user_genre_weights WHERE user_id = r.user_id)::int, 'custom_interests', (SELECT COUNT(*) FROM user_custom_interests WHERE user_id = r.user_id)::int, 'watching_series', (SELECT COUNT(*) FROM user_watching_series WHERE user_id = r.user_id)::int)
    END AS cur_in,
    jsonb_build_object('picks', (SELECT COUNT(*) FROM recommendation_candidates WHERE run_id = r.id AND is_selected = true)::int, 'evidence', (SELECT COUNT(*) FROM recommendation_evidence e
         JOIN recommendation_candidates c ON c.id = e.candidate_id
        WHERE c.run_id = r.id AND c.is_selected = true)::int) AS cur_out
  FROM last r JOIN users u ON u.id = r.user_id CROSS JOIN cfg
)
SELECT username, media_type, created_at::timestamp(0) AS last_run,
  concat_ws(', ',
    CASE WHEN now() - created_at > make_interval(days => max_age) THEN 'max-age' END,
    CASE WHEN watch_history > created_at THEN 'watch-history' END,
    CASE WHEN ratings > created_at THEN 'ratings' END,
    CASE WHEN taste_profile > created_at THEN 'taste-profile' END,
    CASE WHEN preferences > created_at THEN 'preferences' END,
    CASE WHEN config > created_at THEN 'config' END,
    CASE WHEN input_counts IS NULL OR output_counts IS NULL THEN 'counts-unknown' END,
    (SELECT 'input-counts (' || string_agg(k.key || ' ' || k.value::text || ' -> ' || COALESCE(cur_in ->> k.key, '?'), ', ') || ')'
       FROM jsonb_each(input_counts) k WHERE (cur_in ->> k.key)::int IS DISTINCT FROM (k.value)::int),
    (SELECT 'output-counts (' || string_agg(k.key || ' ' || k.value::text || ' -> ' || COALESCE(cur_out ->> k.key, '?'), ', ') || ')'
       FROM jsonb_each(output_counts) k WHERE (cur_out ->> k.key)::int IS DISTINCT FROM (k.value)::int),
    CASE WHEN new_titles >= threshold THEN 'new-candidates (' || new_titles || ' titles)' END
  ) AS would_regenerate_because
FROM sig
ORDER BY media_type, username;
