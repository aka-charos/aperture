-- Synopsis translations that FAILED, so the next run can put them last.
--
-- A failed translation writes no row to title_translations, so it stays
-- pending (0196's rule) — and with nothing recording the failure, the next
-- run's priority order put the same titles first again. A title that fails on
-- every attempt (measured: a long synopsis the public endpoint's 10-second
-- gateway always cuts off) then opened every run, and five of them in a row
-- tripped the job's "the endpoint is down" stop before a single title that
-- would have translated was reached.
--
-- A row here moves its pair to the BACK of the queue; it never removes it.
-- The pair is still retried every run, after everything else, oldest failure
-- first so the tail rotates. A success deletes the row. `source_hash` is the
-- text that failed: once the source changes, the failure no longer applies
-- and the pair queues as new.

CREATE TABLE IF NOT EXISTS title_translation_failures (
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  -- movies.id OR series.id, as in title_translations; no foreign key.
  media_id UUID NOT NULL,
  language TEXT NOT NULL,
  field TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (media_type, media_id, language, field)
);

COMMENT ON TABLE title_translation_failures IS 'Synopsis translations that failed for the current source text; such pairs are retried after every other pending pair. Deleted on success.';
