-- Migration: 0192_series_tmdb_creators
-- Description: Keep TMDb's series creators in their own column.
--
-- Measured on a live library, 978 of 986 shows had no creator: the series sync
-- reads "Director"/"Creator" people from the media server, which supplies none
-- for nearly every show. Enrichment already fetches TMDb's /tv/{id} details,
-- whose `created_by` names them, and discarded it — so the decision model and
-- the director-or-franchise rule could not see that 1923 and Tulsa King share
-- a creator.
--
-- Not written into series.directors, for the reason plot_full got its own
-- column (F-085): the series sync rewrites `directors` from the media server
-- on every pass, so anything enrichment put there would be wiped to {} within
-- hours, and `directors` feeds the embedded "Created by" line, so the text
-- would flip back and forth. Nothing here reaches the embeddings; readers that
-- want creators fall back to this column when `directors` is empty.
--
-- tmdb_creators: TMDb's created_by names; '{}' means TMDb credits nobody.
-- tmdb_creators_fetched_at: when TMDb last answered for this show. NULL means
--   never asked (or every attempt failed), which is what the enrichment job's
--   backfill step selects.

ALTER TABLE series ADD COLUMN IF NOT EXISTS tmdb_creators TEXT[];
ALTER TABLE series ADD COLUMN IF NOT EXISTS tmdb_creators_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN series.tmdb_creators IS
  'TMDb created_by names; read when the media server supplies no creators. Never embedded.';
COMMENT ON COLUMN series.tmdb_creators_fetched_at IS
  'When TMDb last answered for creators; NULL = not yet asked, selected by the enrichment backfill';
