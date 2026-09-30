-- Migration: 0188_home_sections_viewer_rows
-- Description: Each viewer switches the managed rows on their own Emby home
--              screen on and off, and a fifth row kind — titles their
--              connections recommended to them — joins the other four.
--
-- A viewer's switch is stored only once they touch it. ABSENT MEANS ON, which
-- is exactly what every viewer got before this migration: nothing changes on
-- anybody's home screen until they choose otherwise.
--
-- The friends row is switched OFF server-wide by default. Before this migration
-- nothing a connection recommended ever reached Emby, so switching it on is the
-- operator's decision, not something a deploy does to every home screen.

ALTER TABLE home_sections_config
  ADD COLUMN IF NOT EXISTS friends_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS friends_name TEXT NOT NULL DEFAULT 'Recommended by Friends';

-- The feature vocabulary lives in code (`PLACEMENT_FEATURES`, read back through
-- `isPlacementFeature`, which skips anything unknown). A copy in a CHECK is a
-- second list that a new row kind has to find and widen in a migration, or
-- every save of its placement fails with a constraint error; 0175's copies are
-- dropped rather than widened, as 0144 did for AI roles.
ALTER TABLE home_sections_placements DROP CONSTRAINT IF EXISTS home_sections_placements_feature_check;
ALTER TABLE home_sections_user_placements DROP CONSTRAINT IF EXISTS home_sections_user_placements_feature_check;

-- The friends row starts where the series recommendations row is placed, so it
-- lands beside the other personal rows rather than jumping to the top.
INSERT INTO home_sections_placements
  (feature, mode, position, anchor_id, anchor_type, anchor_name, fallback_mode, fallback_position)
SELECT 'friends', mode, position, anchor_id, anchor_type, anchor_name, fallback_mode, fallback_position
FROM home_sections_placements
WHERE feature = 'recs-series'
ON CONFLICT (feature) DO NOTHING;

-- One viewer's own on/off per row kind. Playlists are not here: each playlist
-- is put on the home screen one at a time (`home_section_tag`), which is
-- already a per-viewer switch.
CREATE TABLE IF NOT EXISTS home_sections_user_rows (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, feature)
);

COMMENT ON TABLE home_sections_user_rows IS
  'A viewer''s own switch for each managed Emby home row kind. Absent means on (0188).';
