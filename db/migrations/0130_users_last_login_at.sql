-- Migration: 0130_users_last_login_at
-- Description: Track when a user last signed in to the Aperture web app itself,
--              distinct from the media server's per-user LastActivityDate (last
--              streaming activity on Emby/Jellyfin, already surfaced via
--              MediaServerUser.lastActivityDate and shown in Admin -> Users).
--              Persisted on the user row (not derived from `sessions`) so it
--              survives session expiry/cleanup instead of going blank once the
--              cleanup-auth-state job prunes old sessions.

ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;

COMMENT ON COLUMN users.last_login_at IS 'When the user last successfully signed in to the Aperture web app (set in createSession, apps/api/src/plugins/auth.ts). Distinct from the media server''s lastActivityDate (last streaming activity).';
