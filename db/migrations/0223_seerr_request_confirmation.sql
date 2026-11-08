-- Migration: 0223_seerr_request_confirmation
-- Description: When a request was sent to Seerr without an answer saying whether it
-- was made, and as whom. A lost answer (timeout, dropped connection, a 5xx after
-- Seerr may have committed) is not a failure: the row stays pending and is matched
-- against the title's own requests in Seerr.

ALTER TABLE discovery_requests ADD COLUMN seerr_unconfirmed_since TIMESTAMPTZ;
ALTER TABLE discovery_requests ADD COLUMN seerr_requested_as INTEGER;

COMMENT ON COLUMN discovery_requests.seerr_unconfirmed_since IS 'Set when the request is sent to Seerr, cleared by any status other than pending. Still set on a pending row = Seerr never said whether it made the request; the row is matched against Seerr''s own requests for the title. NULL on rows from before 0223.';
COMMENT ON COLUMN discovery_requests.seerr_requested_as IS 'The Seerr user id the request was sent as (header or body), so a lost answer is matched against the right requester. NULL = sent as the API key''s own user, or before 0223.';
