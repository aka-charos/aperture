-- Whether the user is disabled on the media server (Emby/Jellyfin Policy.IsDisabled).
-- Synced by sync-users job; recommendation jobs skip provider-disabled users.

ALTER TABLE users ADD COLUMN provider_disabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.provider_disabled IS 'Whether the user is disabled on the media server (synced automatically)';
