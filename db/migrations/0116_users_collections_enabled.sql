-- Migration: 0116_users_collections_enabled
-- Description: Per-user permission to create Collections (server-wide Box Sets) from the
--              Channel builder. Mirrors discover_enabled. Admins are always allowed (enforced
--              in code), so this gates non-admin users. Default off (opt-in).

ALTER TABLE users ADD COLUMN collections_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_users_collections_enabled ON users(collections_enabled) WHERE collections_enabled = TRUE;

COMMENT ON COLUMN users.collections_enabled IS 'Whether user can create Collections (server-wide Box Sets) from the Channel builder';
