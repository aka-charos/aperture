-- 2560-dimension embedding tables.
--
-- WHY THIS DIMENSION
--
-- perplexity/pplx-embed-v1-4b is 2560 wide at its native size (Matryoshka
-- truncatable down to 128, which this app does not use -- see the note on
-- `dimensions` not being plumbed). 2560 was not among the eight widths 0078 and
-- 0091 built tables for, and a dimension with no table cannot be selected at
-- all: getCurrentEmbeddingDimensions reads the model's declared width and
-- getEmbeddingTableSuffix turns it into a table name, throwing on anything
-- outside VALID_EMBEDDING_DIMENSIONS before a single vector is requested.
--
-- THIS MIGRATION MUST LAND BEFORE 2560 JOINS VALID_EMBEDDING_DIMENSIONS
--
-- Not merely "should". listStoredSets in lib/embeddingSets.ts builds one
-- UNION ALL across `${base}_${d}` for EVERY entry in that list, with no
-- to_regclass guard -- unlike purge.ts, which resolves existing tables first.
-- So adding the constant without these tables does not degrade the Embeddings
-- panel, it fails every load of it with `relation "embeddings_2560" does not
-- exist`. The constant and this file are one change.
--
-- COLUMN SET
--
-- Three later migrations have added columns to the embedding families, and a
-- table created now has to arrive with all of them or it is a dimension that
-- silently behaves differently from its neighbours:
--
--   0078  the base shape, and the HNSW + item-id indexes
--   0138  text_version / updated_at, MOVIE AND SERIES FAMILIES ONLY -- episode
--         canonical text reads no enrichment column, so it has nothing to go
--         stale against and re-embedding episodes would be pure cost
--   0154  embedding_centered, likewise movies and series only
--
-- INDEX TYPE
--
-- Plain halfvec HNSW, as 0078 uses through 3072 -- NOT 0091's binary-quantised
-- workaround. That workaround exists because pgvector's HNSW tops out at 4000
-- dimensions and 4096 is over it; 2560 is comfortably under, so it can be
-- indexed directly and answer an exact cosine distance rather than a Hamming
-- approximation that needs re-ranking.

DO $$ BEGIN RAISE NOTICE '[0157] Creating 2560 dimension embedding tables...'; END $$;

-- ============================================================================
-- STEP 1: Movies
-- ============================================================================

CREATE TABLE IF NOT EXISTS embeddings_2560 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  embedding halfvec(2560) NOT NULL,
  canonical_text TEXT,
  text_version INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  embedding_centered halfvec(2560),
  UNIQUE(movie_id, model)
);

-- ============================================================================
-- STEP 2: Series
-- ============================================================================

CREATE TABLE IF NOT EXISTS series_embeddings_2560 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  embedding halfvec(2560) NOT NULL,
  canonical_text TEXT,
  text_version INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  embedding_centered halfvec(2560),
  UNIQUE(series_id, model)
);

-- ============================================================================
-- STEP 3: Episodes
--
-- No text_version, updated_at or embedding_centered here, matching every other
-- width: 0138 and 0154 both stop at the movie and series families on purpose.
-- ============================================================================

CREATE TABLE IF NOT EXISTS episode_embeddings_2560 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  embedding halfvec(2560) NOT NULL,
  canonical_text TEXT,
  UNIQUE(episode_id, model)
);

-- ============================================================================
-- STEP 4: Indexes
-- ============================================================================

DO $$ BEGIN RAISE NOTICE '[0157] Creating HNSW indexes on 2560 dimension tables...'; END $$;

CREATE INDEX IF NOT EXISTS idx_embeddings_2560_hnsw ON embeddings_2560
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_embeddings_2560_movie_id ON embeddings_2560(movie_id);

CREATE INDEX IF NOT EXISTS idx_series_embeddings_2560_hnsw ON series_embeddings_2560
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_series_embeddings_2560_series_id ON series_embeddings_2560(series_id);

CREATE INDEX IF NOT EXISTS idx_episode_embeddings_2560_hnsw ON episode_embeddings_2560
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_episode_embeddings_2560_episode_id ON episode_embeddings_2560(episode_id);

-- ============================================================================
-- STEP 5: Comments
-- ============================================================================

COMMENT ON TABLE embeddings_2560 IS 'Vector embeddings (2560 dim) for movies';
COMMENT ON TABLE series_embeddings_2560 IS 'Vector embeddings (2560 dim) for TV series';
COMMENT ON TABLE episode_embeddings_2560 IS 'Vector embeddings (2560 dim) for TV episodes';

DO $$ BEGIN RAISE NOTICE '[0157] 2560 dimension embedding tables created.'; END $$;
