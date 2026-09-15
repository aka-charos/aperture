-- Migration: 0175_home_section_placement
-- Description: Where each managed home row goes, per feature, with an admin
--              default and a per-viewer override; and recommendations split
--              into a movies row and a series row.
--
-- A single "position" index could not work across accounts: measured on a live
-- server, My Media sat at position 0, 4, 14, 15 or 16 depending on the account.
-- A placement is now one of top, bottom, a position number (counted among the
-- viewer's own rows, never Aperture's), or after/before another row. Built-in
-- rows share ids across accounts (`smalllibrarytiles`, `resume`,
-- `latestmedia_<library id>`), so an anchor chosen once is found on every
-- account by id; `anchor_type` finds it when an account shows the same row
-- under a sibling id (My Media as `librarybuttons`).
--
-- section_position, applied_section_position and recommendations_name are
-- superseded and left in place, so an older image still reads sane values.

ALTER TABLE home_sections_config
  ADD COLUMN IF NOT EXISTS recommendations_movies_name TEXT NOT NULL DEFAULT 'Recommended Movies',
  ADD COLUMN IF NOT EXISTS recommendations_series_name TEXT NOT NULL DEFAULT 'Recommended Series';

COMMENT ON COLUMN home_sections_config.section_position IS
  'Superseded by home_sections_placements (0175). Kept for rollback only.';
COMMENT ON COLUMN home_sections_config.applied_section_position IS
  'Superseded by home_sections_applied_placements (0175). Kept for rollback only.';
COMMENT ON COLUMN home_sections_config.recommendations_name IS
  'Superseded by recommendations_movies_name and recommendations_series_name (0175). Kept for rollback only.';

-- The admin default per feature. `fallback_*` is what an account gets when an
-- after/before anchor is not on its home screen at all.
CREATE TABLE IF NOT EXISTS home_sections_placements (
  feature TEXT PRIMARY KEY
    CHECK (feature IN ('top-picks-movies', 'top-picks-series', 'recs-movies', 'recs-series', 'playlists')),
  mode TEXT NOT NULL DEFAULT 'top' CHECK (mode IN ('top', 'bottom', 'position', 'after', 'before')),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 50),
  anchor_id TEXT,
  anchor_type TEXT,
  anchor_name TEXT,
  fallback_mode TEXT NOT NULL DEFAULT 'bottom' CHECK (fallback_mode IN ('top', 'bottom', 'position')),
  fallback_position INTEGER NOT NULL DEFAULT 0 CHECK (fallback_position BETWEEN 0 AND 50),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (mode NOT IN ('after', 'before') OR anchor_id IS NOT NULL)
);

-- Every feature starts where the single setting put all rows before.
INSERT INTO home_sections_placements (feature, mode, position)
SELECT f.feature, 'position', LEAST(GREATEST(COALESCE(c.section_position, 0), 0), 50)
FROM (VALUES ('top-picks-movies'), ('top-picks-series'), ('recs-movies'), ('recs-series'), ('playlists')) AS f(feature)
LEFT JOIN home_sections_config c ON c.id = 1
ON CONFLICT (feature) DO NOTHING;

-- A viewer's own choice for a feature. No fallback of its own: an override whose
-- anchor has gone from the viewer's home screen falls back to the admin default.
CREATE TABLE IF NOT EXISTS home_sections_user_placements (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL
    CHECK (feature IN ('top-picks-movies', 'top-picks-series', 'recs-movies', 'recs-series', 'playlists')),
  mode TEXT NOT NULL CHECK (mode IN ('top', 'bottom', 'position', 'after', 'before')),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 50),
  anchor_id TEXT,
  anchor_type TEXT,
  anchor_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, feature),
  CHECK (mode NOT IN ('after', 'before') OR anchor_id IS NOT NULL)
);

-- The placement last applied to a viewer's rows of a feature, as a key. Rows move
-- only when created or when this differs from the placement that applies now,
-- so a viewer who drags a row in Emby keeps it where they put it.
CREATE TABLE IF NOT EXISTS home_sections_applied_placements (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  placement_key TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, feature)
);
