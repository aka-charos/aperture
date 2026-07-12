-- Migration: 0119_series_tmdb_seasons
-- Description: Cache TMDB's per-season breakdown so the UI can flag seasons
-- that have aired but are missing entirely from the media server

ALTER TABLE series
  ADD COLUMN tmdb_seasons JSONB;

COMMENT ON COLUMN series.tmdb_seasons IS 'Per-season data from TMDB: [{season_number, episode_count, air_date}] — refreshed together with tmdb_total_episodes';
