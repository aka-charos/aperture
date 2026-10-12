-- Migration: 0199_users_provider_missing
-- Description: Record when the media server stopped listing an account.
--
-- The user sync only ever imported and updated, so an account deleted from the
-- media server kept its Aperture row with every switch as it was: access on,
-- background work still done for it, API keys still working, an address on file
-- for any email to come. Nothing showed it either, because the Users page is
-- drawn from the media server's own list.
--
-- The sync now stamps this column when a full, trusted listing no longer
-- contains the account (core users/providerPresence.ts decides what is
-- trusted) and sets `provider_disabled` with it, which is the flag every
-- per-user job and all three sign-in doors already refuse on. This column is
-- the REASON beside that flag: it is what tells "deleted from the media server"
-- from "disabled there", and it clears when the account is listed again or
-- signs in.
--
-- Not backfilled: the next user sync marks every account it should.

ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_missing_at TIMESTAMPTZ;

COMMENT ON COLUMN users.provider_missing_at IS
  'When the media server''s full user list stopped containing this account (0199). While set, provider_disabled is true. NULL = listed, or never checked.';
