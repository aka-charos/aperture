-- Migration: 0129_users_email_notifications_allowed
-- Description: Per-user admin permission gating the Email Notifications opt-in in
--              User Settings. Mirrors collections_enabled. Email sending itself is
--              not implemented yet (no SMTP/provider integration exists), so this
--              only controls whether the currently-inert opt-in toggle and email
--              capture are shown to a given user. Default off (opt-in per user).

ALTER TABLE users ADD COLUMN email_notifications_allowed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_users_email_notifications_allowed ON users(email_notifications_allowed) WHERE email_notifications_allowed = TRUE;

COMMENT ON COLUMN users.email_notifications_allowed IS 'Admin permission: whether the Email Notifications section is shown in this user''s settings. Independent of email_notifications_enabled, which is the user''s own preference once permitted.';
