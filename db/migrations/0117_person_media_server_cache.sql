-- Cache media server (Emby/Jellyfin) Person item metadata by normalized name key.
-- name_key: lower(trim(name)); collisions for identical strings are accepted per product note
-- (same convention as person_tmdb_profile_cache).

CREATE TABLE IF NOT EXISTS person_media_server_cache (
  name_key TEXT PRIMARY KEY,
  item_id TEXT,
  overview TEXT,
  birth_date TIMESTAMPTZ,
  death_date TIMESTAMPTZ,
  birth_place TEXT,
  not_found BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_person_media_server_cache_updated
  ON person_media_server_cache (updated_at DESC);

COMMENT ON TABLE person_media_server_cache IS 'Media server Person item metadata (bio, birth/death, birthplace) keyed by normalized person name';
COMMENT ON COLUMN person_media_server_cache.item_id IS 'Media server Person item id';
COMMENT ON COLUMN person_media_server_cache.birth_date IS 'Person PremiereDate from the media server';
COMMENT ON COLUMN person_media_server_cache.death_date IS 'Person EndDate from the media server';
COMMENT ON COLUMN person_media_server_cache.birth_place IS 'Person ProductionLocations[0] from the media server';
COMMENT ON COLUMN person_media_server_cache.not_found IS 'True when the media server had no matching Person item; refreshed on TTL';
