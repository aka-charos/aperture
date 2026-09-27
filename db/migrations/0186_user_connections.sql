-- Migration: 0186_user_connections
-- Description: Admin-managed connections between users (docs/plans/social-connections.md).
--
-- One row per unordered pair. The database orders the pair (LEAST/GREATEST at
-- insert), so the same two people inserted in either order hit the unique
-- constraint instead of duplicating, and application code never compares uuids.
-- Connected = full mutual visibility; there is no direction.

CREATE TABLE IF NOT EXISTS user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Who paired them. SET NULL, not CASCADE: deleting an admin must not
  -- disconnect everyone they connected.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Strict < also forbids a self-pair; no separate CHECK is needed.
  CONSTRAINT user_connections_ordered CHECK (user_id_a < user_id_b),
  CONSTRAINT user_connections_pair_unique UNIQUE (user_id_a, user_id_b)
);

-- The unique constraint's index already leads with user_id_a.
CREATE INDEX IF NOT EXISTS idx_user_connections_b ON user_connections (user_id_b);

-- A connection change names the OTHER person, and permission_changes had no
-- column for "with whom". Stored as a label (like subject_label) so a deleted
-- account stays identifiable.
ALTER TABLE permission_changes ADD COLUMN IF NOT EXISTS detail TEXT;
COMMENT ON COLUMN permission_changes.detail IS
  'Optional object of the change, e.g. the other account''s username for field = connection.';
