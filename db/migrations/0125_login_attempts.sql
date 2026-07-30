-- Migration: 0125_login_attempts
-- Description: Per-account failed-login tracking for brute-force lockout.
--
-- Keyed by the submitted username rather than users.id so that attempts against
-- accounts that do not exist in Aperture yet (users are created on first
-- successful login) are rate-limited on the same footing as known accounts.
-- This also keeps the lockout effective across source IPs, which per-IP HTTP
-- rate limiting alone cannot do.

CREATE TABLE login_attempts (
  username_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ
);

-- Supports the periodic purge of stale rows
CREATE INDEX idx_login_attempts_last_failed_at ON login_attempts(last_failed_at);

COMMENT ON TABLE login_attempts IS 'Failed login counters driving per-account lockout';
COMMENT ON COLUMN login_attempts.username_key IS 'Lowercased, trimmed username as submitted (not a FK - the account may not exist)';
COMMENT ON COLUMN login_attempts.locked_until IS 'When set and in the future, logins for this username are refused';
