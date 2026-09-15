-- Migration: 0174_users_is_enabled_from_switches
-- Description: Re-derive users.is_enabled from the feature switches.
--
-- An account is enabled when Movies, Series, Discover or Collections is on, and an
-- admin who is already enabled stays enabled with every switch off, so switching
-- off your own recommendations cannot lock you out. The rule lives in
-- apps/api/src/lib/accountEnabled.ts; this is it as written today, applied once to
-- rows saved before it existed.
--
-- PUT /api/users/:id cleared is_enabled only when Movies and Series were switched
-- off in the SAME request, while the Users page sends one switch per request. So an
-- account switched off one switch at a time stayed enabled: it could still sign in,
-- its API keys still worked, and it received personal Emby home rows.
--
-- An account this turns off loses web access at once: the session lookup checks
-- is_enabled on every request and deletes a disabled account's sessions.

UPDATE users
SET is_enabled = (movies_enabled OR series_enabled OR discover_enabled OR collections_enabled OR (is_admin AND is_enabled)),
    updated_at = NOW()
WHERE is_enabled IS DISTINCT FROM
      (movies_enabled OR series_enabled OR discover_enabled OR collections_enabled OR (is_admin AND is_enabled));
