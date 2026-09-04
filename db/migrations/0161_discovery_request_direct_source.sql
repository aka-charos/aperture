-- Migration: 0161_discovery_request_direct_source
-- Description: record requests made straight from in-app search as their own source

-- `source` is an unconstrained TEXT column (0106), so a new value needs no DDL.
-- This comment is the only place the vocabulary is written down in the schema,
-- and a value nobody can discover is a value the next reader will duplicate
-- under a different name.
COMMENT ON COLUMN discovery_requests.source IS
  'Origin: discovery (Discovery page), gap_analysis (admin Movie Collection Gaps), or direct (searched for and requested by hand)';
