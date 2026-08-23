-- Raise the taste-profile sample size.
--
-- recentWatchLimit caps how many watched titles are averaged into the taste
-- vector. At 50, a viewer with 3,498 plays was described by 50 of them -- and
-- because the ordering is favourites, then play count, then recency, the part
-- dropped was the least-engaged tail, which is exactly the breadth a centroid
-- needs to stop collapsing toward the library mean.
--
-- GREATEST, not a plain assignment: an admin who already raised this above 200
-- made a deliberate choice and keeps it.
--
-- scoring_updated_at is bumped ON PURPOSE, unlike the max-candidates clamp.
-- That one could not change a single pick; this one moves every taste vector,
-- so the activity gate SHOULD regenerate. The WHERE guard keeps that honest --
-- an instance already at or above 200 changes nothing and triggers nothing.

ALTER TABLE recommendation_config
  ALTER COLUMN movie_recent_watch_limit SET DEFAULT 200,
  ALTER COLUMN series_recent_watch_limit SET DEFAULT 200;

UPDATE recommendation_config
SET movie_recent_watch_limit = GREATEST(movie_recent_watch_limit, 200),
    series_recent_watch_limit = GREATEST(series_recent_watch_limit, 200),
    scoring_updated_at = NOW()
WHERE id = 1
  AND (movie_recent_watch_limit < 200 OR series_recent_watch_limit < 200);

COMMENT ON COLUMN recommendation_config.movie_recent_watch_limit IS
  'Watched movies averaged into the taste vector, favourites first. Fetched in one query, so the cost is roughly flat in this number.';
