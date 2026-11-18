-- Migration: 0225_discovery_request_failed_from
-- Description: The status a request held when the reconcile job marked it failed
-- because Seerr answered that it no longer exists, and when that status was
-- reached. If Seerr turns out to still hold the request, restoring it to the
-- status it already had is a correction: it gets its old date back and must not
-- notify the requester a second time. A different status is a decision made
-- since, and does notify (core discover/reconcile.ts, restoreKeepsStatusStamp).

ALTER TABLE discovery_requests ADD COLUMN IF NOT EXISTS failed_from TEXT;
ALTER TABLE discovery_requests ADD COLUMN IF NOT EXISTS failed_from_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN discovery_requests.failed_from IS 'Status the row held when reconcile marked it failed on a Seerr 404. Cleared by trigger whenever the row leaves failed. NULL = not failed that way, or failed before 0225 (restores then compare Seerr''s own last change with the failure time).';
COMMENT ON COLUMN discovery_requests.failed_from_changed_at IS 'status_changed_at of failed_from: when that status was first reached. A restore to failed_from puts it back. Cleared with failed_from.';

-- Every writer that moves a row out of failed clears both, so they only ever
-- describe the failure the row is in now. A trigger rather than each writer
-- remembering: approve/decline, submission settling and the sweep all write
-- statuses.
CREATE OR REPLACE FUNCTION discovery_requests_clear_failed_from()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'failed' THEN
    NEW.failed_from = NULL;
    NEW.failed_from_changed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS discovery_requests_failed_from_cleared ON discovery_requests;
CREATE TRIGGER discovery_requests_failed_from_cleared
  BEFORE UPDATE ON discovery_requests
  FOR EACH ROW EXECUTE FUNCTION discovery_requests_clear_failed_from();
