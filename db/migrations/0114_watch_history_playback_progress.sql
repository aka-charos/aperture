-- Migration: 0114_watch_history_playback_progress
-- Description: Track playback progress for partial-watch exclusion in recommendations

ALTER TABLE watch_history
  ADD COLUMN IF NOT EXISTS played BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS playback_position_ticks BIGINT,
  ADD COLUMN IF NOT EXISTS runtime_ticks BIGINT;

-- Existing rows came from fully played Emby items (IsPlayed=true)
UPDATE watch_history
SET played = true
WHERE play_count > 0 OR last_played_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_watch_history_excludable
  ON watch_history (user_id, media_type)
  WHERE played = true
     OR (playback_position_ticks IS NOT NULL AND playback_position_ticks > 0);

COMMENT ON COLUMN watch_history.played IS 'Whether the user fully completed this title on the media server';
COMMENT ON COLUMN watch_history.playback_position_ticks IS 'Resume position from media server UserData.PlaybackPositionTicks';
COMMENT ON COLUMN watch_history.runtime_ticks IS 'Runtime in ticks at sync time, used to compute progress percentage';
