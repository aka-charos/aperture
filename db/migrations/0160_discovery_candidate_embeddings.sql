-- Migration: 0160_discovery_candidate_embeddings
-- Description: Cache a vector per discovery candidate, so the taste-similarity
--              term in the discovery scorer can actually be computed.
--
-- WHY THIS EXISTS
--
-- discover/scorer.ts looked candidate embeddings up by joining movies/series on
-- tmdb_id against the active embedding table. But discover/filter.ts removes
-- every candidate that HAS a row in those tables -- that is its entire job -- so
-- the join's match set was a strict subset of the exclusion set and the map was
-- empty on every run. similarityScore was therefore the constant 0.5 for every
-- candidate, which is 45.5% of the configured blend contributing exactly zero
-- ranking variance.
--
-- A discovery candidate is by definition NOT in the library, so there is no
-- stored vector to find. It has to be embedded from its TMDb metadata, and that
-- is what this table holds.
--
-- SHARED, NOT PER USER. Keyed on (media_type, tmdb_id, model), so a title is
-- embedded once for the whole instance and reused by every user and every run.
-- That is what keeps the cost bounded: the pool is a few thousand titles, most
-- of which persist between runs.
--
-- `model` HOLDS A SET ID, NOT A MODEL NAME. Same discipline as the library
-- embedding tables: the value comes from getEmbeddingInvocation().setId, so a
-- provider, model or retrieval-mode change starts a new set beside the old one
-- rather than silently reusing vectors from a different space.
--
-- DIMENSION-FREE halfvec, following 0079/0086, which made every taste-profile
-- and interest column dimension-free for the same reason: this table is read by
-- primary key and scored in JavaScript, never by ANN, so it needs no index and
-- therefore no fixed width. That also means one table serves every configured
-- dimension instead of the per-width family the library tables need.

CREATE TABLE discovery_candidate_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  tmdb_id INTEGER NOT NULL,

  -- Set identity (provider:model[~mode]) from getEmbeddingInvocation().setId
  model TEXT NOT NULL,

  embedding halfvec NOT NULL,

  -- Hash of the canonical text the vector was built from. A candidate embedded
  -- before enrichment has a thinner document than the same candidate embedded
  -- after it, so the hash is what lets a richer document supersede a poorer one
  -- without re-embedding everything on every run.
  text_hash TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (media_type, tmdb_id, model)
);

-- The only read pattern: "which of these tmdb_ids do I already have for this
-- media type and set". Covered by the unique constraint's index.
CREATE INDEX idx_discovery_candidate_embeddings_lookup
  ON discovery_candidate_embeddings (media_type, model, tmdb_id);

-- Pruned alongside the candidate pool, so a title that stops being offered
-- stops costing storage.
CREATE INDEX idx_discovery_candidate_embeddings_updated
  ON discovery_candidate_embeddings (updated_at);

COMMENT ON TABLE discovery_candidate_embeddings IS
  'Vectors for titles NOT in the library, so discovery can score taste similarity. Shared across all users.';
COMMENT ON COLUMN discovery_candidate_embeddings.model IS
  'Embedding set id (provider:model[~mode]), matching the library embedding tables'' model column';
COMMENT ON COLUMN discovery_candidate_embeddings.text_hash IS
  'Hash of the canonical text embedded; lets a richer post-enrichment document supersede a thinner one';
