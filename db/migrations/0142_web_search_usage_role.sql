-- Record WHICH ROLE spent a grounding request.
--
-- `web_search_usage` was written when exactly one role spent Gemini grounding
-- quota: `webSearch`, behind the assistant's discovery. A second role now does
-- (`titleAnalysis`, generating per-title critical analysis), deliberately with
-- its own credentials so a batch of analyses cannot eat the quota chat needs.
--
-- Without this column the meter reports one number covering both consumers and
-- cannot answer the only question worth asking when grounding stops working:
-- which of them exhausted the day. The counters are already broken out per key
-- slot for the same reason one level down — a fallback key's spend must not
-- make the primary's meter look full — and the role is the level above that.
--
-- Existing rows are all `webSearch` by construction, which is what the default
-- backfills them as. It stays as the column default so an un-migrated caller
-- writes something true rather than NULL.

ALTER TABLE web_search_usage
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'webSearch';

-- The summary groups by (role, key_slot) within a day window, so the role has
-- to lead the index for it to be usable.
CREATE INDEX IF NOT EXISTS idx_web_search_usage_role_created
  ON web_search_usage (role, created_at DESC);

COMMENT ON COLUMN web_search_usage.role IS
  'AI role that spent the request: webSearch | titleAnalysis. Quotas are per key, and the two roles hold different keys.';
