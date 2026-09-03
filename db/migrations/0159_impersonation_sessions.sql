-- Admin account assumption ("view as user").
--
-- A grant is deliberately NOT a row in `sessions`, and it does not replace the
-- admin's session cookie. It rides in a second cookie beside it, so the admin's
-- own session is never touched and ending an assumption is just dropping this
-- row: there is no admin session to re-mint from a token we only ever stored a
-- hash of, and therefore no state in which the admin is stranded in someone
-- else's account.
--
-- Nothing here writes to the target account. That is the whole point of the
-- feature, and the reason an assumed session is refused every unsafe HTTP
-- method (see apps/api/src/lib/impersonation.ts).
CREATE TABLE impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Same reasoning as sessions.token_hash: the cookie is a bearer credential,
  -- so only its digest is stored.
  token_hash TEXT NOT NULL UNIQUE,
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Bound to the exact session that started it. Signing out, the session
  -- expiring, or the cleanup job pruning it all take the grant with them, so a
  -- grant can never outlive the authority that created it.
  admin_session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A short lease, so an assumption left open in a forgotten tab ends by
  -- itself rather than waiting for the 30-day session it hangs off.
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_impersonation_sessions_admin_session ON impersonation_sessions(admin_session_id);
CREATE INDEX idx_impersonation_sessions_expires_at ON impersonation_sessions(expires_at);
