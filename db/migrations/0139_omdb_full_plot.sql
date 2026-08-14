-- Store IMDb's long synopsis alongside the media server's short overview.
--
-- The OMDb client asked for `plot=short`, which returns roughly what Emby
-- already syncs into movies.overview — so the field was both a near-duplicate
-- and never extracted (OMDbMovieResponse.Plot was typed and read by nothing).
-- `plot=full` costs the same request and the same quota and returns IMDb's
-- user-submitted synopsis, which is several times longer and different in kind:
-- it narrates the story rather than pitching it, naming characters, settings
-- and turns that the blurb never reaches.
--
-- Kept in its own column rather than replacing `overview`, for two reasons.
-- The sync rewrites overview from the media server on every pass, so anything
-- written there is temporary. And the short one is the better text for cards,
-- carousels and the hero — this one is opt-in, because for anything with a
-- twist it routinely gives it away.

ALTER TABLE movies ADD COLUMN IF NOT EXISTS plot_full TEXT;
ALTER TABLE series ADD COLUMN IF NOT EXISTS plot_full TEXT;

COMMENT ON COLUMN movies.plot_full IS
  'IMDb long synopsis from OMDb plot=full; may contain spoilers, so display is opt-in';
COMMENT ON COLUMN series.plot_full IS
  'IMDb long synopsis from OMDb plot=full; may contain spoilers, so display is opt-in';

-- Re-ask OMDb for rows it has already answered.
--
-- omdb_enriched_at (0136) records that OMDb was asked, not *what* it was asked
-- for, so every row enriched before this migration is stamped complete and
-- would never be queried again — the plot would only ever arrive for titles
-- added later. Clearing the stamp where the plot is absent queues exactly the
-- rows that need re-asking.
--
-- The cost is one more OMDb pass. On a patron key (40 req/sec) that is minutes
-- for a full library; on the free tier's 1,000/day it is not, which is worth
-- knowing before running it.
--
-- Note this is the second time a stamp has had to be cleared to widen what
-- enrichment collects. A per-source *version*, rather than a bare timestamp,
-- would make this a config change instead of a migration — worth doing if a
-- third field ever gets added.

UPDATE movies SET omdb_enriched_at = NULL WHERE plot_full IS NULL;
UPDATE series SET omdb_enriched_at = NULL WHERE plot_full IS NULL;
