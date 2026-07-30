-- Migration: 0127_drop_provider_access_token
-- Description: Stop storing per-user media server access tokens.
--
-- users.provider_access_token held a live Emby/Jellyfin credential for every
-- user, written on each login and never read back by any code path — all
-- server-side media server calls authenticate with the admin API key from
-- system_settings. It was pure liability in a backup or a table read.
--
-- Cleared before the drop so the values are gone from the heap even where a
-- tool inspects the pre-drop state.

UPDATE users SET provider_access_token = NULL WHERE provider_access_token IS NOT NULL;

ALTER TABLE users DROP COLUMN provider_access_token;
