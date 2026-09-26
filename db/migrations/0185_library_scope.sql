-- Migration: 0185_library_scope
-- Description: One Recommendations switch, and each account's media-server
-- library access cached so everything shown to them can respect it.
--
-- Movies and Series were two permissions for what, in practice, is one decision:
-- does this person get recommendations. Which KINDS of title they get now follows
-- from the libraries the media server lets them see (lib/libraryScope.ts), so a
-- person with no movie library gets no movie recommendations, no movie library
-- output and no movie identity, without anyone switching anything.
--
-- `movies_enabled` and `series_enabled` stay for rollback only; nothing reads
-- them after this migration.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recommendations_enabled BOOLEAN NOT NULL DEFAULT false;

-- Either switch on meant the person got recommendations; no live account had
-- one on and the other off, so nothing is lost by folding them.
UPDATE users
   SET recommendations_enabled = (movies_enabled OR series_enabled)
 WHERE recommendations_enabled IS DISTINCT FROM (movies_enabled OR series_enabled);

COMMENT ON COLUMN users.recommendations_enabled IS
  'Gets recommendations. Which media types follows from library_access (0185).';
COMMENT ON COLUMN users.movies_enabled IS
  'Superseded by recommendations_enabled (0185). Kept for rollback only.';
COMMENT ON COLUMN users.series_enabled IS
  'Superseded by recommendations_enabled (0185). Kept for rollback only.';

-- The media server's per-user library permission (Emby/Jellyfin Policy
-- EnableAllFolders / EnabledFolders), translated to the provider library ids
-- `movies.provider_library_id` and `series.provider_library_id` hold. NULL means
-- every library: either the server grants all folders, or the account has not
-- been read yet -- and "not read yet" must behave as it did before this
-- migration, which was every library. Refreshed by the user sync and at login.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS library_access TEXT[],
  ADD COLUMN IF NOT EXISTS library_access_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN users.library_access IS
  'Provider library ids this account may see on the media server; NULL = all (or not read yet, see library_access_synced_at).';
