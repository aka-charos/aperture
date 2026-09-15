-- Migration: 0176_taste_synopsis_version
-- Description: Record which prompt version wrote each Watcher Identity.
--
-- The refresh gate (core lib/tasteSynopsisRefresh.ts) rewrote an identity only
-- when the viewer's taste profile moved. A prompt change moves no profile, so a
-- rewritten prompt reached nobody until their profile happened to rebuild (up to
-- 30 days) and never reached a locked one.
--
-- Prompt version 2 replaces a genre lookup table fed with unwatched favourites
-- counted as watched films (F-129). Every identity written before it is NULL
-- here, which the gate reads as out of date, so each is rewritten once on the
-- viewer's next recommendation run. A fallback blurb is also stored with NULL,
-- so a provider failure retries on the next run instead of standing for good.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS taste_synopsis_version INTEGER,
  ADD COLUMN IF NOT EXISTS series_taste_synopsis_version INTEGER;

COMMENT ON COLUMN user_preferences.taste_synopsis_version IS
  'TASTE_SYNOPSIS_PROMPT_VERSION that wrote taste_synopsis; NULL = written before 0176 or a fallback blurb, rewritten on the next refresh';
COMMENT ON COLUMN user_preferences.series_taste_synopsis_version IS
  'TASTE_SYNOPSIS_PROMPT_VERSION that wrote series_taste_synopsis; NULL = written before 0176 or a fallback blurb, rewritten on the next refresh';
