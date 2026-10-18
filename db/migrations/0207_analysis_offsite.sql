-- Offsite title analysis: prepare prompts here, run the model somewhere else,
-- bring the answers back.
--
-- Retrieval needs this server (fastCRW, the source filters), but the model call
-- does not — and an operator may have a faster machine than the one Aperture
-- runs on (a laptop with LM Studio, say). A BATCH holds the prompts for N
-- pending titles, built exactly as the library job would build them; the file
-- goes to the other machine, a runner sends each prompt, and the answers are
-- imported through the same checks and the same insert a normal run uses.
--
-- Stored rather than kept in memory because a batch is out for hours or days:
-- the answers can only be checked against the evidence the prompt was built
-- from, and that evidence must survive a container recreate.

CREATE TABLE IF NOT EXISTS analysis_offsite_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- preparing | ready | closed. A batch that failed or was stopped part-way
  -- becomes `ready` with what it prepared and says why in `error`, because the
  -- prompts already built are as good as any.
  status TEXT NOT NULL DEFAULT 'preparing',
  error TEXT,

  requested INTEGER NOT NULL,
  media_types TEXT[] NOT NULL,

  -- What every prompt in the batch was built with. The import files answers
  -- under THIS version and variant, not whatever is current by then, because
  -- that is what the model was asked.
  prompt_version INTEGER NOT NULL,
  prompt_variant TEXT,

  -- The Title Analysis role's output ceiling at export time, written into the
  -- file so the other machine runs under the same one. NULL means no ceiling
  -- (the setting's 0). Sampling settings are deliberately NOT carried: they are
  -- OpenRouter-only and a local run is sent none (F-123), so the runner sends
  -- none either unless told to.
  max_output_tokens INTEGER,

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prepared_at TIMESTAMPTZ,
  -- Until this passes, the batch's unanswered titles are RESERVED: the library
  -- job and the next batch leave them alone, so a title is not paid for twice.
  expires_at TIMESTAMPTZ NOT NULL,
  last_import_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analysis_offsite_batches_created
  ON analysis_offsite_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS analysis_offsite_items (
  -- Also the `custom_id` in the exported file: opaque, unique, and enough on
  -- its own to find the batch an answer belongs to.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES analysis_offsite_batches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,

  -- No foreign key, as on title_analysis: movies.id OR series.id.
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  media_id UUID NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,

  -- pending (retrieving) | ready (in the file) | retrieval_failed |
  -- rejected (answer broke the output contract; can be run again) |
  -- stored | declined | skipped (analysed another way meanwhile)
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  -- How many answers for this title have been rejected. Written into the file
  -- and echoed back by the runner, which keys its resume on (id, attempt): a
  -- rejected title then reads as unanswered on the next run instead of being
  -- skipped forever, and a re-imported answer to an older attempt is
  -- recognised rather than judged again.
  attempt INTEGER NOT NULL DEFAULT 0,

  -- The prompt, and what the floor needs to judge the answer against it.
  -- Cleared once an answer is stored or declined.
  prompt TEXT,
  -- [{ "title": "...", "domain": "...", "url": "..." }] — what the panel shows
  sources JSONB,
  -- [{ "domain": "...", "chars": 1234 }] — what decideAnalysisFloor reads
  evidence JSONB,
  source_count INTEGER,
  retrieved_chars INTEGER,

  model TEXT,
  imported_at TIMESTAMPTZ,

  UNIQUE (batch_id, position)
);

CREATE INDEX IF NOT EXISTS idx_analysis_offsite_items_title
  ON analysis_offsite_items (media_type, media_id);

-- The titles an open batch is holding. A view so the pending predicate can
-- join it like it joins title_analysis, and so "reserved" is defined once.
-- DISTINCT because a title could sit in two open batches only through a manual
-- re-export, and a duplicate row here would duplicate the pending selection.
CREATE OR REPLACE VIEW analysis_offsite_reservations AS
SELECT DISTINCT i.media_type, i.media_id
  FROM analysis_offsite_items i
  JOIN analysis_offsite_batches b ON b.id = i.batch_id
 WHERE b.status IN ('preparing', 'ready')
   AND b.expires_at > NOW()
   AND i.status IN ('pending', 'ready', 'rejected');
