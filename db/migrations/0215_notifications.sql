-- Migration: 0215_notifications
-- Description: Notifications by email and by the Android app, chosen by each
-- person per event; the phones the app is installed on; and the moment a
-- request's status last changed.
--
-- Read and written through core notifications/. Nothing here is a gate input
-- of the recommendation activity gate, which is why preferences have their own
-- table and not a key in user_settings (whose updated_at the gate reads).

-- One row per person per event they have chosen for. A missing row means the
-- defaults in core notifications/rules.ts (email off, app on): email is only
-- ever sent to someone who switched it on, since `email_notifications_enabled`
-- (0088) defaults to TRUE from a time when it did nothing and so records no
-- consent. The event names are validated in core, not by a CHECK, so adding
-- one is a code change only.
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  email BOOLEAN NOT NULL,
  app BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, event)
);

-- A phone with the app installed. The id is made by the app on its first run
-- and kept for the life of the install, so signing in as someone else on the
-- same phone moves the row rather than adding one. Nothing reports an
-- uninstall: `last_seen_at` is the only evidence, and the app checks in only
-- while the screen is on, so a gap means the phone was not used, not that the
-- app was removed.
CREATE TABLE IF NOT EXISTS app_devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT,
  android_version TEXT,
  app_version TEXT,
  -- Whether Android lets the app show notifications, as of its last check-in.
  notifications_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_devices_user ON app_devices(user_id, last_seen_at DESC);

-- How far the email job has reported for each person. Only someone it can
-- email and who has an event switched on has a row: a person who drops out
-- loses theirs, so coming back (switching email on again, regaining an
-- address or the admin's permission) starts from then and never mails a
-- backlog. No row means "start from now".
CREATE TABLE IF NOT EXISTS notification_email_state (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reported_until TIMESTAMPTZ NOT NULL
);

-- When Aperture first saw a Seerr issue resolved. Seerr records no resolution
-- time and its updatedAt can move again later, so a resolution announced off
-- updatedAt would be announced again at every later touch. The first sighting
-- is stored instead (as that issue's updatedAt then), and both channels read
-- the same moment, so each reports it once. A reopened issue loses its row,
-- so resolving it again is news again.
CREATE TABLE IF NOT EXISTS notification_issue_resolutions (
  issue_id INTEGER PRIMARY KEY,
  resolved_at TIMESTAMPTZ NOT NULL
);

-- When a request's status last moved. updated_at moves for any write, so it
-- cannot say "approved just now"; this moves only when the status does, and a
-- trigger sets it so no writer can forget to.
ALTER TABLE discovery_requests ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION discovery_requests_stamp_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS discovery_requests_status_changed ON discovery_requests;
CREATE TRIGGER discovery_requests_status_changed
  BEFORE UPDATE ON discovery_requests
  FOR EACH ROW EXECUTE FUNCTION discovery_requests_stamp_status_change();

CREATE INDEX IF NOT EXISTS idx_discovery_requests_status_changed
  ON discovery_requests(user_id, status_changed_at)
  WHERE status_changed_at IS NOT NULL;

COMMENT ON TABLE user_notification_preferences IS
  'Per-event notification channels a person chose. Missing row = defaults (email off, app on).';
COMMENT ON TABLE app_devices IS
  'Phones running the Android app, by install id. last_seen_at is the only evidence of an install.';
COMMENT ON COLUMN discovery_requests.status_changed_at IS
  'Set by trigger whenever status changes; what request notifications read.';
