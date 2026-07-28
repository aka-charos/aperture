-- Per-call usage log for the Web Search (Google Gemini grounding) role.
-- Gemini's free tier is metered per minute (requests + tokens) and per day
-- (requests, resetting at midnight US/Pacific), so the counters have to survive
-- an API restart — hence a table rather than an in-memory counter.
--
-- One row per generation attempt, including the ones that came back 429, so the
-- admin panel can show "you are being rate limited" and not just "nothing ran".
-- Rows are pruned to a few days; this is a rolling meter, not an audit log.

CREATE TABLE IF NOT EXISTS web_search_usage (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'google',
  model TEXT NOT NULL,
  key_slot TEXT NOT NULL,
  status TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_search_usage_created
  ON web_search_usage (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_web_search_usage_slot_created
  ON web_search_usage (key_slot, created_at DESC);

COMMENT ON TABLE web_search_usage IS 'One row per Web Search (Gemini grounding) call, for free-tier rate-limit tracking';
COMMENT ON COLUMN web_search_usage.key_slot IS 'Which API key served the call: primary or fallback';
COMMENT ON COLUMN web_search_usage.status IS 'ok | rate_limited | error';
COMMENT ON COLUMN web_search_usage.total_tokens IS 'Provider-reported total tokens; 0 when the call failed before billing';
