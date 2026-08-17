-- Critic-informed analysis of a title: how it was made, what its makers were
-- attempting, where it sits, what critics argue about.
--
-- Distinct from a recommendation explanation in the one way that matters:
-- an explanation is about (user x title) and is regenerated whenever the
-- recommender runs; this is about the TITLE ALONE. Nothing in it depends on who
-- is reading, so it is generated once, shared by every user, survives a
-- recommendations regenerate, and is worth showing on any detail page rather
-- than only on the ~20 picks.
--
-- The two texts must not be merged, but they are fenced the same way. The
-- explanation prompt refuses outside knowledge because it writes from measured
-- pipeline output; this one refuses it because the material it may use is
-- RETRIEVED AND SUPPLIED IN THE PROMPT — a self-hosted search+scrape service
-- fetches the articles and the model summarises what it was handed. "Use only
-- the sources" is therefore a checkable instruction in both, rather than an
-- appeal to a model's judgement about its own memory.
--
-- A ROW EXISTING MEANS THE ATTEMPT HAPPENED; the row's contents say what came
-- of it. That distinction is the lesson from `enrichment_version`, which
-- recorded which schema was current when a row was touched rather than which
-- source answered, and consequently froze OMDb out of a 12,584-film library
-- while the progress counter reported nothing outstanding. Here:
--
--   * analysis IS NOT NULL  -> we have one
--   * analysis IS NULL      -> asked, and the answer was "there is nothing
--                              substantive to say" or "the web has too little
--                              to ground on". Stored so it is not retried
--                              forever; decline_reason says which.
--   * no row at all         -> never asked, OR the attempt failed in transport
--                              (429, 5xx, timeout). Both retry, which is the
--                              whole reason a failure must not write a row.
--
-- `prompt_version` is what makes improving the prompt a config change instead
-- of a migration — the thing 0137 and 0139 both had to be written to work
-- around. Bump the constant, and every row below it becomes pending again.
-- `tags_prompt_version` is deliberately separate: style-tag extraction is a
-- second, cheap, ungrounded pass over prose already stored here, so its
-- vocabulary can be re-run without spending a single grounded request.

CREATE TABLE IF NOT EXISTS title_analysis (
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  -- No foreign key: this references movies.id OR series.id depending on
  -- media_type, which Postgres cannot express. A title removed from the library
  -- therefore leaves an orphan row — cheap, and safer than a trigger.
  media_id UUID NOT NULL,

  analysis TEXT,
  decline_reason TEXT,

  -- [{ "title": "...", "domain": "sensesofcinema.com" }]. Title and domain only,
  -- never the full URL: provenance is what a reader needs (it is what says
  -- whether this came from a film journal or a listicle), and a link table
  -- living for months would rot.
  sources JSONB,
  -- The model's own closing verdict on what it found: substantial critical
  -- writing / reviews only / almost nothing. Cheap signal for tuning the floor.
  source_grade TEXT,

  -- Retrieval evidence, the two halves of which answer different questions and
  -- are both needed. `source_count` is how many documents were fetched and
  -- handed over; `retrieved_chars` is how much text they carried. A title can
  -- score well on count and near-zero on chars (six paywall stubs), or the
  -- reverse (one long Wikipedia page). Together with source_grade above they
  -- are what the floor decides on, and what makes the decline rate tunable
  -- after the fact instead of guessed at now.
  source_count INTEGER,
  retrieved_chars INTEGER,

  -- Which approach produced this row: 'crw' (self-hosted search + scrape, the
  -- model writes from article text in the prompt) or 'grounding' (a Gemini
  -- model searches for itself). They fail in opposite directions — one is
  -- bounded by hardware, the other by a per-day Google quota — so the mode is
  -- recorded rather than assumed, and the two can be compared on a real library
  -- instead of argued about:
  --
  --   SELECT retrieval_mode, model, count(*), count(analysis) AS kept,
  --          round(avg(length(analysis))) AS avg_chars
  --   FROM title_analysis GROUP BY 1, 2;
  --
  -- Note retrieved_chars is NULL under 'grounding': Google never exposes the
  -- text it retrieved, so there is nothing to count. That is not zero.
  retrieval_mode TEXT,

  model TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  tags_prompt_version INTEGER,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (media_type, media_id)
);

-- The job selects titles whose analysis is missing or predates the current
-- prompt version, so both columns are read together on every pass.
CREATE INDEX IF NOT EXISTS idx_title_analysis_pending
  ON title_analysis (media_type, prompt_version);

COMMENT ON TABLE title_analysis IS
  'Per-title analysis written from retrieved web sources, cached forever. Title-scoped, not user-scoped: generated once and shared by every user.';
COMMENT ON COLUMN title_analysis.analysis IS
  'NULL means asked and declined (see decline_reason), which is a result. No row at all means never asked or the attempt failed in transport.';
COMMENT ON COLUMN title_analysis.sources IS
  'Source title + domain. Never full URLs — provenance is the durable part, links rot.';
COMMENT ON COLUMN title_analysis.retrieved_chars IS
  'Total characters of source text handed to the model. Paired with source_count because six stubs and one long article fail in opposite directions.';
COMMENT ON COLUMN title_analysis.prompt_version IS
  'Bump the code constant to make every older row pending again — a prompt change is a config change, not a migration.';
COMMENT ON COLUMN title_analysis.tags_prompt_version IS
  'Version of the style-tag extraction applied to this prose. Separate from prompt_version so tags can be re-extracted without new grounded calls.';
