-- Let the embedding jobs tell a stale vector from a missing one.
--
-- getMoviesWithoutEmbeddings/getSeriesWithoutEmbeddings select
-- `LEFT JOIN ... WHERE e.id IS NULL` — *missing*, not *stale*. There is no
-- content hash and no version, and while `canonical_text` has been stored on
-- every embedding row since 0007 it is never compared to anything. So a row
-- whose metadata changed keeps its original vector forever, and the only
-- available remedy is POST /api/settings/ai/embeddings/clear, which TRUNCATEs
-- movies, series AND episodes across every dimension table.
--
-- That mattered the moment enrichment started working: the canonical text now
-- includes keywords, languages and collection name, and none of it can reach a
-- vector that is never rebuilt.
--
-- Two columns, on the movie and series families only. Episode canonical text is
-- built from series title, season/episode numbers, overview and credits — no
-- enrichment column appears in it — so episodes have nothing to go stale
-- against and re-embedding them would be the largest cost here for no gain.
--
--   text_version  which build of buildCanonicalText produced the stored text.
--                 NULL means "written before this existed", which every current
--                 row is, so the first run after this rebuilds them all.
--
--   updated_at    when the row was last written. `created_at` cannot serve:
--                 storeEmbeddings upserts with ON CONFLICT DO UPDATE and leaves
--                 created_at at the original insert, so comparing it against
--                 movies.enriched_at would flag a row as stale, re-embed it,
--                 and flag it again on the next pass — the batch loop reads
--                 until the selection empties, so that is an infinite job, not
--                 a wasted call.

DO $$
DECLARE
  dim TEXT;
  family TEXT;
BEGIN
  FOREACH dim IN ARRAY ARRAY['256', '384', '512', '768', '1024', '1536', '3072', '4096'] LOOP
    FOREACH family IN ARRAY ARRAY['embeddings_', 'series_embeddings_'] LOOP
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN IF NOT EXISTS text_version INT',
        family || dim
      );
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        family || dim
      );
    END LOOP;
  END LOOP;
END $$;

COMMENT ON COLUMN embeddings_1536.text_version IS
  'Build of buildCanonicalText that produced canonical_text; NULL predates versioning and is treated as stale';
COMMENT ON COLUMN embeddings_1536.updated_at IS
  'Last write, set on upsert — created_at survives ON CONFLICT and cannot be compared against enriched_at';
