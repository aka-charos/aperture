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
-- media_image_type/media_image_tag: the image the media server holds ('Thumb',
-- else 'Primary') and its tag, which changes when the image does and keys the
-- browser cache. NULL type means it holds none. media_images_read_at: when the
-- job last read the media server's studio list; NULL means never read, and the
-- row is then treated as having no media-server image.
--
-- The job also stops uploading logos to the media server. That replaced
-- whatever image a studio already had, the built-in one included, and could
-- not see what was there. emby_synced_at is left in place, no longer written,
-- and the setting that switched the upload on is removed.

ALTER TABLE studios_networks
  ADD COLUMN IF NOT EXISTS media_image_type TEXT,
  ADD COLUMN IF NOT EXISTS media_image_tag TEXT,
  ADD COLUMN IF NOT EXISTS media_images_read_at TIMESTAMPTZ;

COMMENT ON COLUMN studios_networks.media_image_type IS 'Image type the media server holds for this studio (Thumb, else Primary); NULL when it holds none';
COMMENT ON COLUMN studios_networks.media_image_tag IS 'Media-server image tag; changes when the image does';
COMMENT ON COLUMN studios_networks.media_images_read_at IS 'When the logo job last read the media server studio list';
COMMENT ON COLUMN studios_networks.emby_synced_at IS 'No longer written: Aperture stopped uploading logos to the media server (0210)';

DELETE FROM system_settings WHERE key = 'studio_logos_push_to_emby';
