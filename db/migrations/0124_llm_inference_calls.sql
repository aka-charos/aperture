-- Per-call inference log, the data behind the AI spend dashboard.
--
-- The cost estimator projects what a configuration *should* cost from published
-- per-million prices and guessed call volumes. This table records what actually
-- happened: one row per upstream request, with the token counts and — for
-- OpenRouter, which returns a `usage` object carrying real credits spent on
-- every response — the true cost of that call.
--
-- Rows are attributed three ways so the dashboard can answer "what is spending
-- my money": `role` (which AI function made the call), `feature` (the job or
-- surface it ran under, e.g. `job:generate-movie-recommendations` or
-- `assistant.chat`) and `session_id` (the assistant conversation, when there is
-- one). Failed calls are recorded too — an error rate is part of the picture,
-- and a 402 for insufficient credit is exactly what an admin needs to see.
--
-- This is an audit log with a long window, not a rolling meter like
-- web_search_usage: month-over-month spend is the point, so retention is
-- generous and pruning is by age only.

CREATE TABLE IF NOT EXISTS llm_inference_calls (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT,
  feature TEXT,
  session_id TEXT,
  -- SET NULL, not CASCADE: deleting a user must not rewrite spend history.
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  generation_id TEXT,
  upstream_provider TEXT,
  status TEXT NOT NULL,
  status_code INTEGER,
  streamed BOOLEAN NOT NULL DEFAULT FALSE,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC(16, 10),
  upstream_cost NUMERIC(16, 10),
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_inference_calls_created
  ON llm_inference_calls (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_inference_calls_provider_created
  ON llm_inference_calls (provider, created_at DESC);

-- Partial: most rows have no session, and the sessions view only ever asks for
-- the ones that do.
CREATE INDEX IF NOT EXISTS idx_llm_inference_calls_session
  ON llm_inference_calls (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

COMMENT ON TABLE llm_inference_calls IS 'One row per LLM request, with provider-reported tokens and (OpenRouter) real cost';
COMMENT ON COLUMN llm_inference_calls.role IS 'AI function that made the call: embeddings | chat | textGeneration | exploration | webSearch';
COMMENT ON COLUMN llm_inference_calls.feature IS 'Surface or job the call ran under, e.g. assistant.chat or job:generate-movie-embeddings';
COMMENT ON COLUMN llm_inference_calls.session_id IS 'Assistant conversation id, when the call belongs to one';
COMMENT ON COLUMN llm_inference_calls.status IS 'ok | error';
COMMENT ON COLUMN llm_inference_calls.cost IS 'USD actually charged, as reported by the provider. NULL when the provider does not report cost';
COMMENT ON COLUMN llm_inference_calls.upstream_cost IS 'OpenRouter cost_details.upstream_inference_cost — what the underlying provider charged (BYOK)';
COMMENT ON COLUMN llm_inference_calls.cached_tokens IS 'Prompt tokens served from cache; billed at a lower rate and worth watching';
