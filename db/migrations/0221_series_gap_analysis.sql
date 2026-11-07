-- Migration: 0221_series_gap_analysis
-- Description: TV gap analysis: which aired seasons the library lacks, per show;
-- and which seasons a request asked for.

CREATE TABLE gap_analysis_series_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,

  shows_total INTEGER NOT NULL DEFAULT 0,
  shows_scanned INTEGER NOT NULL DEFAULT 0,
  shows_listed INTEGER NOT NULL DEFAULT 0,
  shows_numbering_differs INTEGER NOT NULL DEFAULT 0,
  shows_not_on_tmdb INTEGER NOT NULL DEFAULT 0,
  lookups_failed INTEGER NOT NULL DEFAULT 0,
  shows_without_tmdb_id INTEGER NOT NULL DEFAULT 0,

  aired_seasons INTEGER NOT NULL DEFAULT 0,
  owned_seasons INTEGER NOT NULL DEFAULT 0,
  missing_seasons INTEGER NOT NULL DEFAULT 0,
  partial_seasons INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_gap_analysis_series_runs_status ON gap_analysis_series_runs(status, completed_at DESC);

COMMENT ON TABLE gap_analysis_series_runs IS 'Snapshot runs comparing TMDb aired seasons with the episodes the library holds';

CREATE TABLE gap_analysis_series_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES gap_analysis_series_runs(id) ON DELETE CASCADE,

  tmdb_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  poster_path TEXT,
  networks TEXT[] NOT NULL DEFAULT '{}',
  numbering_differs BOOLEAN NOT NULL DEFAULT FALSE,
  seasons JSONB NOT NULL,

  CONSTRAINT gap_analysis_series_results_run_tmdb UNIQUE (run_id, tmdb_id)
);

COMMENT ON TABLE gap_analysis_series_results IS 'One row per show with a season gap in a run; complete shows store nothing';
COMMENT ON COLUMN gap_analysis_series_results.networks IS 'TMDb networks; the media server network only when TMDb lists none';
COMMENT ON COLUMN gap_analysis_series_results.numbering_differs IS 'The library and TMDb number this show''s seasons differently, so its gaps cannot be trusted';
COMMENT ON COLUMN gap_analysis_series_results.seasons IS 'Every aired regular season: {seasonNumber, airDate, posterPath, airedEpisodes, heldEpisodes, holding, seerrStatus}';

ALTER TABLE discovery_requests ADD COLUMN seasons INTEGER[];

COMMENT ON COLUMN discovery_requests.seasons IS 'Seasons this series request asked for; NULL = the whole show, or not a series';
