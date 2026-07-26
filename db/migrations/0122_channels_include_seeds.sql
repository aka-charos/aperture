-- Migration: 0122_channels_include_seeds
-- Description: Let a channel put its own seed titles into the generated playlist/collection

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS include_seeds BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN channels.include_seeds IS 'When true, the channel seeds (example_movie_ids/example_series_ids) are written into the output alongside the generated picks. Defaults to false so existing channels are unchanged';
