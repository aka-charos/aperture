-- Migration: 0121_channels_series_support
-- Description: Let a channel (playlist/collection) include TV series, not just movies

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS example_series_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS media_types TEXT[] NOT NULL DEFAULT '{movie}'
    CHECK (media_types <@ ARRAY['movie', 'series']::TEXT[] AND array_length(media_types, 1) >= 1);

COMMENT ON COLUMN channels.example_series_ids IS 'Seed series defining the channel taste, parallel to example_movie_ids';
COMMENT ON COLUMN channels.media_types IS 'Which media the channel generates: movie, series, or both. Defaults to movie so existing channels are unchanged';
