-- Migration: 0126_session_hardening
-- Description: Store session tokens hashed and track idle time.
--
-- Previously the session id WAS the bearer token, stored verbatim: any read of
-- this table (backup, replica, SQL injection, a copied dump) yielded live
-- sessions. The token is now a random value held only by the client; the row
-- keeps sha256(token) and nothing else.
--
-- Existing sessions are DELETED rather than migrated. It is possible to carry
-- them over by hashing the old id, and that would avoid signing anyone out —
-- but those tokens are precisely the ones that sat readable at rest, so
-- preserving them would carry the exposure this migration exists to remove
-- forward for another 30 days. Everyone signs in once after the upgrade.

DELETE FROM sessions;

-- Safe without a default: the table is empty as of the statement above.
ALTER TABLE sessions ADD COLUMN token_hash TEXT NOT NULL;
ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_last_seen_at ON sessions(last_seen_at);

COMMENT ON COLUMN sessions.token_hash IS 'sha256 hex of the session token; the token itself is never stored';
COMMENT ON COLUMN sessions.last_seen_at IS 'Last request on this session, for the idle timeout';

-- Expired sessions were only removed when someone happened to present one, so
-- add the job that sweeps them (and stale login_attempts rows) on a schedule.
INSERT INTO job_config (job_name, schedule_type, schedule_hour, schedule_minute, is_enabled)
VALUES ('cleanup-auth-state', 'daily', 3, 30, true)
ON CONFLICT (job_name) DO NOTHING;
