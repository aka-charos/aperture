-- Migration: 0193_evidence_labels
-- Description: An operator's judgement on whether a watched title is a real
--              reason for a recommendation.
--
-- The decision-model card compares three judges of the evidence heading — the
-- cosine threshold, a director-or-franchise rule and the model — and only a
-- person can say which was right. Labels are given on the pairs the judges
-- disagree about, blind to their verdicts, and are read back two ways: scored
-- against the stored verdicts on the card, and re-asked of the model by the
-- benchmark.
--
-- Keyed by the PAIR, not by a run: the same title offered for the same pick is
-- the same claim whichever viewer or run it came from, so a label made once
-- applies to every later run that offers that pair. No foreign keys to
-- movies/series (the ids point at either table); a label whose title has left
-- the library is simply never matched again, and the benchmark lists it as not
-- in the library.
--
-- A label is a person's judgement, so clearing the stored verdicts leaves the
-- labels alone.

CREATE TABLE IF NOT EXISTS evidence_labels (
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  pick_id UUID NOT NULL,
  watched_id UUID NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('yes', 'no', 'arguable')),
  labelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  labelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (media_type, pick_id, watched_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_labels_labelled_at ON evidence_labels (labelled_at DESC);

COMMENT ON TABLE evidence_labels IS
  'Operator judgements on whether a watched title is a real reason for a pick; used to score the evidence judges';
