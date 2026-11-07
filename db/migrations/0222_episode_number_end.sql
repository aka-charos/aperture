-- Migration: 0222_episode_number_end
-- Description: The last episode number a media-server item covers, so a double-length
-- episode kept as one file ("S05E01-E02") counts as the two episodes it is.

ALTER TABLE episodes ADD COLUMN episode_number_end INTEGER;
ALTER TABLE episodes ADD COLUMN episode_number_end_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN episodes.episode_number_end IS 'Last episode number this item covers (the media server''s IndexNumberEnd), only when past episode_number; NULL = this one episode. Filled by the next TV sync.';
COMMENT ON COLUMN episodes.episode_number_end_changed_at IS 'When the sync last changed episode_number_end on an existing row (updated_at is restamped every sync, so it cannot say this). Lets gap analysis say a scan predates a changed range.';
