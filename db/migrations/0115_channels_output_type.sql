-- Migration: 0115_channels_output_type
-- Description: Let a channel target an Emby Collection (Box Set) instead of a Playlist

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS output_type TEXT NOT NULL DEFAULT 'playlist'
    CHECK (output_type IN ('playlist', 'collection')),
  ADD COLUMN IF NOT EXISTS collection_id TEXT;

CREATE INDEX IF NOT EXISTS idx_channels_output_type ON channels (output_type);

COMMENT ON COLUMN channels.output_type IS 'Where Generate writes: a personal Playlist or a server-wide Collection (Box Set)';
COMMENT ON COLUMN channels.collection_id IS 'Media server Collection (Box Set) id, parallel to playlist_id, for output_type = collection';
