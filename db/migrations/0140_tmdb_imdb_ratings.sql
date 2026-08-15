-- Keep the two ratings we were already being handed and discarding.
--
-- TMDb: getMovieEnrichmentData/getSeriesEnrichmentData already call
-- /movie/{id} and /tv/{id} — for the collection, the crew and the production
-- companies — and `vote_average`/`vote_count` arrive on that same response and
-- were dropped on the floor. No extra request and no extra quota; the app was
-- collecting Rotten Tomatoes, Metacritic and Letterboxd while throwing away a
-- score it already held.
--
-- IMDb: the app does display a 0-10 score, but it reads movies.community_rating,
-- which the media server syncs. For Emby that value *is* the IMDb rating, so it
-- was correct by inheritance — with no vote count, and dependent on a field
-- another product decides the meaning of. OMDb returns imdbRating and imdbVotes
-- in the response enrichment already parses.
--
-- Vote counts are the point as much as the scores. 8.2 from 22,000 votes and
-- 8.2 from six are not the same claim, and every score on the detail page has
-- that ambiguity today.
--
-- NUMERIC(3,1) holds 0.0-99.9, which covers both scales (TMDb and IMDb are
-- both out of 10) with room to spare. Nullable throughout: "nobody has rated
-- this" is not a rating of zero, and rendering it as one would put unrated
-- titles at the bottom of every sort.

ALTER TABLE movies ADD COLUMN IF NOT EXISTS tmdb_rating NUMERIC(3,1);
ALTER TABLE movies ADD COLUMN IF NOT EXISTS tmdb_vote_count INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS imdb_rating NUMERIC(3,1);
ALTER TABLE movies ADD COLUMN IF NOT EXISTS imdb_vote_count INTEGER;

ALTER TABLE series ADD COLUMN IF NOT EXISTS tmdb_rating NUMERIC(3,1);
ALTER TABLE series ADD COLUMN IF NOT EXISTS tmdb_vote_count INTEGER;
ALTER TABLE series ADD COLUMN IF NOT EXISTS imdb_rating NUMERIC(3,1);
ALTER TABLE series ADD COLUMN IF NOT EXISTS imdb_vote_count INTEGER;

COMMENT ON COLUMN movies.tmdb_rating IS 'TMDb vote_average (0-10), from the details call enrichment already makes';
COMMENT ON COLUMN movies.tmdb_vote_count IS 'TMDb vote_count — without it the rating cannot be read honestly';
COMMENT ON COLUMN movies.imdb_rating IS 'IMDb rating from OMDb; community_rating carries the same number for Emby but no provenance';
COMMENT ON COLUMN movies.imdb_vote_count IS 'IMDb vote count from OMDb imdbVotes';

-- No stamp clearing needed here. 0139 already nulls omdb_enriched_at across
-- both tables, which re-selects every row, and enrichMovie/enrichSeries call
-- TMDb and OMDb together on any row they process — so a single pass fills all
-- four columns. Shipping 0140 without 0139 in the same deploy would silently
-- leave already-enriched rows empty forever.
