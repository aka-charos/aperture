-- Migration: 0194_explanation_checks
-- Description: The decision model's checks on written recommendation
--              explanations, and the operator's accept/reject labels on them.
--
-- The evidence verdicts (0191) decide which heading the explanation writer is
-- given; nothing checked what it then wrote. The `check-recommendation-
-- explanations` job asks the decision model four yes/no questions about each
-- explanation on the viewers' newest recommendations — does it claim a
-- context-only title as the reason, assert a link the data does not support,
-- state a fact it was not given, or give the ending away — and stores the
-- answers here. Shadow only: nothing a viewer sees reads these tables.
--
-- Both tables are keyed by a hash of the explanation's TEXT, not by candidate:
-- a rewritten explanation is a new item that gets checked again, a label stays
-- attached to the exact words that were judged, and neither is lost when old
-- runs are pruned. The label row keeps the text itself for the same reason.
--
-- A NULL score means that check was not asked: claims_context_as_reason is
-- only asked when the heading was context-only, since under a "reason" heading
-- presenting the watched titles as the reason is what the writer was told to do.

CREATE TABLE IF NOT EXISTS explanation_checks (
  explanation_hash TEXT PRIMARY KEY,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  pick_id UUID NOT NULL,
  heading TEXT NOT NULL CHECK (heading IN ('reason', 'contextOnly')),
  claims_context_as_reason REAL,
  unsupported_link REAL,
  invented_fact REAL,
  spoiler REAL,
  -- The model id asked for (re-checking with another model replaces the row),
  -- and the one the endpoint reported answering.
  requested_model TEXT NOT NULL,
  answered_model TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS explanation_labels (
  explanation_hash TEXT PRIMARY KEY,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  pick_id UUID NOT NULL,
  explanation TEXT NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('accept', 'reject', 'unsure')),
  labelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  labelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE explanation_checks IS
  'Decision-model checks on written recommendation explanations; shadow measurement, read by the admin card only';
COMMENT ON TABLE explanation_labels IS
  'Operator accept/reject judgements on recommendation explanations, to measure the decision-model checks';
