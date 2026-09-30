-- Migration: 0190_strm_library_scopes
-- Description: Record which libraries (and which parental ceiling) each
--              viewer's generated AI Picks library was last written under.
--
-- A generated library points straight at the original files, so a title in it
-- is playable even when the media server hides its library from the viewer
-- (F-136). While legacy library output is ON that cannot last: every sync
-- rewrites the library from the viewer's scope as it is now. While it is OFF
-- the library is frozen, nothing rewrites it, and a viewer whose access has
-- since narrowed would keep playable titles from a library they may no longer
-- open (F-142).
--
-- The files are named by title and year, not by id, so what a frozen library
-- holds cannot be read back from the disk. The scope it was written under can
-- be recorded instead: a frozen library is kept only while its owner may still
-- open everything that scope allowed, and removed otherwise.
--
-- A separate table, not columns on strm_libraries, because those rows are
-- deleted and re-inserted by every library sync, which would wipe the record
-- between the write and the next check. NO ROW means the scope was never
-- recorded (a library written before this migration); library_ids NULL means
-- nothing restricted it.

CREATE TABLE IF NOT EXISTS strm_library_scopes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL,
  library_ids TEXT[],
  max_parental_rating INTEGER,
  written_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, media_type)
);
