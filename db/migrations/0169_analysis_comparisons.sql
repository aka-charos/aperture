-- Model bench for title analysis.
--
-- Choosing a model for the titleAnalysis role means reading several models'
-- prose about the same film and deciding which is better. Doing that by hand
-- means re-running one title per model and comparing rows written minutes
-- apart, from SEPARATE retrievals — so the sources differ between the runs and
-- a difference in the output cannot be attributed to the model, the prompt or
-- the pages. This stores one bench run: sources retrieved ONCE, one prompt
-- built from them, and every model's answer to that identical prompt.
--
-- Stored rather than kept in memory for the reason 0156 gives for evaluation
-- runs: a container file dies on the next recreate, which is exactly when the
-- change being measured gets deployed, and a local model can take 45 minutes
-- per entry. Nothing prunes, deliberately — a bench is a record of a decision.
--
-- It deliberately does NOT touch title_analysis. A comparison is a measurement,
-- not a generation, and writing the winner into the cache would both retire the
-- title and make the bench unrepeatable.

CREATE TABLE IF NOT EXISTS analysis_comparison_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Same shape as title_analysis, and no foreign key for the same reason: this
  -- references movies.id OR series.id depending on media_type, which Postgres
  -- cannot express.
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  media_id UUID NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,

  status TEXT NOT NULL DEFAULT 'running',
  -- Why the whole run failed — retrieval refused, no sources, provider
  -- unconfigured. A per-model failure lives on the result row instead, since
  -- one model dying must not fail the bench.
  error TEXT,

  -- THE POINT OF THE TABLE. Every result below answered this exact string, so
  -- a difference between two results is a difference between two models. Kept
  -- in full rather than as a hash: reading what the model was actually asked is
  -- half of judging the answer, and it is what makes the prompt itself
  -- reviewable rather than only the models.
  prompt TEXT,
  prompt_version INTEGER NOT NULL,

  source_count INTEGER,
  retrieved_chars INTEGER,
  -- [{ "title": "...", "domain": "...", "url": "...", "chars": 1234 }]
  sources JSONB,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analysis_comparison_runs_started
  ON analysis_comparison_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS analysis_comparison_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES analysis_comparison_runs(id) ON DELETE CASCADE,

  -- The order the operator listed the models in, preserved so the report reads
  -- the same way twice. Not a ranking.
  position INTEGER NOT NULL,

  provider TEXT NOT NULL,
  model TEXT NOT NULL,

  -- pending | ok | unusable | error, mirroring AttemptOutcome plus a row
  -- written before the model has been reached, so the UI can show what is still
  -- queued rather than an empty list.
  status TEXT NOT NULL DEFAULT 'pending',

  analysis TEXT,
  -- The closing SOURCES grade, and the paragraph map, both exactly as the
  -- generation path reads them: a model that cannot hold the output contract is
  -- a finding about that model, so these are recorded rather than repaired.
  grade TEXT,
  map_text TEXT,
  paragraph_map JSONB,
  -- Which contract check rejected it: truncated | reasoning_only |
  -- no_begin_marker | no_contract_line. Null when the answer was usable.
  problem TEXT,
  finish_reason TEXT,

  input_tokens INTEGER,
  output_tokens INTEGER,
  -- Split out because a reasoning model billing its scratchpad from the same
  -- allowance as the prose is the measured cause of a truncated analysis, and
  -- it is invisible in a total.
  reasoning_tokens INTEGER,
  duration_ms INTEGER,

  error TEXT,

  UNIQUE (run_id, position)
);

CREATE INDEX IF NOT EXISTS idx_analysis_comparison_results_run
  ON analysis_comparison_results (run_id, position);
