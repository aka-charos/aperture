-- Migration: 0182_api_key_scopes
-- Description: Give API keys a scope, so a key is no longer the whole account.
--
-- `validateApiKey` returns `is_admin` and the auth plugin copies it onto the
-- request, so a key minted for a shell script has always carried the account's
-- full authority: it can purge the database, read provider credentials and
-- rewrite every user's permissions. It also has none of a session's limits --
-- no idle window, no lifetime, and nothing that revokes it when an admin is
-- demoted.
--
-- Vocabulary and the rules are in packages/core/src/apiKeyScopes.ts. A scope
-- only ever NARROWS: `admin` on a non-admin's key grants nothing.
--
-- Existing keys are backfilled to the full set, deliberately. They are wired
-- into somebody's Home Assistant or cron job, and silently narrowing a running
-- integration is a worse failure than leaving the authority visible and
-- narrowable -- which is what the Settings page now does. New keys default to
-- `read` alone, which is the column default below.
--
-- Deliberately NOT a CHECK constraint. An unrecognised value is dropped by
-- `normalizeApiKeyScopes` at every read, and a CHECK here would be a second
-- copy of the vocabulary that a later scope has to be added to in two places
-- (F-002's rule about roles and SQL CHECKs, for the same reason).

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY['read'];

-- Every key that existed before this migration keeps exactly what it had.
UPDATE api_keys
   SET scopes = ARRAY['read', 'write', 'admin']
 WHERE revoked_at IS NULL;

COMMENT ON COLUMN api_keys.scopes IS
  'What this key may do with its account: read (implied), write, admin. Narrows only; see packages/core/src/apiKeyScopes.ts.';
