-- Migration: 0120_series_tmdb_status
-- Description: Cache TMDB series status ("Returning Series", "Ended", "Canceled", ...)
-- to correct stale media-server status when deciding whether a show is still airing

ALTER TABLE series
  ADD COLUMN tmdb_status TEXT;

COMMENT ON COLUMN series.tmdb_status IS 'Series status per TMDB — refreshed together with tmdb_total_episodes; overrides stale media-server status for airing checks';
