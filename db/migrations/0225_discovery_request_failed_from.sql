-- Migration: 0225_discovery_request_failed_from
-- Description: The status a request held when the reconcile job marked it failed
-- because Seerr answered that it no longer exists. If Seerr turns out to still hold
-- the request, restoring it to the status it already had is a correction, and must
-- not notify the requester a second time; a different status is a decision made
-- since, and does notify (core discover/reconcile.ts, restoreKeepsStatusStamp).

ALTER TABLE discovery_requests ADD COLUMN IF NOT EXISTS failed_from TEXT;

COMMENT ON COLUMN discovery_requests.failed_from IS 'Status the row held when reconcile marked it failed on a Seerr 404; cleared when it is restored. NULL = not failed that way, or failed before 0225 (restores then compare Seerr''s own last change with the failure time).';
