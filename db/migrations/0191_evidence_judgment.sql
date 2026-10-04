-- Migration: 0191_evidence_judgment
-- Description: Store an optional decision model's verdict on each evidence row.
--
-- `recommendation_evidence` holds the three titles in a viewer's history
-- nearest each pick, with no distance floor, and the heading over them ("why we
-- picked this" vs "also in your library") was decided by a raw cosine bar alone
-- (evidenceStrength.ts). A cosine cannot say WHY two titles are near, and the
-- measured cases show strong and weak pairs on both sides of any bar.
--
-- When an operator switches on the decision-model integration, each pick's
-- evidence is put to a System One model as a yes/no question — is there a
-- concrete connection? — and the answer is stored here. Both columns are NULL
-- unless that happened, and NULL means exactly what every row meant before this
-- migration: the cosine bar decides. Nothing is backfilled; the explanation
-- refresh job judges existing runs on demand.
--
-- judged_connection: the model's probability of "yes", 0..1. REAL, so pg hands
--   it back as a number rather than as NUMERIC text.
-- judged_model: the model id the endpoint reported answering with, so verdicts
--   from two models are never read as one population.

ALTER TABLE recommendation_evidence ADD COLUMN IF NOT EXISTS judged_connection REAL;
ALTER TABLE recommendation_evidence ADD COLUMN IF NOT EXISTS judged_model TEXT;

COMMENT ON COLUMN recommendation_evidence.judged_connection IS
  'Optional decision model P(yes) that this watched title is a real reason for the pick; NULL = not judged, the cosine bar decides';
COMMENT ON COLUMN recommendation_evidence.judged_model IS
  'Model id that produced judged_connection, as reported by the endpoint';
