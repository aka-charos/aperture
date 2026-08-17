-- Record WHICH ROLE spent a grounding request.
--
-- The counters are already broken out per key slot one level down — a fallback
-- key's spend must not make the primary's meter look full — and the role is the
-- level above that: when grounding stops working, the only question worth
-- asking is which consumer exhausted the day.
--
-- HONEST NOTE ON WHY THIS EXISTS. It was added for a second grounding role,
-- `titleAnalysis`, which was then rebuilt to retrieve through a self-hosted
-- endpoint and no longer spends Google quota at all — so `webSearch` is the
-- only value written today. It is kept rather than reverted because a
-- self-hosted grounding source is planned as a second consumer for discovery,
-- because `channels/webExpand.ts` already spends this quota on a path the meter
-- cannot currently distinguish from chat, and because a TEXT column with a
-- default is not worth a revert. If neither of those lands, this column is dead
-- weight and should be dropped rather than explained away again.
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
  'AI role that spent the grounding request. Currently always webSearch; quotas are per key, so a second grounding consumer would need its own value here to be meterable.';
