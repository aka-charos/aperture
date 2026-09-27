-- Migration: 0187_social_recommendations
-- Description: A title one user recommends to another.
--
-- "Watched" is deliberately NOT stored: the inbox derives it at read time from
-- watch_history.played with the poster badge's rule, so it can never drift from
-- what the rest of the app calls finished.

CREATE TABLE IF NOT EXISTS social_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  movie_id UUID REFERENCES movies(id) ON DELETE CASCADE,
  series_id UUID REFERENCES series(id) ON DELETE CASCADE,
  -- Bumped on every (re)send. The inbox orders by it, so a re-recommendation
  -- returns to the top.
  recommended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = live. Set by the recipient's dismiss, cleared by a re-send.
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT social_recommendations_item_shape CHECK (
    (media_type = 'movie'  AND movie_id IS NOT NULL AND series_id IS NULL) OR
    (media_type = 'series' AND series_id IS NOT NULL AND movie_id IS NULL)
  ),
  CONSTRAINT social_recommendations_no_self CHECK (recommender_user_id <> recipient_user_id)
);

-- One row per (recommender, recipient, item); a re-send upserts it. The
-- conflict target in core social/recommendations.ts repeats this expression
-- exactly, which is what lets Postgres infer the index.
CREATE UNIQUE INDEX IF NOT EXISTS social_recommendations_one_per_item
  ON social_recommendations (recommender_user_id, recipient_user_id, media_type,
                             COALESCE(movie_id, series_id));

-- The inbox read: one recipient's live rows, newest first.
CREATE INDEX IF NOT EXISTS idx_social_recommendations_inbox
  ON social_recommendations (recipient_user_id, recommended_at DESC)
  WHERE dismissed_at IS NULL;
