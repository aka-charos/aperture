-- Migration: 0189_legacy_library_output_new_installs
-- Description: A new install starts with legacy library output (per-viewer
--              AI Picks and shared Top Picks libraries written as STRM files
--              or symlinks) switched OFF. An existing install keeps it ON.
--
-- The switch is `system_settings.legacy_library_output_enabled`, and ABSENT
-- MEANS ON — which is what every instance did before the switch existed, and
-- must keep doing. So this writes nothing for an instance that has finished
-- setup or has ever made a library, and an explicit 'false' otherwise.
--
-- A migration rather than a write from the setup wizard, because this is the
-- one moment that can tell the two apart for certain: on a fresh database
-- every migration runs before the wizard's first request, and on an existing
-- one this runs once, at the upgrade. The wizard would have to guess "new" from
-- state it is itself in the middle of creating.
--
-- A backup restored afterwards brings its own system_settings, so a restored
-- instance keeps whatever it had.

INSERT INTO system_settings (key, value, description)
SELECT 'legacy_library_output_enabled',
       'false',
       'Write per-viewer AI Picks and Top Picks libraries as STRM files or symlinks (legacy; Emby home rows replace it)'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'setup_complete' AND value = 'true')
  AND NOT EXISTS (SELECT 1 FROM setup_progress WHERE completed_at IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM strm_libraries)
ON CONFLICT (key) DO NOTHING;
