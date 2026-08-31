-- Keep what an evaluation measured, so two runs can be compared without
-- racing the job log.
--
-- WHY A TABLE AND NOT A FILE. The whole report is written through addLog, and
-- the log is trimmed twice on the way out (live to 500 entries, stored to 300).
-- A run with 14 seeds emits ~450 entries per embedding set, so a two-set
-- comparison loses one of the two summary tables every time -- which is
-- precisely the half the run was for. A file in the container would answer
-- that and then vanish on the next recreate; these rows are also what makes
-- "merge several runs into one sheet" a query rather than a concatenation.
--
-- Nothing prunes these on purpose. A run is ~450 rows across both detail
-- tables, so a hundred runs is 45k rows, and accumulating them across models
-- and seed sets is the entire point.

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Which job wrote it, so a row can be traced back to a console log while
  -- that log still exists.
  job_id TEXT,
  media_type TEXT NOT NULL,
  -- The embedding set id, mode and provider pin included. This is the column
  -- the whole feature exists to put beside a number.
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  -- Ranked population. Two sets over different pool sizes are not comparable;
  -- storing it means a later reader can see that without being told.
  pool_size INTEGER NOT NULL,
  holdout_size INTEGER NOT NULL,
  qualified_users INTEGER NOT NULL,
  skipped_users INTEGER NOT NULL,
  -- The seeds as requested, not as resolved: a seed that matched nothing is
  -- part of what the run was asked to do.
  seed_titles TEXT[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_created ON evaluation_runs(created_at DESC);

-- One row per (variant, scope). Long rather than wide, because the scopes are
-- three different populations -- everyone, a history bucket, one viewer -- and
-- a wide row would need a column per viewer.
CREATE TABLE IF NOT EXISTS evaluation_metrics (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  -- 'overall' | 'history_bucket' | 'viewer'
  scope TEXT NOT NULL,
  -- '' for overall, the bucket label, or the username.
  scope_label TEXT NOT NULL DEFAULT '',
  users INTEGER NOT NULL,
  test_items INTEGER NOT NULL,
  median_percentile NUMERIC(6,4),
  ndcg_20 NUMERIC(6,4),
  ndcg_100 NUMERIC(6,4),
  ndcg_500 NUMERIC(6,4),
  recall_20 NUMERIC(6,4),
  recall_100 NUMERIC(6,4),
  recall_500 NUMERIC(6,4)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_metrics_run ON evaluation_metrics(run_id);

-- One row per neighbour, so a dump can be sorted, filtered and diffed against
-- another model's dump on (seed_title, variant, rank).
CREATE TABLE IF NOT EXISTS evaluation_neighbours (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  seed_id TEXT NOT NULL,
  seed_title TEXT NOT NULL,
  seed_year INTEGER,
  seed_countries TEXT NOT NULL DEFAULT '',
  -- 'raw' | 'centered'
  variant TEXT NOT NULL,
  -- Recomputable from the rows, stored anyway so one row of the CSV answers
  -- the nationality question without a pivot.
  same_country_share NUMERIC(5,4),
  neighbour_rank INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  countries TEXT NOT NULL DEFAULT '',
  genres TEXT NOT NULL DEFAULT '',
  cosine NUMERIC(9,6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evaluation_neighbours_run ON evaluation_neighbours(run_id);
