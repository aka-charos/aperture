-- Migration: 0183_permission_changes
-- Description: An audit trail for permission grants and revocations.
--
-- Nothing recorded a single change to any of the ten permission booleans on
-- `users`, or to an API key's scopes. The question with no answer was the
-- ordinary one -- "I could do this yesterday" -- and every cause looks the same
-- from outside: an admin unticked a switch, the user sync saw Policy.IsDisabled
-- flip on the media server, a derived column followed a switch that WAS ticked
-- (is_enabled, discover_request_enabled), or a key was narrowed.
--
-- Rules and the diffing live in packages/core/src/permissionAudit.ts.

CREATE TABLE IF NOT EXISTS permission_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Who. NULL when nobody did: the user sync reading the media server, or the
  -- login route clearing provider_disabled. ON DELETE SET NULL rather than
  -- CASCADE -- deleting an admin must not erase the record of what they did.
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT NOT NULL,

  -- Whom. Deliberately NO foreign key: the record of an account's permissions
  -- has to outlive the account, and a cascade here would delete exactly the
  -- history somebody is asking about. The label is the username (or the key's
  -- name) as it was, so a deleted subject is still identifiable.
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'api_key')),
  subject_id UUID NOT NULL,
  subject_label TEXT NOT NULL,

  -- What. Values are TEXT rather than BOOLEAN because an API key's scopes are a
  -- list, and one column that holds every kind of permission beats a second
  -- table that holds the other kind.
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL
);

-- The only read is "the history for this subject, newest first".
CREATE INDEX idx_permission_changes_subject
  ON permission_changes (subject_id, created_at DESC);

COMMENT ON TABLE permission_changes IS
  'Audit trail: every permission granted or revoked, and by whom. Only real changes are stored, so this grows with events rather than with the clock. Nothing prunes.';
COMMENT ON COLUMN permission_changes.subject_id IS
  'No FK on purpose -- the audit must outlive the account it describes.';
