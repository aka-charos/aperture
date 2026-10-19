-- Migration: 0210_studio_media_server_images
-- Description: Record which image the media server holds for each studio and
-- network, so Aperture shows the media server's own image first and fetches a
-- TMDb logo only for the names it has none for.
--
-- Before this the logo job never asked the media server what it had: TMDb came
-- first for every name, and the media server's image was only guessed at, by
-- URL, as a last resort. Emby ships its own studio images (about 3,300 names,
-- matched by name, all as Thumb), and a live library held one for 1,497 of its
-- 14,597 studios, including networks TMDb's exact-name lookup misses (FX (US),
-- ABC (US), Lifetime).
--
-- media_item_id: the studio item the media server lists under this name. Its
-- own column, not emby_id: emby_id is rewritten from the studio entries on
-- titles at every run, and two writers on one column means a failed read
-- pairs one item's image tag with another item's id.
-- media_image_type/media_image_tag: the image it holds ('Thumb', else
-- 'Primary') and its tag, which changes when the image does and keys the
-- browser cache. NULL type means it holds none.
-- media_images_read_at: when a read of the media server's studio list first
-- covered this row, or last changed what it recorded. NULL means no read has
-- covered it yet, and readers then fall back to guessing at the media
-- server's Thumb, as before this migration. Unchanged rows are not rewritten.
--
-- The job also stops uploading logos to the media server. That replaced
-- whatever image a studio already had, the built-in one included, and could
-- not see what was there. emby_synced_at is left in place, no longer written,
-- and the setting that switched the upload on is removed.

ALTER TABLE studios_networks
  ADD COLUMN IF NOT EXISTS media_item_id TEXT,
  ADD COLUMN IF NOT EXISTS media_image_type TEXT,
  ADD COLUMN IF NOT EXISTS media_image_tag TEXT,
  ADD COLUMN IF NOT EXISTS media_images_read_at TIMESTAMPTZ;

COMMENT ON COLUMN studios_networks.media_item_id IS 'Media-server studio item listed under this name (from /Studios)';
COMMENT ON COLUMN studios_networks.media_image_type IS 'Image type the media server holds for this studio (Thumb, else Primary); NULL when it holds none';
COMMENT ON COLUMN studios_networks.media_image_tag IS 'Media-server image tag; changes when the image does';
COMMENT ON COLUMN studios_networks.media_images_read_at IS 'When a media-server read first covered this row or last changed it; NULL = never covered';
COMMENT ON COLUMN studios_networks.emby_synced_at IS 'No longer written: Aperture stopped uploading logos to the media server (0210)';

DELETE FROM system_settings WHERE key = 'studio_logos_push_to_emby';
