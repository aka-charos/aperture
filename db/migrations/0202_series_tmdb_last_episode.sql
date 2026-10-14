-- Migration: 0202_series_tmdb_last_episode
-- Description: Keep TMDb's last aired episode on the series row, so the
-- dashboard's episode row can show a show whose latest episodes aired recently
-- and that has nothing scheduled soon.
--
-- The media server only knows the episodes it holds, so a season it has not
-- picked up yet is invisible there; TMDb's last_episode_to_air is not. It
-- arrives on the same /tv/{id} response that already refreshes
-- tmdb_total_episodes and tmdb_seasons, so it costs no extra request.
--
-- NULL means never asked (the totals refresh fills it), '{}' means TMDb lists
-- no aired episode.

ALTER TABLE series
  ADD COLUMN IF NOT EXISTS tmdb_last_episode JSONB;

COMMENT ON COLUMN series.tmdb_last_episode IS 'TMDb last_episode_to_air: {season_number, episode_number, name, air_date}, or {} when TMDb lists none. Refreshed with tmdb_total_episodes.';
