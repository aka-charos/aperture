-- Migration: 0118_series_tmdb_totals
-- Description: Cache TMDB aired episode/season totals on series so the UI can
-- show progress against the full series, not just episodes on the media server

ALTER TABLE series
  ADD COLUMN tmdb_total_episodes INTEGER,
  ADD COLUMN tmdb_total_seasons INTEGER,
  ADD COLUMN tmdb_totals_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN series.tmdb_total_episodes IS 'Total aired episodes per TMDB (may exceed episodes available on the media server)';
COMMENT ON COLUMN series.tmdb_total_seasons IS 'Total seasons per TMDB';
COMMENT ON COLUMN series.tmdb_totals_synced_at IS 'When TMDB totals were last fetched (also stamped on failed lookups to avoid re-fetching dead ids)';
