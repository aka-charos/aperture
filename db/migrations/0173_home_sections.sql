-- Migration: 0173_home_sections
-- Description: Managed rows on each viewer's Emby home screen — a Top Picks row
--              per media type, a per-viewer "Recommended for You" row, and any
--              generated playlist its owner chooses to show there.
--
-- API-ONLY BY DESIGN. Every row is an Emby dynamic-media section whose query is
-- a tag, and the tag is written onto the ORIGINAL library items through
-- `POST /Items/{Id}/Tags/Add`. No STRM, no duplicate items, nothing on disk.
-- The existing Top Picks collection was not reused: it is built from the Top
-- Picks STRM library's own items (topPicks/collectionWriter.ts), so a row
-- pointing at it would show duplicates and would exist only while library
-- output is switched on.
--
-- Every tag this feature writes starts with `aperture:`, and both media-server
-- mappers drop tags with that prefix on the way in (media/managedTags.ts).
-- Without that, the next library sync reads the tag back into `movies.tags`,
-- the canonical text embeds it as a "Theme", and titles recommended to the same
-- viewer drift toward each other in vector space — a feedback loop.
--
-- No table records which Emby section is ours. The tag a section queries IS the
-- marker: each managed row queries exactly one `aperture:` tag, so reading a
-- viewer's sections back identifies ours by tag id, survives the viewer renaming
-- the row in Emby, and cannot go stale the way a stored section id would.

CREATE TABLE IF NOT EXISTS home_sections_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  top_picks_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  recommendations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Whether viewers may put their own generated playlists on their home screen.
  playlists_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Index passed to HomeSections/Move; 0 is the top of the home screen.
  section_position INTEGER NOT NULL DEFAULT 0 CHECK (section_position >= 0),
  -- The position the last sync actually applied. Rows are moved only when they
  -- are created or when this differs from section_position, so a viewer who
  -- rearranges their own home screen is not overruled every night.
  applied_section_position INTEGER,
  top_picks_movies_name TEXT NOT NULL DEFAULT 'Top Picks: Movies',
  top_picks_series_name TEXT NOT NULL DEFAULT 'Top Picks: Series',
  recommendations_name TEXT NOT NULL DEFAULT 'Recommended for You',
  -- A tag carries no order, so rows sort by a server-side field. Random is the
  -- honest default: a list with no rank should not pretend to have one.
  sort_by TEXT NOT NULL DEFAULT 'Random',
  -- Per media type. Caps how many titles are TAGGED; a section has no item limit
  -- of its own, so this is also what the recommendations row displays.
  recommendations_limit INTEGER NOT NULL DEFAULT 20 CHECK (recommendations_limit BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO home_sections_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Each viewer's recommendation tag. A random token rather than anything derived
-- from the viewer: tags are global and browsable in Emby, and a name built from
-- the Emby user id (which `/Users/Public` hands to anyone) would let one
-- household member look up another's recommendations by name.
--
-- ON DELETE CASCADE loses the token when the user row goes, which is safe: the
-- sync treats any `aperture:` tag it cannot account for as an orphan and strips
-- it from every item.
CREATE TABLE IF NOT EXISTS home_sections_viewer_tags (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A generated playlist on its owner's home screen. The column IS the opt-in: a
-- random `aperture:playlist-…` tag when the owner switched it on, NULL when not.
-- Clearing it leaves a tag nobody accounts for, which the next sync strips from
-- every item along with the row — so there is no second flag to fall out of step.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS home_section_tag TEXT UNIQUE;

-- Who made a graph playlist. The assistant's "create playlist from these" dialog
-- and the Explore similarity graph both write this table through one route, and
-- only the assistant's playlists may go on a home screen. Rows from before this
-- migration read as 'graph': which of them came from the chat was never recorded.
ALTER TABLE graph_playlists
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'graph' CHECK (origin IN ('graph', 'chat'));
ALTER TABLE graph_playlists ADD COLUMN IF NOT EXISTS home_section_tag TEXT UNIQUE;

COMMENT ON COLUMN channels.home_section_tag IS
  'Random aperture:playlist tag when the owner put this playlist/collection on their Emby home screen; NULL otherwise.';
COMMENT ON COLUMN graph_playlists.origin IS
  'graph = built on the Explore similarity graph; chat = created from assistant suggestions. Only chat playlists may go on a home screen.';

-- Daily at 05:45: after refresh-top-picks (05:00), clear of enrich-studio-logos
-- (05:30). Enabled here and gated inside — with the feature off, a run removes
-- whatever rows and tags an earlier run left, then exits.
INSERT INTO job_config (job_name, schedule_type, schedule_hour, schedule_minute, is_enabled)
VALUES ('sync-home-sections', 'daily', 5, 45, true)
ON CONFLICT (job_name) DO NOTHING;
