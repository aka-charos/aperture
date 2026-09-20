-- Migration: 0181_discover_request_requires_discover
-- Description: Re-derive discover_request_enabled so it cannot outlive Discover.
--
-- Requesting missing content is reached from the Discover surface and scored by
-- the discovery pipeline, which skips a user with `discover_enabled` false
-- outright -- so the pair has never been meaningful. The admin UI has always
-- cleared one with the other, but the rule lived only in the browser: the API
-- wrote the two columns independently and routes/seerr checked the request flag
-- alone, so `PUT /api/users/:id {"discoverRequestEnabled": true}` granted Seerr
-- request rights to an account with Discover switched off.
--
-- `lib/permissions.ts` now enforces the dependency at the read (`can`) and at
-- the write (`discoverRequestSql`). This repairs the rows already stored in that
-- state, so the column agrees with the capability rather than being overridden
-- by it -- the same reason 0174 re-derived `users.is_enabled`.
--
-- Only ever clears. A user who should hold request rights had Discover on.

UPDATE users
   SET discover_request_enabled = false,
       updated_at = NOW()
 WHERE discover_request_enabled = true
   AND discover_enabled = false;

COMMENT ON COLUMN users.discover_request_enabled IS
  'May request missing content through Seerr. Requires discover_enabled; see apps/api/src/lib/permissions.ts.';
