-- Migration: 0222_episode_number_end
-- Description: The last episode number a media-server item covers, so a double-length
-- episode kept as one file ("S05E01-E02") counts as the two episodes it is.

ALTER TABLE episodes ADD COLUMN episode_number_end INTEGER;

COMMENT ON COLUMN episodes.episode_number_end IS 'Last episode number this item covers (the media server''s IndexNumberEnd), only when past episode_number; NULL = this one episode. Filled by the next TV sync.';
