-- Migration: 0184_account_access_is_explicit
-- Description: Account access becomes its own switch, the Assistant becomes a
-- permission, and Top Picks rows for accounts without access become optional.
--
-- `users.is_enabled` was DERIVED from the feature switches (0174): an account
-- could sign in while Movies, Series, Discover or Collections was on. So the only
-- way to shut someone out was to switch every feature off, which discarded how the
-- account was set up, and letting them back in meant remembering and re-ticking
-- all of it. It is now the admin's own decision, written only by an explicit
-- `isEnabled` (apps/api/src/lib/accountEnabled.ts says where derivation survives).
--
-- No row changes here: every stored value is already the derived one, which is
-- exactly the access each account has today. Only the rule for FUTURE writes
-- changes.

COMMENT ON COLUMN users.is_enabled IS
  'May sign in and have per-user work done. An explicit admin decision, independent of the feature switches (0184); see apps/api/src/lib/accountEnabled.ts.';

-- The assistant had no permission of its own: any signed-in account could chat,
-- and every turn is paid model calls. Defaults ON so adding the permission takes
-- the assistant from nobody who has it today; access (above) still gates it.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS assistant_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN users.assistant_enabled IS
  'May use the AI assistant. Admins always may; see apps/api/src/lib/permissions.ts.';

-- Top Picks rows went to every account the media server had not disabled, with
-- or without access here, and nothing could change that. Defaults ON, which is
-- that behaviour.
ALTER TABLE home_sections_config
  ADD COLUMN IF NOT EXISTS top_picks_without_access BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN home_sections_config.top_picks_without_access IS
  'Also put the Top Picks rows on the home screen of accounts without access (users.is_enabled false).';
