-- Mean-centred embeddings for the recommender's retrieval path.
--
-- WHY
--
-- Every canonical text this app embeds describes a film, in the same template,
-- in the same register. That shared content becomes a direction all ~12,589
-- vectors have in common, and it is a large part of what every cosine here
-- measures -- which is why raw neighbour cosines on the live library crowd into
-- 0.66-0.83 and an excellent match is only ~0.13 away from a poor one.
-- Subtracting the library mean removes the shared direction and lets the rest
-- of the vector decide.
--
-- Measured by the evaluate-recommender job on this instance, macro-averaged
-- over 33 qualifying viewers, holding out each viewer's 20 most recent engaged
-- titles:
--
--                 ndcg@20   ndcg@100   ndcg@500   rec@100   median pct
--   random           0.0%       0.5%       9.1%      0.2%        51.4%
--   rating-only      4.0%       7.8%      23.5%      3.3%        70.7%
--   raw              9.5%      20.5%      46.5%     11.2%        86.6%
--   mean-centred    12.6%      31.9%      54.3%     20.6%        91.1%
--
-- It wins in all three history-size buckets and for 25 of 33 viewers, and the
-- gains land hardest on the viewers raw served worst (67.7 -> 93.6, 83.5 ->
-- 97.6, 54.0 -> 72.7). Five viewers lose 1-4 points.
--
-- WHY A STORED COLUMN RATHER THAN SUBTRACTING AT QUERY TIME
--
-- Centring is a property of the whole library, not of one row, so making it an
-- ingestion concern means every reader gets it consistently without having to
-- remember a rule. This codebase's recurring failure is exactly the opposite
-- shape: the AI-role enum copied into ten route schemas, the enrichment
-- predicate copied into four places, two centroid paths that disagreed about
-- normalisation. A column cannot be forgotten by a new query the way a
-- `- mean` term can.
--
-- It also removes the need to store or look up the mean at all. The taste
-- centroid is BUILT FROM these vectors, so a profile built from the centred
-- column is already in the centred space, and comparing it against the same
-- column needs no mean anywhere at query time.
--
-- NO INDEX, DELIBERATELY
--
-- Only the recommender reads this column, and its candidate query uses a LIMIT
-- above the table size, which makes the planner abandon HNSW for an exact scan
-- regardless (the same reason this repo notes the existing HNSW indexes are
-- effectively unused by the recommender). An index would cost build time on
-- every re-embed and buy nothing. 4096 would additionally need the binary
-- quantisation workaround 0091 documents. Add one if a reader appears that
-- actually wants an ANN scan.

DO $$ BEGIN RAISE NOTICE '[0154] Adding embedding_centered to movie and series embedding tables...'; END $$;

DO $$
DECLARE
  dim INTEGER;
  dims INTEGER[] := ARRAY[256, 384, 512, 768, 1024, 1536, 3072, 4096];
  tbl TEXT;
  prefix TEXT;
  prefixes TEXT[] := ARRAY['embeddings_', 'series_embeddings_'];
BEGIN
  FOREACH dim IN ARRAY dims LOOP
    FOREACH prefix IN ARRAY prefixes LOOP
      tbl := prefix || dim;
      -- Not every dimension table exists on every instance: 0078 created the
      -- original set and 0091 added 4096, so guard rather than assume.
      IF to_regclass(tbl) IS NOT NULL THEN
        EXECUTE format(
          'ALTER TABLE %I ADD COLUMN IF NOT EXISTS embedding_centered halfvec(%s)',
          tbl, dim
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;
-- The column deliberately carries no COMMENT ON. The first version of this
-- migration wrapped one in a DO block to guard against a table an instance
-- might not have, the escaping mangled its dollar-quoting to a single "$", and
-- Postgres rejected the whole file -- which, because migrations run at API
-- startup, crash-looped the container. A comment that can break boot is not
-- worth what a comment buys; the header above says all of it, in git, where
-- anyone changing this will actually read it.

-- ============================================================================
-- Which space a stored taste profile lives in
-- ============================================================================
--
-- This is the correctness-critical half. A taste profile is BUILT once and READ
-- later, so without a record of which space it was built in, a profile built
-- from raw vectors could be compared against the centred column the moment
-- centring became ready -- a comparison between two different spaces, which
-- produces a confident ranking that means nothing and would look like the
-- recommender simply getting worse.
--
-- Existing rows are raw by definition. New builds stamp what they used, and
-- candidate retrieval picks its column to match the profile rather than
-- deciding for itself.
--
-- No CHECK constraint on purpose. 0144 had to DROP exactly that shape from
-- custom_ai_models because a value list in SQL is a copy no build can see, and
-- it silently rejected two roles for months. The set of spaces changes only if
-- this design changes, and the writer is one function.

ALTER TABLE user_taste_profiles
  ADD COLUMN IF NOT EXISTS embedding_space TEXT NOT NULL DEFAULT 'raw';

COMMENT ON COLUMN user_taste_profiles.embedding_space IS
  'Which embedding space this centroid was built in: raw | centered. Candidate retrieval must query the matching column.';

DO $$ BEGIN RAISE NOTICE '[0154] Done.'; END $$;
