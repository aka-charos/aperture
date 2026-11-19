-- TMDb person details (biography, birth/death date, birthplace) beside the
-- profile and credits cache. The person page fills a field the media server's
-- Person metadata leaves empty from these (core tmdb/personDetails.ts).
--
-- details_cached_at stamps an ANSWER from TMDb (found, or no such person); a
-- failed lookup stamps nothing, so it is asked again on the next visit.
-- details_tmdb_person_id records whose details these are: the row's person id
-- can be re-resolved, and details never outlive the person they describe.

ALTER TABLE person_tmdb_profile_cache
  ADD COLUMN IF NOT EXISTS details_tmdb_person_id INTEGER,
  ADD COLUMN IF NOT EXISTS biography TEXT,
  ADD COLUMN IF NOT EXISTS birthday DATE,
  ADD COLUMN IF NOT EXISTS deathday DATE,
  ADD COLUMN IF NOT EXISTS place_of_birth TEXT,
  ADD COLUMN IF NOT EXISTS details_cached_at TIMESTAMPTZ;

COMMENT ON COLUMN person_tmdb_profile_cache.details_tmdb_person_id IS 'TMDb person the details columns were read for';
COMMENT ON COLUMN person_tmdb_profile_cache.details_cached_at IS 'When TMDb last answered GET /person/{id}; NULL = never answered';
