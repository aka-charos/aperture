# Plan: Social layer — admin-managed connections, shared watch activity, peer recommendations

Status: **implemented 2026-09-27** (evidence record: F-138 in `docs/aperture-forensics.md`).
Spec written 2026-09-11, re-validated and revised 2026-09-27 against `dev` at `c89927ef`
(library scope, F-136). The new SQL has been typechecked, linted and scanned but not yet run
against Postgres; the first deploy is the first execution.

Deviations from the text below, all small:

- Stale-response guards use a per-effect flag (dialogs) or a request counter (Watch History)
  rather than `useRequestGuard`, which was still uncommitted work of its own (F-137).
- `sharedWithMe.loadFailed` was added (the page needed a load-failure line and
  `common.errors.loadFailed` does not exist), and the admin dialog's close button reuses
  `common.close`.
- `pages/UserConnectionsDialog.tsx` was added to `ADMIN_SURFACE_PATHS` in `i18n/audience.ts`.
  The `admin` namespace is already admin-only, and its test requires every file reading it to
  be an admin surface. `ADMIN_ONLY_NAMESPACES` is unchanged, as §7.9 says.
- `watcherVisibility.ts` gained `watcherAudienceFor(viewer)`, so the two watch-stats handlers
  share one call instead of each fetching connection ids.

Changed after the first deploy (2026-09-28 and 2026-09-29, owner's call), each overriding the
text below:

- **The dashboard rows sit directly under Top Picks**, above the Recent Watches/Ratings grid.
  At the bottom they were ~3,000px down and read as missing. They moved up to just after
  Upcoming Episodes on 2026-09-28, then down to under Top Picks on 2026-09-29. This replaces
  the §1.1 "Dashboard" row and the §7.6 placement.
- **The Shared with me entry is listed only while the inbox holds something** (2026-09-29),
  and while the viewer is on the page, so dismissing the last title does not remove the
  selected entry. An empty inbox in the sidebar read as clutter. The count it keys on is the
  badge count, so the two cannot disagree. The route stays reachable by URL and keeps its
  empty state. Because the entry now depends on the count, `ConnectionsProvider` also
  re-reads the count on navigation, under the same once-a-minute limit as focus, so a share
  surfaces at the recipient's next click. A timer was rejected, since it costs requests while
  nobody is looking. This adds to §7.2.
- **"Recently watched by" counts played titles only** (`WATCH_HISTORY_PLAYED_SQL`), not
  `WATCHED_SQL`. On the live instance a film the connection had only started sat in their row
  while its title page said nobody had watched it. This replaces §6.3's predicate.
- **`social` is re-read without a reload** (§6.7 said "a full load"). The admin dialog re-reads
  it after every change, and `ConnectionsProvider` re-reads it when the window regains focus,
  at most once a minute, through the new `refreshCapabilities()` on the auth context. That
  function changes nothing on a failure or an answer about another account; `checkAuth` would
  log the viewer out on a blip. The first person connected on the live instance saw no
  change until they reloaded, and took the feature for missing.

Written for implementer agents. Every path, symbol, SQL shape and i18n key below was checked
against the tree on the revision date. **Line numbers are approximate — search by symbol.**
Where the codebase already supplies a mechanism, this spec names it and does not reinvent it.
The product decisions in §1.1 were confirmed with the product owner and are **locked**. The
decisions in §1.2 were added by this revision as defaults. Each one says why, and the owner
may flip any of them (§12).

---

## 0. What changed in this revision (read first if you saw the 2026-09-11 text)

Six weeks of `dev` landed between the two versions: library scope (F-136), capabilities
(F-132), API-key scopes and the route-guard scan (F-133), the permission audit and decided
client capabilities (F-134), the explicit Access switch (F-135), and search keys (F-130).
The original text predates all of them.

**Factual corrections (the old text was wrong about the tree):**

| Old claim | Reality on 2026-09-27 | Consequence here |
|---|---|---|
| Migrations top out at `0170`; use `0171`/`0172` | `0171`/`0172` are the analysis bench's; the tree is at `0185_library_scope.sql` | Use **`0186`/`0187`** (or the next free pair at implementation time) |
| Both mark-unwatched DELETEs live in `watchHistory.ts` | They moved to `watchHistoryManagement.ts` with the single-movie GET and the mark-watched POST. `watchHistory.ts` holds only the two list GETs | The guard widening touches `watchHistory.ts` only (§6.5) |
| `watchersAdminOnly` is referenced by no component | `WatcherListDialog.tsx` renders it as the dialog footer | Keep it for the admin audience and add **new** keys for the connections audience. Never reword it (§7.4, §8 rule 14) |
| No MUI `Badge` anywhere in `apps/web/src` | Used in `AdminNavColumn`, `MediaPosterCard`, Top Picks, Watching, Browse and others | Plain MUI; nothing new (§7.2) |
| `/api/users/:id/avatar` is an unauthenticated proxy | `requireAuth` since F-133. Any signed-in user may fetch any user's avatar | Still the right URL for connection avatars. The comment was wrong (§5.1) |
| Dashboard recent watches: movie branch joins `library_config` + `LIBRARY_ENABLED_SQL`, series has none ("mirror the asymmetry") | Neither recent-watches query filters by library (only the stats queries do), neither selects `genres`, and `routes/dashboard` now imports `idsInScope` and core | Recent watches for connections apply the **viewer's scope** to both branches and select `genres` (§6.3) |
| "`routes/dashboard` is deliberately pure SQL with no core imports" | Out of date (it imports `idsInScope`, and `getTopMovies`/`getTopSeries` dynamically) | Rule 7 of §8 now reads "don't add social rows to the dashboard endpoint" |
| Sidebar gating: special-case the path, "do not use `feature:`" | `NavItem` gained `capability?: string`, read from server-decided `capabilities` (F-134) | The nav item carries `capability: 'social'`, a decided value on `/api/auth/check` (§6.7, §7.2) |
| Hook trio named `ConnectionsContext.tsx` (Watching template) | The house convention is `XProvider.tsx` + `x-context.ts` + `useX.ts` (`WatchStatusProvider` is the newest) | `ConnectionsProvider.tsx` / `connections-context.ts` / `useConnections.ts` (§7.1) |
| `Users.tsx` menus at ~972 / ~1385 | Desktop `<Menu>` ~1040, mobile ~1470; the rows now carry `renderViewAsMenuItem()` | Add the item to both, next to "View as" (§7.8) |
| Root barrel "follows how `watching` is exported" (implied `export *`) | The barrel uses explicit **named** exports and is ~1600 lines. Recent modules (`homeSections`, `permissionAudit`, `libraryScope`) are root-barrel only, with no subpath | Named root-barrel exports, **no `./social` subpath** (§5.4) |

**Logic gaps closed (the old design was unsound or leaked):**

1. **Library scope was ignored everywhere.** A connected viewer would see titles from
   libraries the media server hides from them, or above their parental rating, in the other
   person's history and recent-watches sliders. Opening one of those posters then answers
   "not found" (`titleInScope`), which reads as a bug. The inbox and the recommend POST also
   ignored the recipient's scope, so a title could be sent to someone who can never open it.
   The row would sit in their badge count forever. Fixed in §5.3, §6.3, §6.5 and §6.2.
2. **The recommend POST did not check the recommender's own scope.** Any signed-in user
   could POST an arbitrary movie id and learn from 404 vs 200 whether it exists on the
   server. It now answers exactly like the detail page (`titleInScope`, 404).
3. **"Enabled" meant `is_enabled` only.** A connection whose media-server account is
   disabled (`provider_disabled`) stayed visible even though every per-user job and the
   session lookup refuse that account. There is now one definition of a *visible
   connection* (§5.1): `is_enabled AND NOT provider_disabled`.
4. **Removing a connection left the other person's recommendations in the inbox**, still
   naming them. Every social read now goes through the visible-connection relation (§1.2).
5. **The badge count re-computed the recipient's whole-library watch status** on every page
   load (`getWatchStatusForUser`, which `/api/watch-status` already runs once per load).
   The inbox now tests "finished" in SQL against its own handful of rows. The shared
   predicate lives beside the badge supplier so the two rules cannot drift (§5.2).
6. **The pair was ordered in TypeScript** (`a < b` on strings), which disagrees with
   Postgres' uuid ordering as soon as a client sends upper- or mixed-case ids. The CHECK then
   fails and the request 500s. The database orders the pair now (`LEAST`/`GREATEST`), and
   TypeScript never compares uuids (§5.1).
7. **`dismiss` answered 403 for someone else's row**, which confirms the row exists. It now
   answers 404 either way, and is idempotent (§6.2).
8. **Rewording `watchersAdminOnly` in `en` would have left 14 locales saying "Only admins
   can see these names" to non-admins.** `i18n:sync` fills missing keys and never overwrites.
   New meaning, new key (§7.9).
9. **The strip's copy was never specified.** With partial names, "Click to see everyone" is
   false, and the viewer's own watch was counted among the anonymous "others". Both are
   specified now (§6.4, §7.4).
10. **The client decided which footer to show from `user.isAdmin`.** That is a second copy
    of the audience rule in the bundle (F-134). The server now ships a decided
    `watcherAudience` (§6.4).
11. **Five newer repo rules were absent:** the route-guard scan, the library-scope call-site
    scan (whose `watchHistory.ts` exemption **must be removed**, or its stale-entry test
    fails), the permission audit, decided capabilities, and `requestWrites`. All are in §8.

---

## 1. Feature summary and decisions

The admin pairs Aperture users ("connections"). Users never manage connections themselves and
cannot see the pairing UI. Once connected, two users mutually get:

1. **Named watchers on item pages.** The community strip on a movie/series page keeps its
   anonymous counts, and its hover summary and drill-in dialog name the viewer ("You") and
   their connections, e.g. "You, Joe, Tom and 3 others you're not connected to".
2. **Each other's watch history.** The Watch History page gains a "whose history" selector.
   Picking a connection loads their history read-only, limited to titles the *viewer* may
   open.
3. **Recommendations.** A "Recommend to…" button on an item's action row opens a multi-select
   dialog of connections. Each recipient gets the item in a per-recommender inbox list
   ("Recommended by Joe"). An item leaves the inbox when the recipient finishes it (derived
   from `watch_history.played`, never stored), dismisses it, or can no longer see it.
4. **Dashboard sliders.** Below the user's own lists, one carousel per connection shows that
   connection's recently watched items ("Recently watched by Tom").

### 1.1 Locked (product owner, 2026-09-11)

| Decision | Value |
|---|---|
| Sharing gate | Connect = full mutual visibility. No per-user opt-in toggle. |
| Item-page counters | Anonymous household counts stay for everyone; connected users are *added* as names. |
| Recommend picker | Multi-select recipients in one dialog. |
| Recommendation playlists | In-app only. Nothing is written to Emby/Jellyfin. |
| Dashboard | Own rows stay first; connected-user sliders appended after own Recent Watches/Ratings. **Superseded 2026-09-29:** directly under Top Picks (see the top of this file). |

### 1.2 Added by this revision (defaults — see §12 to flip)

| Decision | Default | Why |
|---|---|---|
| Library scope on shared surfaces | Everything a viewer is shown from another person's activity is intersected with the **viewer's** scope. A recommendation must be in the **recipient's** scope to be sent or shown. | F-136: a viewer is shown only what the media server lets them open. A poster that 404s when clicked is the failure this prevents. |
| Visible connection | Connected **and** the other account has access (`is_enabled`) **and** is not disabled on the media server (`NOT provider_disabled`). Rows are kept; visibility returns when access does. | Matches the session lookup and every per-user job. F-135: switching access off keeps setup. |
| Inbox after disconnect | Filtered at read, not deleted. Reconnecting brings pending items back. | One rule ("every social read goes through the visible-connection relation") instead of a delete path plus a filter. |
| The viewer in the named list | The viewer's own play is named "You" whenever they have at least one connection. | Otherwise "Joe and 1 other" counts the viewer as a stranger, on a page they're looking at. |
| Sidebar label | **"Shared with me"** (route `/shared-with-me`), not "Recommended for me" | The sidebar already has "Recommendations" (the AI list) one row above. Two near-identical labels for unrelated pages is a support question. |
| Audit | Connecting and disconnecting are recorded in `permission_changes` for both people. | F-134: "every permission change is recorded". A connection grants read access to someone's watch history. |

## 2. Non-goals (explicitly out of scope)

- **No notifications.** There is no in-app notification system, and nothing sends email.
  (`email_notifications_*` are stored preferences with no sender in core or api.) The
  sidebar badge plus the inbox page is the delivery surface.
- No media-server playlist writing and no Emby home-screen row for received recommendations.
  That is the Channels/Graph-playlists and `homeSections/` machinery; not reused.
- No per-user privacy toggles, no "hidden user", no directional "follow".
- The per-user Watch Stats page (`/stats`) and its breakdown stay self-or-admin. Connected
  access covers the two watch-history list GETs only. Ratings are not shared.
- **The assistant gets nothing.** No tool reads connections, another user's history or the
  inbox. `ToolContext` is unchanged. The model must never receive an identity it could name
  (F-006).
- No recommender-side "sent" view, no un-send/revoke, no message or note with a
  recommendation. (A `note` column would be additive later.)
- Dashboard quick-stats stay personal.
- Admin impersonation keeps its read-only guard unchanged. The new POSTs are refused during
  "view as" by `lib/requestWrites.ts` (every unsafe method is a write unless listed in
  `READ_ONLY_POSTS`). **Add nothing to either exception list.**

## 3. What already exists (verified 2026-09-27) — the seams this feature fills

- **`apps/api/src/lib/watcherVisibility.ts`** decides who may be *named* in a title's watch
  counters. `resolveWatcherAudience(viewer)` returns `{ kind: 'all' }` for admins and
  `{ kind: 'none' }` otherwise. The union already declares the unused branch
  `{ kind: 'users'; userIds: string[] }`, and `audienceClause` already turns it into
  `AND wh.user_id = ANY($n::uuid[])`. `fetchMovieWatchers`/`fetchSeriesWatchers` return
  `undefined` for "nobody may be named", which is how the handlers omit the `watchers` key.
  Call sites, exactly two: `routes/movies/handlers/watchStats.ts` (~line 86) and
  `routes/series/handlers/watchStats.ts` (~line 123). Both already gate the title with
  `titleInScope`. `NAME_SQL` there is the display-name rule
  (`COALESCE(NULLIF(TRIM(COALESCE(display_name,'')),''), username)`).
- **F-110** (`docs/aperture-forensics.md`) is the design record for that module. It
  anticipates this feature: keep the aggregate as the true total and treat names as a
  separate claim. It also names three questions: mutual vs directional (answered: mutual),
  per-user opt-out (answered: none, §1.1), and **small-N inference** (accepted, §9).
- **Watch history lists**: `GET /api/users/:id/watch-history` and
  `GET /api/users/:id/series-watch-history` live in
  `routes/users/handlers/profile/watchHistory.ts`, guarded by `requireSelfOrAdmin`
  (`profile/shared.ts`). Their SQL numbers placeholders by fixed position (`$2` for search,
  computed `limitIdx`), and `"all"` includes in-progress rows and returns `is_favorite`.
  Everything else in `watchHistoryManagement.ts` keeps `requireSelfOrAdmin` (single-movie
  GET, mark-watched POST, three DELETEs).
- **Library scope** (F-136): core `lib/libraryScope.ts` (`getLibraryScopeForUser`,
  `loadConfiguredLibraries`, `libraryScopeSql`, `binderFor`, `scopedAnnQuery`) and api
  `lib/viewerScope.ts` (`viewerScope`, `scopeClause`, `titleInScope`, `idsInScope`).
  `routes/libraryScopeCallSites.test.ts` fails on a route file that reads
  `movies`/`series`/`episodes` without naming a scope helper. It lists
  `users/handlers/profile/watchHistory.ts` in `EXEMPT` as "own watch history", **and fails
  on an exemption that has become stale**.
- **Finished-ness**: core `watching/watchedItems.ts` `getWatchStatusForUser` is the poster
  badge's whole-library answer. A movie is finished when `played = true`. A series is
  finished when it has >0 episodes with `season_number > 0` and all of them are played. The
  client mirror is `WatchStatusProvider` (`useWatchStatus().isWatched/getEpisodeProgress`).
- **Watched predicates**: core `recommender/watchedExclusion.ts`
  `WATCH_HISTORY_PLAYED_SQL = (wh.played = true)` (root-barrel export). Api-side
  `profile/watchStatsFilters.ts` `WATCHED_SQL` (played OR replayed OR in progress, bookmarks
  excluded) and `LIBRARY_ENABLED_SQL`. `recommender/watchHistoryCallSites.test.ts` (core
  `test:exclusion`) scans **both packages** and fails on a `watch_history` literal naming
  none of them.
- **Capabilities**: `apps/api/src/lib/permissions.ts` (`can`, `requireCapability`,
  `capabilitiesFor`). `routes/auth/index.ts` `decidedCapabilities` already mixes decided
  *data* into the map (`movies`/`series` from library scope). The same map rides on
  `/api/auth/check`, `/me` and `/login`. The web reads it via `useCapability(name)`, and
  `Layout.tsx`'s `NavItem` has `capability?: string`.
- **Write classification**: `apps/api/src/lib/requestWrites.ts` is shared by the
  read-only assumed session (`IMPERSONATION_READ_ONLY`) and read-only API keys
  (`API_KEY_READ_ONLY`).
- **Route guard scan**: `routes/routeGuards.test.ts` (api `test:routes`) matches
  `fastify.<method>(` registrations and fails on one with no `preHandler` that is not
  allowlisted.
- **Permission audit**: core `permissionAudit.ts` (`recordPermissionChanges(actor, subject,
  changes)`, `getPermissionHistory`), table `permission_changes` (`0183`), rendered by
  `pages/UserDetail.tsx` as `admin.userDetail.permissionField.<field>` with a
  Granted/Revoked chip from `newValue === 'true'`. Actors are built as
  `{ userId: currentUser.id, label: currentUser.username }` (see `users/handlers/list.ts`).
- **Dashboard**: `pages/dashboard/index.tsx` renders `MediaCarousel`s, then a `Grid` of
  `RecentWatchesList`/`RecentRatingsList` (~line 126). `MediaCarousel` item shape is
  `{ id, type, title, year, posterUrl, genres: string[] (required), matchScore?, rank? }`.
  It navigates to `/movies|/series/:id` and draws the **viewer's** rating, watched tick and
  episode pill on every poster.
- **Posters**: `MoviePoster` (`packages/ui`) has `responsive` (2:3 fill for grids),
  `metaLine`, `watched`, `episodeProgress`, and `children` for overlays. The top-right
  corner is a stack (rating chip, watch state, watching toggle). Top-left is free wherever
  no `RankBadge` is drawn.
- **Request races**: `hooks/useRequestGuard.ts` + `lib/requestGuard.ts` (F-137) drop a slow
  answer once what it was started for is gone. It was in flight at revision time. If it has
  not landed, use an `AbortController` per selection.
- **Conventions to copy for tables**: `channel_shares` (`0010`) and
  `impersonation_sessions` (`0159`): uuid PK with `gen_random_uuid()`, FKs to `users` with
  `ON DELETE CASCADE`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. An expression unique
  index with `COALESCE(movie_id, …)` already exists on `watch_history`
  (`watch_history_user_media_unique`). Migration header style:
  `-- Migration: NNNN_name` / `-- Description:` (see `0185`).

## 4. Data model

Two migrations: **`0186_user_connections.sql`** and **`0187_social_recommendations.sql`** (re-check
the next free numbers at implementation time; `0129` is already duplicated and tolerated, do
not add another duplicate). Both runners (`packages/core/src/migrations.ts`,
`scripts/migrate.mjs`) track filenames — just add the files. `migrations.test.ts`
(`test:migrations`) checks numbering and dollar-quoting.

### 4.1 `db/migrations/0186_user_connections.sql`

```sql
-- Migration: 0186_user_connections
-- Description: Admin-managed connections between users (docs/plans/social-connections.md).
--
-- One row per unordered pair. The database orders the pair (LEAST/GREATEST at
-- insert), so the same two people inserted in either order hit the unique
-- constraint instead of duplicating, and application code never compares uuids.
-- Connected = full mutual visibility; there is no direction.

CREATE TABLE IF NOT EXISTS user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Who paired them. SET NULL, not CASCADE: deleting an admin must not
  -- disconnect everyone they connected.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Strict < also forbids a self-pair; no separate CHECK is needed.
  CONSTRAINT user_connections_ordered CHECK (user_id_a < user_id_b),
  CONSTRAINT user_connections_pair_unique UNIQUE (user_id_a, user_id_b)
);

-- The unique constraint's index already leads with user_id_a.
CREATE INDEX IF NOT EXISTS idx_user_connections_b ON user_connections (user_id_b);

-- A connection change names the OTHER person, and permission_changes had no
-- column for "with whom". Stored as a label (like subject_label) so a deleted
-- account stays identifiable.
ALTER TABLE permission_changes ADD COLUMN IF NOT EXISTS detail TEXT;
COMMENT ON COLUMN permission_changes.detail IS
  'Optional object of the change, e.g. the other account''s username for field = connection.';
```

### 4.2 `db/migrations/0187_social_recommendations.sql`

```sql
-- Migration: 0187_social_recommendations
-- Description: A title one user recommends to another.
--
-- "Watched" is deliberately NOT stored: the inbox derives it at read time from
-- watch_history.played with the poster badge's rule, so it can never drift from
-- what the rest of the app calls finished.

CREATE TABLE IF NOT EXISTS social_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  movie_id UUID REFERENCES movies(id) ON DELETE CASCADE,
  series_id UUID REFERENCES series(id) ON DELETE CASCADE,
  -- Bumped on every (re)send. The inbox orders by it, so a re-recommendation
  -- returns to the top.
  recommended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = live. Set by the recipient's dismiss, cleared by a re-send.
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT social_recommendations_item_shape CHECK (
    (media_type = 'movie'  AND movie_id IS NOT NULL AND series_id IS NULL) OR
    (media_type = 'series' AND series_id IS NOT NULL AND movie_id IS NULL)
  ),
  CONSTRAINT social_recommendations_no_self CHECK (recommender_user_id <> recipient_user_id)
);

-- One row per (recommender, recipient, item); a re-send upserts it. The
-- conflict target in §5.3 must repeat this expression exactly for inference.
CREATE UNIQUE INDEX IF NOT EXISTS social_recommendations_one_per_item
  ON social_recommendations (recommender_user_id, recipient_user_id, media_type,
                             COALESCE(movie_id, series_id));

-- The inbox read: one recipient's live rows, newest first.
CREATE INDEX IF NOT EXISTS idx_social_recommendations_inbox
  ON social_recommendations (recipient_user_id, recommended_at DESC)
  WHERE dismissed_at IS NULL;
```

`dismissed_at` replaces the old `status` column. It carries *when* as well as *whether*, and
it leaves no second vocabulary to keep in sync. Deleting a movie/series row cascades its
recommendation rows (library rows are deleted when the media server drops a title, as the
embedding tables rely on), so no cleanup job is needed.

## 5. Core — `packages/core/src/social/`

Files: `rules.ts` (pure, **no runtime imports**, so its test never loads the DB pool — the
`seerrMapping.ts` pattern), `connections.ts`, `recommendations.ts`, `index.ts`,
`rules.test.ts`. Plus two SQL builders added to `watching/watchedItems.ts` (§5.2).
**Recent-watches does NOT live in core** (§6.3).

### 5.1 `rules.ts` (pure) and `connections.ts`

```ts
// rules.ts — pure, pinned by rules.test.ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Lowercases and validates both ids; throws RangeError on a malformed id or a
 *  self-pair. Does NOT order them — the database does (LEAST/GREATEST). */
export function validatePair(a: string, b: string): [string, string]

/** The display-name rule shared with watcherVisibility's NAME_SQL. */
export function displayNameSql(alias: string): string {
  return `COALESCE(NULLIF(TRIM(${alias}.display_name), ''), ${alias}.username)`
}

/**
 * THE definition of "a connection this viewer can see", as a subquery yielding
 * one `user_id` column. Every social read goes through it: named watchers, the
 * history guard, recent watches, the recipient list and the inbox. `viewer` is
 * a placeholder such as '$1::uuid'. Aliases c/cu are scoped to the subquery.
 */
export function visibleConnectionsSql(viewer: string): string {
  return `SELECT CASE WHEN c.user_id_a = ${viewer} THEN c.user_id_b ELSE c.user_id_a END AS user_id
            FROM user_connections c
            JOIN users cu ON cu.id = CASE WHEN c.user_id_a = ${viewer} THEN c.user_id_b ELSE c.user_id_a END
           WHERE (c.user_id_a = ${viewer} OR c.user_id_b = ${viewer})
             AND cu.is_enabled = true AND cu.provider_disabled = false`
}

export type SkipReason = 'not_connected' | 'unavailable' | 'already_watched'

/** Precedence: not_connected > unavailable > already_watched > (send). Out of
 *  scope wins over watched, so a title the recipient cannot open says nothing
 *  about their history. */
export function recipientSkipReason(s: { connected: boolean; inScope: boolean; finished: boolean }): SkipReason | null

/** Rows (newest first) → groups ordered by recommender name, items keeping row order. */
export function groupInbox<Row extends { recommenderId: string; recommenderName: string }>(rows: Row[]): Array<{ recommenderId: string; recommenderName: string; items: Row[] }>
```

`rules.test.ts` pins: `validatePair` (lowercasing, malformed, self in any case mix),
`recipientSkipReason` precedence (all 8 combinations), `groupInbox` ordering and stability,
and that `visibleConnectionsSql` carries both `is_enabled` and `provider_disabled`. The last
one is a string check, but it is the one rule a tidy-up would silently drop.

```ts
// connections.ts
export interface ConnectedUser {
  id: string
  username: string
  displayName: string | null
  name: string            // displayNameSql
  /** `/api/users/${id}/avatar` — the string SessionUser.avatarUrl uses. requireAuth
   *  since F-133; any signed-in user may fetch any user's avatar. A media server
   *  with no image answers 404 and MUI's Avatar falls back to its children. */
  avatarUrl: string
}

export interface ConnectionEnd extends ConnectedUser {
  hasAccess: boolean          // is_enabled AND NOT provider_disabled
}

export interface ConnectionPair {
  id: string
  userA: ConnectionEnd
  userB: ConnectionEnd
  createdAt: string           // ISO
  createdByName: string | null
}

/** Validates, checks both users exist (any access state — setting a connection
 *  up before granting access is allowed, F-135 rule 2), inserts, audits both
 *  sides when created. Idempotent. Throws RangeError (→400) / Error('User not found') (→404). */
export async function createUserConnection(actor: PermissionActor, a: string, b: string):
  Promise<{ pair: ConnectionPair; created: boolean }>

/** DELETE … RETURNING both ends; audits both sides. false when no such row. */
export async function removeUserConnection(actor: PermissionActor, connectionId: string): Promise<boolean>

/** Admin: every pair, both ends hydrated with hasAccess (the dialog greys them). */
export async function listAllConnections(): Promise<ConnectionPair[]>

/** Visible connections only, ordered by name. */
export async function listVisibleConnections(userId: string): Promise<ConnectedUser[]>
export async function getVisibleConnectionIds(userId: string): Promise<string[]>
export async function isVisibleConnection(viewerId: string, targetId: string): Promise<boolean>
```

SQL (all through `query`/`queryOne` from `../lib/db.js`):

```sql
-- createUserConnection: the database orders the pair
INSERT INTO user_connections (user_id_a, user_id_b, created_by)
VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid), $3::uuid)
ON CONFLICT (user_id_a, user_id_b) DO NOTHING
RETURNING id                                   -- no row ⇒ created = false

-- isVisibleConnection: one unique-index probe plus the target's access
SELECT 1
  FROM user_connections c
  JOIN users u ON u.id = $2::uuid
 WHERE c.user_id_a = LEAST($1::uuid, $2::uuid) AND c.user_id_b = GREATEST($1::uuid, $2::uuid)
   AND u.is_enabled = true AND u.provider_disabled = false

-- listVisibleConnections
SELECT u.id, u.username, u.display_name, ${displayNameSql('u')} AS name
  FROM users u
 WHERE u.id IN (${visibleConnectionsSql('$1::uuid')})
 ORDER BY name, u.username
```

**Audit.** After a real insert or delete, record one change per person with
`recordPermissionChanges` (fail-open by design, F-134 rule 4):
`{ field: 'connection', oldValue: 'false', newValue: 'true', detail: <other username> }` on
create, and the reverse on delete. `recordPermissionChanges` and `PermissionChange` gain an
optional `detail` (a fourth `UNNEST` array, cast `::text[]` like the others).
`getPermissionHistory`/`PermissionChangeRecord` return it. `permissionAuditCallSites.test.ts`
is not affected — it scans writes to the `users` permission columns.

### 5.2 The finished predicate — in `watching/watchedItems.ts`, beside the badge

The inbox and the recipient check need "has *this* user finished *this* title" for a few rows.
`getWatchStatusForUser` answers it for the whole library, which is the wrong cost here. It
already runs once per page load for `/api/watch-status`. Add two SQL builders **next to it**,
with a comment that they are the same rule as the aggregate above (duplicated predicates
belong in one module — CLAUDE.md invariant):

```ts
/** SQL boolean: `user` has played this movie. `user`/`movieId` are SQL expressions. */
export function movieFinishedSql(user: string, movieId: string): string {
  return `EXISTS (SELECT 1 FROM watch_history wh
                   WHERE wh.user_id = ${user} AND wh.movie_id = ${movieId}
                     AND ${WATCH_HISTORY_PLAYED_SQL})`
}

/** SQL boolean: every non-special episode of this series is played by `user`
 *  (and there is at least one) — getWatchStatusForUser's isWatched rule. */
export function seriesFinishedSql(user: string, seriesId: string): string {
  return `(SELECT COUNT(*) > 0 AND COUNT(wh.episode_id) = COUNT(*)
             FROM episodes fe
             LEFT JOIN watch_history wh
               ON wh.episode_id = fe.id AND wh.user_id = ${user} AND ${WATCH_HISTORY_PLAYED_SQL}
            WHERE fe.series_id = ${seriesId} AND fe.season_number > 0)`
}
```

The inner `wh` alias is scoped to the subquery, so it binds to that subquery's
`watch_history` even when the caller also uses `wh`. Interpolating
`WATCH_HISTORY_PLAYED_SQL` keeps `watchHistoryCallSites.test.ts` green, because it follows
interpolated identifiers. Import it from `../recommender/watchedExclusion.js`, not the
barrel (a barrel import from inside core is a cycle). A partially watched series is **not**
finished and stays in the inbox with its progress pill.

### 5.3 `recommendations.ts`

```ts
export interface SocialRecommendationItem {
  id: string                      // row id
  mediaType: 'movie' | 'series'
  itemId: string
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  recommendedAt: string           // ISO
}

export interface RecommendationGroup {
  recommender: { id: string; name: string; avatarUrl: string }
  items: SocialRecommendationItem[]   // recommendedAt DESC
}

export interface RecipientAssessment {
  user: ConnectedUser
  alreadyWatched: boolean
  unavailable: boolean              // outside THEIR library scope / parental ceiling
  alreadyRecommended: boolean       // a live row me → them for this item exists
}

export interface RecommendOutcome {
  sent: number                      // rows now live (new + revived + re-bumped)
  skipped: Array<{ userId: string; reason: SkipReason }>
}

type Item = { mediaType: 'movie' | 'series'; itemId: string }

/** One assessment per visible connection. The recommend dialog renders it and
 *  the POST re-runs it — one function, so the dialog's flags and the POST's
 *  skip reasons cannot disagree, and the POST never trusts the dialog. */
export async function assessRecipients(recommenderId: string, item: Item): Promise<RecipientAssessment[]>

/** The caller has already checked the item is in the RECOMMENDER's scope. */
export async function recommendItemToUsers(recommenderId: string, item: Item, recipientIds: string[]): Promise<RecommendOutcome>

/** The recipient's inbox. `scope` is the recipient's own (the route passes viewerScope). */
export async function listInbox(recipientId: string, scope: LibraryScope): Promise<RecommendationGroup[]>

/** Badge count: MUST be the number of items listInbox returns — implement as its
 *  sum, never a separate COUNT(*), or the badge and the page disagree the moment
 *  a title is finished, dismissed, scoped out or its sender disconnected. */
export async function countInbox(recipientId: string, scope: LibraryScope): Promise<number>

/** Recipient-only, idempotent. false when the row is missing or not theirs. */
export async function dismissRecommendation(recipientId: string, id: string): Promise<boolean>
```

**`assessRecipients`**: `listVisibleConnections(recommenderId)`, then `loadConfiguredLibraries()`
once. Then, per connection in parallel, `getLibraryScopeForUser(id, libraries)` and one query
(N is household-sized):

```sql
SELECT ${libraryScopeSql(scope, 't', bind)}                AS in_scope,
       ${movieFinishedSql('$2::uuid', 't.id')}             AS finished,   -- or seriesFinishedSql
       EXISTS (SELECT 1 FROM social_recommendations r
                WHERE r.recommender_user_id = $3::uuid AND r.recipient_user_id = $2::uuid
                  AND r.movie_id = t.id                     -- series_id for a series
                  AND r.dismissed_at IS NULL)               AS already_recommended
  FROM movies t                                             -- series t for a series
 WHERE t.id = $1::uuid
```

**`recommendItemToUsers`**: dedupe `recipientIds`, and run `assessRecipients`. An id missing
from the result is `not_connected`, which also covers the recommender's own id and
disconnected or no-access users. Otherwise use `recipientSkipReason`. Send the rest in **one
statement**:

```sql
INSERT INTO social_recommendations
  (recommender_user_id, recipient_user_id, media_type, movie_id, series_id)
SELECT $1::uuid, r.id, $3, $4::uuid, $5::uuid FROM UNNEST($2::uuid[]) AS r(id)
ON CONFLICT (recommender_user_id, recipient_user_id, media_type, COALESCE(movie_id, series_id))
DO UPDATE SET recommended_at = NOW(), dismissed_at = NULL
```

Index inference with a column list plus an expression is supported (same shape as
`watch_history_user_media_unique`). The expression must match the index text.

**`listInbox`**: one query; `params = [recipientId]`, `bind = binderFor(params)`:

```sql
SELECT r.id, r.media_type, r.movie_id, r.series_id, r.recommended_at,
       r.recommender_user_id, ${displayNameSql('u')} AS recommender_name,
       COALESCE(m.title, s.title) AS title, COALESCE(m.year, s.year) AS year,
       COALESCE(m.poster_url, s.poster_url) AS poster_url,
       COALESCE(m.genres, s.genres, '{}') AS genres
  FROM social_recommendations r
  JOIN users u ON u.id = r.recommender_user_id
  LEFT JOIN movies m ON r.media_type = 'movie'  AND m.id = r.movie_id
  LEFT JOIN series s ON r.media_type = 'series' AND s.id = r.series_id
 WHERE r.recipient_user_id = $1::uuid
   AND r.dismissed_at IS NULL
   AND r.recommender_user_id IN (${visibleConnectionsSql('$1::uuid')})
   AND CASE r.media_type
         WHEN 'movie' THEN ${libraryScopeSql(scope, 'm', bind)}
                       AND NOT ${movieFinishedSql('$1::uuid', 'r.movie_id')}
         ELSE              ${libraryScopeSql(scope, 's', bind)}
                       AND NOT ${seriesFinishedSql('$1::uuid', 'r.series_id')}
       END
 ORDER BY r.recommended_at DESC
```

Then `groupInbox`. Filters, in the order a reader would ask: live, from someone still
visible, openable by the recipient *now* (a permission change after sending hides it), and
not finished. None of them deletes anything.

**`dismissRecommendation`**:
`UPDATE social_recommendations SET dismissed_at = COALESCE(dismissed_at, NOW()) WHERE id = $1
AND recipient_user_id = $2 RETURNING id`. Ownership is in the same statement (no race), and a
second click is still a success.

### 5.4 Wiring

1. `social/index.ts`: named re-exports of `connections.ts`, `recommendations.ts` and the
   public parts of `rules.ts` (`visibleConnectionsSql`, `displayNameSql`, `SkipReason`).
2. **Root barrel** `packages/core/src/index.ts`: add explicit named exports (the barrel does
   not use `export *`). Also export `movieFinishedSql`/`seriesFinishedSql` beside the other
   `watching` exports. **No `./social` subpath** in `package.json` — recent modules are
   root-only, and a subpath is one more thing to keep in step.
3. `permissionAudit.ts`: optional `detail` on `PermissionChange` and
   `PermissionChangeRecord`, the fourth `UNNEST` array, and the `SELECT` column.
4. **Test script**: packages/core has no aggregate runner, so an unscripted test never runs.
   Add `"test:social": "node --import tsx --test src/social/rules.test.ts"`.
5. Rebuild packages before app typecheck: `pnpm --filter "./packages/*" build` (root
   `pnpm typecheck` does this itself).

## 6. API — `apps/api/src`

### 6.1 New module `routes/social/`

```
routes/social/
  index.ts                 // default-export FastifyPluginAsync; registers handlers
  schemas.ts               // Fastify JSON schemas
  handlers/
    connections.ts
    recommendations.ts
    recentWatches.ts       // §6.3 — lives HERE, not in core
```

Register in `routes/index.ts` after `watchStatusRoutes`, with
`import socialRoutes from './social/index.js'`. **Register every route as
`fastify.get|post|delete(path, { preHandler: … }, handler)`**. `routeGuards.test.ts` only
recognises that shape, and a route registered some other way is invisible to it rather
than flagged.

**Response schemas:** optional. If a handler declares a `200` schema, every field in §6.2
must be in it — fast-json-stringify drops undeclared properties without error, and a dropped
optional field reads as "absent", i.e. "no".

### 6.2 Endpoint contracts

All handlers read the caller from `request.user as SessionUser`; every web fetch sends
`credentials: 'include'`. Ids are validated `format: 'uuid'` in the schema. Bodies are
`additionalProperties: false`.

| Method | Path | preHandler | Purpose |
|---|---|---|---|
| GET | `/api/social/connections` | `requireAuth` | Caller's visible connections |
| GET | `/api/social/connections/all` | `requireAdmin` | Every pair, both ends hydrated |
| POST | `/api/social/connections` | `requireAdmin` | Create a pair |
| DELETE | `/api/social/connections/:id` | `requireAdmin` | Remove a pair (row id) |
| GET | `/api/social/recommendations` | `requireAuth` | Caller's inbox, grouped |
| GET | `/api/social/recommendations/count` | `requireAuth` | Sidebar badge count |
| GET | `/api/social/recommendations/recipients` | `requireAuth` | `assessRecipients` for one item |
| POST | `/api/social/recommendations` | `requireAuth` | Send one item to N recipients |
| POST | `/api/social/recommendations/:id/dismiss` | `requireAuth` | Recipient dismisses |
| GET | `/api/social/recent-watches` | `requireAuth` | Recent watches of the caller's connections |

No capability guard. Having a connection is data, not a permission, and every endpoint
already answers for the caller's own connections (an empty list for someone with none).

```ts
// GET /api/social/connections
{ connections: Array<{ id: string; name: string; avatarUrl: string }> }

// GET /api/social/connections/all
{ connections: ConnectionPair[] }                       // §5.1

// POST /api/social/connections   body { userAId: uuid, userBId: uuid }
//   200 { connection: ConnectionPair, created: boolean }   // created=false: already existed
//   400 self-pair / malformed; 404 unknown user
//   actor = { userId: currentUser.id, label: currentUser.username }

// DELETE /api/social/connections/:id → 204 | 404

// GET /api/social/recommendations
{ groups: RecommendationGroup[] }                        // listInbox(user.id, await viewerScope(request))

// GET /api/social/recommendations/count
{ count: number }                                        // countInbox, same scope

// GET /api/social/recommendations/recipients?movieId=<uuid>   (XOR seriesId; else 400)
//   404 when the item is not in the CALLER's scope (titleInScope) — same answer as the detail page
{ recipients: Array<{ id: string; name: string; avatarUrl: string;
                      alreadyWatched: boolean; unavailable: boolean; alreadyRecommended: boolean }> }

// POST /api/social/recommendations
//   body { movieId?: uuid; seriesId?: uuid; recipientUserIds: uuid[] }
//   exactly one of movieId/seriesId (checked in the handler → 400);
//   recipientUserIds: minItems 1, maxItems 50, uniqueItems
//   404 'Item not found' when not in the CALLER's scope (titleInScope) — never reveals existence
//   200 RecommendOutcome                                  // §5.3

// POST /api/social/recommendations/:id/dismiss → 204 | 404 (missing OR not the caller's — never 403)

// GET /api/social/recent-watches?limitPerUser=15          (1–50, default 15)
{ users: Array<{ user: { id: string; name: string; avatarUrl: string };
                 items: RecentWatchItem[] }> }            // ordered by name; items: [] kept
```

```ts
// RecentWatchItem — the dashboard's own recent-watch shape PLUS genres (MediaCarousel requires it)
interface RecentWatchItem {
  id: string                  // movie or series id
  type: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  lastWatched: string         // ISO last_played_at
  playCount: number
  lastEpisode?: { seasonNumber: number; episodeNumber: number }   // series only
}
```

### 6.3 `handlers/recentWatches.ts` — why api-side, and its SQL

**Superseded 2026-09-28: the predicate is `WATCH_HISTORY_PLAYED_SQL` (core), not
`WATCHED_SQL`.** The row names a person, and the title page beside it counts played titles
only, so the looser reading showed films the connection had only started while their page
said nobody had watched them. Read `WATCHED_SQL` below as `WATCH_HISTORY_PLAYED_SQL`.

`WATCHED_SQL` is an api-side singleton (`profile/watchStatsFilters.ts`, pinned to the `wh`
alias), and core cannot import from the api app. So the aggregation lives in the handler.
Import `WATCHED_SQL` from `../../users/handlers/profile/watchStatsFilters.js` — never restate
it. `LIBRARY_ENABLED_SQL` is **not** needed: the viewer's scope already intersects the
operator's library switch (F-136 rule 2).

The per-user limit is applied **in SQL with window functions**, not by fetching whole
histories and slicing in TypeScript (a connection can have thousands of rows).
`idx_watch_history_last_played (user_id, last_played_at DESC)` serves it. Build `params`
push-style: `$1` = the caller's id, then `scopeClause(await viewerScope(request), alias,
params)`, then the limit.

```sql
-- movies
WITH ranked AS (
  SELECT wh.user_id, m.id, m.title, m.year, m.poster_url, m.genres,
         wh.last_played_at, wh.play_count,
         ROW_NUMBER() OVER (PARTITION BY wh.user_id ORDER BY wh.last_played_at DESC) AS rn
    FROM watch_history wh
    JOIN movies m ON m.id = wh.movie_id
   WHERE wh.user_id IN (${visibleConnectionsSql('$1::uuid')})
     AND wh.movie_id IS NOT NULL AND wh.last_played_at IS NOT NULL
     AND ${WATCHED_SQL}
     AND ${scopeClause(scope, 'm', params)}
)
SELECT * FROM ranked WHERE rn <= $N

-- series: latest episode per (user, series), then the newest series per user
WITH per_series AS (
  SELECT wh.user_id, s.id, s.title, s.year, s.poster_url, s.genres,
         wh.last_played_at, wh.play_count, e.season_number, e.episode_number,
         ROW_NUMBER() OVER (PARTITION BY wh.user_id, s.id ORDER BY wh.last_played_at DESC) AS rn
    FROM watch_history wh
    JOIN episodes e ON e.id = wh.episode_id
    JOIN series s ON s.id = e.series_id
   WHERE wh.user_id IN (${visibleConnectionsSql('$1::uuid')})
     AND wh.episode_id IS NOT NULL AND wh.last_played_at IS NOT NULL
     AND ${WATCHED_SQL}
     AND ${scopeClause(scope, 's', params)}
), latest AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY last_played_at DESC) AS urn
    FROM per_series WHERE rn = 1
)
SELECT * FROM latest WHERE urn <= $N
```

Then, in TypeScript: group by user, interleave both kinds by `lastWatched` DESC, slice to
`limitPerUser`. Return one entry per visible connection (from `listVisibleConnections`,
ordered by name), including `items: []`; the UI decides whether to render it. This file
names `viewerScope(`/`scopeClause(`, so it satisfies `libraryScopeCallSites.test.ts` with
no exemption. Approximate plays (F-108) are included, exactly as the viewer's own dashboard
list includes them. The slider orders by date but **never prints one**. If a date is ever
shown, apply F-108's time-axis rule first.

### 6.4 Named watchers — `watcherVisibility.ts` fills its reserved branch

Split the pure decision out so it can be pinned without loading the DB pool: new
**`apps/api/src/lib/watcherAudience.ts`**, with no runtime imports. `watcherVisibility.ts`
re-exports it, and its `NAME_SQL` becomes `displayNameSql('u')` from core.

```ts
// watcherAudience.ts — pure
export type WatcherAudience =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'users'; userIds: string[] }

/** Admins keep 'all' (a superset of their connections); no query is run for them.
 *  A viewer with connections also sees THEMSELVES named ("You"), so their own
 *  play is not counted among the anonymous others. */
export function resolveWatcherAudience(
  viewer: { id: string; isAdmin: boolean },
  visibleConnectionIds: readonly string[]
): WatcherAudience {
  if (viewer.isAdmin) return { kind: 'all' }
  if (visibleConnectionIds.length === 0) return { kind: 'none' }
  return { kind: 'users', userIds: [viewer.id, ...visibleConnectionIds] }
}

/** Decided value for the client's copy; only meaningful when names were sent. */
export function audienceLabel(a: WatcherAudience): 'all' | 'connections' | undefined
```

`watcherAudience.test.ts` pins: admin → `all` regardless of connections; no connections →
`none`; connections → `users` with the viewer first; the label mapping. Add it to the api
`test:auth` script.

Both call sites:

```ts
const connected = currentUser.isAdmin ? [] : await getVisibleConnectionIds(currentUser.id)
const audience = resolveWatcherAudience(currentUser, connected)
const watcherList = await fetchMovieWatchers(id, audience)
return reply.send({
  // …unchanged counts…
  ...(watcherList ? { watchers: watcherList, watcherAudience: audienceLabel(audience) } : {}),
})
```

Update the module comment: the "planned shape" paragraph is now reality. The load-bearing
invariant is unchanged: **names are attached server-side or not at all**. A viewer with no
connections gets no `watchers` key, exactly as today. With connections but none who watched,
the response carries `watchers: []`, and the strip treats an empty list as "no names" (it
already does).

### 6.5 Watch history for a connection — guard **and** scope

In `profile/shared.ts`, beside the existing guard:

```ts
/** GET-only widening: self, admin, or a visible connection of the target. */
export async function requireSelfOrAdminOrConnected(
  id: string, currentUser: SessionUser, reply: FastifyReply
): Promise<boolean> {
  if (id === currentUser.id || currentUser.isAdmin) return true
  if (await isVisibleConnection(currentUser.id, id)) return true   // @aperture/core
  reply.status(403).send({ error: 'Forbidden' })
  return false
}
```

Apply it to **exactly the two list GETs in `watchHistory.ts`**. Everything in
`watchHistoryManagement.ts` keeps `requireSelfOrAdmin`, as do the watch-stats and breakdown
handlers. After the change, a grep for `requireSelfOrAdmin(` in
`watchHistoryManagement.ts` must show all five handlers untouched. `isVisibleConnection`
needs a well-formed uuid, and the route param is unvalidated today. Add a `params` schema with
`format: 'uuid'`, or test with a local regex (the `UUID` in `viewerScope.ts` is module-private).

**Scope.** When the caller is neither the target nor an admin, both queries (count **and**
page — they must agree) gain `AND ${scopeClause(await viewerScope(request), 'm' | 's', params)}`.
Own history stays unscoped (F-136: the viewer's own record), and so does an admin reading
anyone's (UserDetail's history tab is an admin surface). This means converting both handlers
from fixed-position placeholders (`$2` for search, computed `limitIdx`/`offsetIdx`) to a
push-style `params` array. Number placeholders as values are added and never renumber them
afterwards (F-130 rule 5).

Then **remove `'users/handlers/profile/watchHistory.ts'` from `EXEMPT`** in
`routes/libraryScopeCallSites.test.ts`. Once the file calls `scopeClause(`, the stale-entry
test fails until the exemption is gone.

### 6.6 Security notes

- Every route declares a `preHandler`; the four admin ones use `requireAdmin` (no bypass).
  There is no self-serve connection path.
- The recommend POST and the recipients GET re-check, server-side: the item is in the
  **caller's** scope (404 otherwise), and each recipient is a visible connection, has the
  item in **their** scope, and has not finished it. The dialog's flags are UX, not
  authorization.
- `dismiss` checks ownership in the same `UPDATE` and answers 404 for "not yours" and
  "missing" alike.
- API keys: a `read`-scoped key can call every GET (its account's connections and
  inbox). The POSTs and the DELETE need `write`, enforced by the existing hook through
  `requestWrites`, which refuses with `API_KEY_READ_ONLY`. The admin routes also need
  `admin`, because `isAdmin` is narrowed at the door.
- Impersonation: GETs show the *target's* connections, inbox, sliders and the target's
  view of connected history. All writes are refused with `IMPERSONATION_READ_ONLY`.
- **GETs must not write** (`requestWrites` rests on it). No lazy clean-up of dismissed or
  finished rows on read, and no default rows created by a getter.

### 6.7 The `social` decided value on `/api/auth/check`

In `routes/auth/index.ts` `decidedCapabilities`, beside `movies`/`series`:

```ts
let social = false
try {
  social = (await getVisibleConnectionIds(user.id)).length > 0
} catch {
  // Fail closed: hiding a nav entry over a failed read breaks nothing.
}
return { ...capabilitiesFor(user), ...kinds, social }
```

It is decided data rather than a permission, so it is **not** added to `CAPABILITIES` in
`permissions.ts` (nothing server-side gates on it). The web gates the nav entry, the button
and the fetches on it (§7), and absent reads as false (F-134 rule 2). It refreshes on the
next `/auth/check`, which means a full load. An assumption start or stop is a full load
already. **Superseded 2026-09-28:** it is also re-read on window focus and after an admin
changes a pair (see the top of this file).

## 7. Web — `apps/web/src`

### 7.1 Connections provider trio (template: `WatchStatusProvider`)

```
hooks/connections-context.ts   // createContext + types
hooks/ConnectionsProvider.tsx  // export function ConnectionsProvider
hooks/useConnections.ts        // the hook
```

```ts
export interface ConnectionSummary { id: string; name: string; avatarUrl: string }
export interface ConnectionsContextValue {
  enabled: boolean            // useCapability('social')
  connections: ConnectionSummary[]
  pendingCount: number
  loading: boolean
  /** enabled && (loading || connections.length > 0) — true from first paint, no flash */
  hasConnections: boolean
  refresh(): Promise<void>    // refetch both; call after send/dismiss
}
```

When `enabled` is false, fetch nothing and return `connections: []`, `pendingCount: 0`,
`loading: false`. Most users have no connections, so this costs them nothing. When enabled,
fetch `GET /api/social/connections` and `GET /api/social/recommendations/count` in parallel
on mount. Refetch the count on window focus, at most once a minute, so the badge picks up
something sent while the tab was open. **No localStorage cache.** That also keeps it out of
`clientCaches.ts`, and an assumption start or stop reloads the page anyway.

Mount in `App.tsx` `ProtectedRoute` (~lines 114–127) between `WatchStatusProvider` and
`WatchingProvider`. `MediaDetailModal` hosts (the assistant surfaces) render inside
`AssistantDockProvider`, so they are below it too.

```tsx
<WatchStatusProvider>
  <ConnectionsProvider>
    <WatchingProvider>
```

### 7.2 Sidebar item + badge

In `components/Layout.tsx`:

- `NavItem` gains `badge?: 'socialInbox'`.
- `baseUserMenuItems`, right after `nav.recommendations`:
  `{ textKey: 'nav.sharedWithMe', icon: <RecommendIcon />, path: '/shared-with-me', feature: null, capability: 'social', badge: 'socialInbox' }`
  (`RecommendIcon` from `@mui/icons-material/Recommend`). The existing filter
  (`item.capability && capabilities[item.capability] !== true`) hides it with no new case.
- In `renderDrawer`, when `item.badge === 'socialInbox'`, wrap `item.icon` inside
  `ListItemIcon` in `<Badge badgeContent={pendingCount} color="primary"
  invisible={pendingCount === 0} max={99}>`. The badge's number is not announced by itself,
  so put `nav.sharedWithMeBadge` on the `ListItemButton` as `aria-label` (label plus count)
  whenever `pendingCount > 0`. The badge sits on the icon, so it shows on the collapsed rail
  as well as the labelled drawer.
- **Added 2026-09-29:** the filter also drops the entry while `pendingCount` is 0, unless the
  viewer is on `/shared-with-me` itself.

### 7.3 MediaHero button + RecommendToDialog

- `pages/media-detail/components/MediaHero.tsx`: add `onRecommend?: () => void` to
  `MediaHeroProps`. Render an outlined button **immediately before the "Movie mark watched"
  block**: that puts it after Favorite on a movie and after Trailer on a series (Favorite is
  movie-only). It is shown only when `onRecommend` is set. Icon `RecommendIcon`, label
  `mediaDetail.hero.recommend`, tooltip `mediaDetail.hero.recommendTooltip`, and
  `sx={actionBtnSx}`.
- New `pages/media-detail/components/RecommendToDialog.tsx`. Model the markup on
  `WatcherListDialog`, and make it work without a router, because `MediaDetailPage` also
  renders inside `MediaDetailModal`.

```ts
interface RecommendToDialogProps {
  open: boolean
  mediaType: 'movie' | 'series'
  itemId: string
  itemTitle: string
  onClose: () => void
}
```

  On open, `GET /api/social/recommendations/recipients?movieId=|seriesId=`. Guard it with
  `useRequestGuard` keyed on the opening, so a late answer for another title is dropped.
  Render a checkbox list with `Avatar src={avatarUrl}` (initials fallback) and the name.
  - `unavailable` → disabled, caption `recommendDialog.unavailable`.
  - `alreadyWatched` → disabled, caption `recommendDialog.alreadyWatched`.
  - `alreadyRecommended` → enabled, caption `recommendDialog.alreadyRecommended` (re-sending
    moves it to the top).

  Send is disabled while nothing is selected or a request is in flight.
  `POST /api/social/recommendations`, then:
  - `sent > 0` → success Snackbar `recommendDialog.sent` (plural), plus one line per skipped
    user with their reason (§7.9).
  - `sent === 0` → warning with the reasons.
  - Any error → the server's sentence through `lib/withServerMessageDetail.ts`. During
    "view as" or with a read-only key, that is the refusal text rather than a generic
    failure.

  Then call `refresh()` from `useConnections` and close. The dialog owns its Snackbar,
  because the hero's snackbar state is internal to `MediaHero`.
- Wire in `pages/media-detail/index.tsx`: `const { hasConnections } = useConnections()`,
  state `recommendOpen`, and
  `onRecommend={hasConnections && id ? () => setRecommendOpen(true) : undefined}` next to
  `onFavoriteToggle`. Render the dialog at page level; it works inside `MediaDetailModal`
  for free.

### 7.4 CommunityStrip + WatcherListDialog copy (partial audience)

`pages/media-detail/types.ts`: `MovieWatchStats`/`SeriesWatchStats` gain
`watcherAudience?: 'all' | 'connections'`.

Add a pure helper `pages/media-detail/watcherNames.ts` (no components, so
`react-refresh/only-export-components` stays quiet) with a test beside it. The web `test`
script globs `src/**/*.test.ts`.

- `unnamedCount(total: number, named: number): number` → `Math.max(0, total - named)`.
- `watcherLabel(w, viewerId, youLabel)` → `youLabel` when `w.userId === viewerId`, else
  `w.name`. It is identity, not a permission rule. `useAuth().user` is the assumed account
  during "view as", matching the server.

In `CommunityStrip.tsx`, when `watcherAudience === 'connections'`:

- **Hover summary**: the first 8 labels. Existing `watchersMore` covers named overflow.
  Then, when `unnamedCount > 0`, a line `watchersUnnamed` (plural). The totals are
  `totalWatchers` (movie "watched"), `totalViewers` (series "viewers") and `favoritesCount`
  (movie "favorited"). Each comes from the same played predicate as the list, so the
  difference is exact. For "favorited" it is a floor: a connection who favorited without
  playing is counted as unnamed. The hint becomes `watchersOpenHintNamed` instead of
  `watchersOpenHint` ("Click to see everyone" is false here).
- Admin (`'all'`) or absent: exactly as today.
- Counter values are unchanged in every case. The aggregate stays the true total (F-110).

`WatcherListDialog.tsx` gains `audience?: 'all' | 'connections'` and `unnamed?: number`
props. Rows use `watcherLabel` and show `Avatar src={/api/users/${userId}/avatar}` with the
initials as fallback. Footer:

- `'connections'` → `watchersConnectionsOnly`, plus `watchersUnnamedFooter` (plural) when
  `unnamed > 0`.
- `'all'` or absent → the existing `watchersAdminOnly`, **unchanged**.

### 7.5 MyWatchHistory — "whose history" picker

`pages/MyWatchHistory.tsx`:

- **The selection lives in the URL**, as `/history?user=<id>`, via `useSearchParams`. It
  survives reloads, can be linked from a dashboard slider, and the back button undoes it.
  An id that is not the viewer's and not in `useConnections().connections` (once loaded)
  is dropped with `replace` and the page shows the viewer's own history.
- Picker: a compact MUI `Select` (avatar + name; "Me" first, then each connection), placed
  in the controls `Box` before the search field. It renders only when `hasConnections`.
  A `Select` scales past a handful of people and fits the 250px controls row on a phone,
  where a `ToggleButtonGroup` does not.
- `fetchMovieHistory`/`fetchSeriesHistory` take the history user id. Drop a stale response
  when the selection changes mid-flight (`useRequestGuard`, or `AbortController`). A late
  answer for the previous person must never render under the new heading. On switch, reset
  page to 1 and search to `''`, keep per-tab sort and filter, and refetch both tabs' counts.
- `PageHeading` follows the selection: own → unchanged; other →
  `watchHistoryPage.otherUsersHistory` with `{ name }`, plus a read-only hint line
  `watchHistoryPage.viewingReadOnly`. There is still exactly one publisher per route.
- `canManage = useCapability('watchHistory:manage') && viewingSelf`. That hides every
  mark-unwatched affordance (both grids and both list components take `canManage`). The
  server refuses anyway, because the DELETEs keep `requireSelfOrAdmin`.
- **No watched ticks on this page, for either person**. That is F-109's standing decision
  ("My Watch History … unbadged") and the "another user's profile" case it names. A tick
  here would read as the other person's state.

### 7.6 Dashboard — one slider per connection

- New hook `pages/dashboard/hooks/useConnectionsRecentWatches.ts(enabled: boolean)`. When
  disabled, fetch nothing and return `{ users: [], loading: false }`. Otherwise fetch
  `GET /api/social/recent-watches` once on mount.
- New `pages/dashboard/components/ConnectionsRecentWatches.tsx` maps each `{ user, items }`
  to a `MediaCarousel` with `title={t('dashboard.recentlyWatchedBy', { name: user.name })}`,
  `subtitle={t('dashboard.subtitleFromConnections')}`, `items` (with `genres`, which the
  endpoint supplies) and no rank or score. While loading, render one skeleton carousel.
  After loading, render only users with `items.length > 0`, mirroring the page's
  `WatchingCarousel` rule. The ticks, stars and pills on these posters are the **viewer's**
  own (`MediaCarousel` reads `useWatchStatus`), which is what makes the row useful ("I
  haven't seen this one").
- Place it in `pages/dashboard/index.tsx` **after** the own Recent Watches / Recent
  Ratings `Grid` (locked: own content first), with `enabled = hasConnections`.
  **Superseded 2026-09-29:** directly under Top Picks, above the Recent Watches / Recent
  Ratings `Grid`.
- Add both files to the `components/index.ts` and `hooks/index.ts` barrels. Do **not**
  add fields to `GET /api/dashboard`.

### 7.7 "Shared with me" page

- New `pages/SharedWithMe.tsx` (single file; small subcomponents may live in it). Add the
  route in `App.tsx`'s user routes, statically imported like the other user pages:
  `<Route path="shared-with-me" element={<SharedWithMePage />} />`.
- Data: `GET /api/social/recommendations` → `groups`. One section per group: header =
  `Avatar src={avatarUrl}` + `t('sharedWithMe.recommendedBy', { name })`; body = a poster
  grid sized off its container,
  `gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))'`, with
  `<MoviePoster responsive …>`. The breakpoint invariant applies: `md`/`lg` lie inside a
  docked pane.
- Each cell: `MoviePoster` with `title/year/posterUrl/genres`, `watched` and
  `episodeProgress` from `useWatchStatus()` (a series in progress shows its `8/24` pill; a
  title finished since the fetch shows its tick until the next load), and `onClick` →
  `navigate('/movies|/series/:id')`. **Dismiss** is a small `IconButton` (Close icon,
  `aria-label` `sharedWithMe.dismiss`) placed **top-left** through `MoviePoster`'s
  `children`. The top-right corner is the badge stack, and this page draws no `RankBadge`.
- Dismiss: `POST …/:id/dismiss`, then remove the item locally (drop the group when it
  empties), call `refresh()` so the badge drops, and show the Snackbar
  `sharedWithMe.dismissed` (`dismissFailed` on error, with the server's sentence).
- Empty state (no groups): `sharedWithMe.empty` + `sharedWithMe.emptyHint`. The nav entry
  is capability-gated, but the page is still reachable by URL and empties as items are
  finished or dismissed.
- `PageHeading`: title `t('nav.sharedWithMe')`, description `t('sharedWithMe.subtitle')`.

### 7.8 Admin: connections dialog on the Users page

- New `pages/UserConnectionsDialog.tsx` (model the markup on `WatcherListDialog`):

```ts
interface UserConnectionsDialogProps {
  open: boolean
  user: ProviderUser | null           // Users.tsx row type; needs apertureUserId + name
  users: ProviderUser[]               // the page's already-loaded list, for the Autocomplete
  onClose: () => void
}
```

  On every open, reload `GET /api/social/connections/all` (a stale list would offer phantom
  pairs) and filter it to pairs containing `user.apertureUserId`. Each row shows the other
  person. When `hasAccess` is false, the row is greyed with the caption
  `admin.connectionsDialog.noAccess`.

  To add: an `Autocomplete` over `users` filtered to `apertureUserId != null` and not self.
  Already-connected options are disabled. Options without access are allowed (set up before
  granting access, F-135) and captioned. On select, `POST /api/social/connections`, then
  refetch. To remove: a per-row delete icon → `DELETE …/:id`, then refetch. Snackbars
  (`added`/`removed`/`failed`, the server's sentence on failure) live inside the dialog.
  The description line (`admin.connectionsDialog.description`) states what a connection
  shares, so the admin knows what they are granting.
- `pages/Users.tsx`: add the item to **both** `<Menu>` instances (desktop ~1040, mobile
  ~1470), next to `renderViewAsMenuItem()`: `admin.usersPage.menuConnections` with the
  secondary line `menuConnectionsSecondary` and `GroupIcon`,
  `disabled={!menuUser?.apertureUserId}`. Keep `menuUser` as-is; the dialog's open state is
  its own pair.
- `pages/UserDetail.tsx` permission history: `admin.userDetail.permissionField.connection`,
  and when `change.detail` is present render it after the field name ("Connection · Tom").
  The Granted/Revoked chip already reads `newValue`.
- `pages/admin/nav/registry.ts`: add `'connections'` and `'social'` to the `users` entry's
  `aliases`, so the admin palette finds the feature. `registry.test.ts` needs nothing else.

### 7.9 i18n

en is the source of truth (`apps/web/src/i18n/locales/en/translation.json`). Then run
`pnpm --filter @aperture/web i18n:sync`, which **fills missing keys and never overwrites**,
so an existing key reworded in `en` stays stale in 14 locales. Changed meaning always means
a new key. Use `{{name}}`/`{{count}}` placeholders (with `_one`/`_other` plural pairs),
never the product name. `admin.*` is already admin-only in
`ADMIN_ONLY_NAMESPACES` (`i18n/audience.ts`); every other namespace below is user-facing.
Add nothing to that list.

| Key | en value |
|---|---|
| `nav.sharedWithMe` | `Shared with me` |
| `nav.sharedWithMeBadge_one` / `_other` | `{{count}} new recommendation` / `{{count}} new recommendations` |
| `mediaDetail.hero.recommend` | `Recommend to…` |
| `mediaDetail.hero.recommendTooltip` | `Send this to people you're connected to` |
| `mediaDetail.recommendDialog.title` | `Recommend {{title}}` |
| `mediaDetail.recommendDialog.description` | `The people you pick will find it under Shared with me.` |
| `mediaDetail.recommendDialog.alreadyWatched` | `Already watched` |
| `mediaDetail.recommendDialog.unavailable` | `Not in their libraries` |
| `mediaDetail.recommendDialog.alreadyRecommended` | `Already sent. Sending again moves it to the top` |
| `mediaDetail.recommendDialog.send` | `Send` |
| `mediaDetail.recommendDialog.sent_one` / `_other` | `Sent to {{count}} person` / `Sent to {{count}} people` |
| `mediaDetail.recommendDialog.skippedWatched` | `{{name}} has already watched it` |
| `mediaDetail.recommendDialog.skippedUnavailable` | `{{name}} can't open this title` |
| `mediaDetail.recommendDialog.skippedDisconnected` | `{{name}} is no longer connected` |
| `mediaDetail.recommendDialog.failed` | `Couldn't send the recommendation` |
| `mediaDetail.recommendDialog.loadFailed` | `Couldn't load your connections` |
| `mediaDetail.recommendDialog.empty` | `You're not connected to anyone yet` |
| `mediaDetail.infoCard.watcherYou` | `You` |
| `mediaDetail.infoCard.watchersUnnamed_one` / `_other` | `and {{count}} other person you're not connected to` / `and {{count}} other people you're not connected to` |
| `mediaDetail.infoCard.watchersOpenHintNamed` | `Click to see their names` |
| `mediaDetail.infoCard.watchersConnectionsOnly` | `Names are shown only for you and the people you're connected to.` |
| `mediaDetail.infoCard.watchersUnnamedFooter_one` / `_other` | `{{count}} other person watched this too.` / `{{count}} other people watched this too.` |
| `dashboard.recentlyWatchedBy` | `Recently watched by {{name}}` |
| `dashboard.subtitleFromConnections` | `From your connections` |
| `watchHistoryPage.whoseHistory` | `Whose history` |
| `watchHistoryPage.me` | `Me` |
| `watchHistoryPage.otherUsersHistory` | `{{name}}'s watch history` |
| `watchHistoryPage.viewingReadOnly` | `You're viewing {{name}}'s history. It's read-only.` |
| `sharedWithMe.subtitle` | `Titles the people you're connected to think you'll like` |
| `sharedWithMe.recommendedBy` | `Recommended by {{name}}` |
| `sharedWithMe.dismiss` | `Dismiss` |
| `sharedWithMe.dismissed` | `Recommendation dismissed` |
| `sharedWithMe.dismissFailed` | `Couldn't dismiss it` |
| `sharedWithMe.empty` | `Nothing shared with you yet` |
| `sharedWithMe.emptyHint` | `When someone you're connected to recommends a title, it appears here. Titles you finish leave on their own.` |
| `admin.usersPage.menuConnections` | `Connections…` |
| `admin.usersPage.menuConnectionsSecondary` | `Who this person shares their viewing with` |
| `admin.connectionsDialog.title` | `Connections for {{name}}` |
| `admin.connectionsDialog.description` | `Connected people see each other's watch history, recent watches and names on titles, and can recommend titles to each other.` |
| `admin.connectionsDialog.addPlaceholder` | `Add a connection…` |
| `admin.connectionsDialog.empty` | `Not connected to anyone yet.` |
| `admin.connectionsDialog.remove` | `Remove connection` |
| `admin.connectionsDialog.noAccess` | `No access. Hidden from the other person until access is turned back on.` |
| `admin.connectionsDialog.added` | `Connected {{a}} and {{b}}` |
| `admin.connectionsDialog.removed` | `Connection removed` |
| `admin.connectionsDialog.failed` | `Couldn't change the connection` |
| `admin.userDetail.permissionField.connection` | `Connection` |

`mediaDetail.infoCard.watchersAdminOnly` ("Only admins can see these names.") is **kept
unchanged** and still used for the admin audience.

## 8. Repo invariants the implementer must not violate

1. **The web bundle never imports `@aperture/core`.** Client types are re-declared by hand.
2. **New `watch_history` SQL names a predicate** (`WATCH_HISTORY_PLAYED_SQL` in core,
   `WATCHED_SQL` api-side) — `watchHistoryCallSites.test.ts` (core `test:exclusion`) scans
   both packages. §5.2 and §6.3 are written to it.
3. **Library scope** (F-136): every route reading titles applies the viewer's scope or is
   exempted with a reason (`test:routes`). Here nothing new is exempted, and **one exemption
   is removed** (§6.5). Recipient scope is checked in core with
   `getLibraryScopeForUser`/`libraryScopeSql`.
4. **Every route declares a `preHandler`** (`routeGuards.test.ts`); register with
   `fastify.<method>(`.
5. **Build packages before typechecking apps** after any core/ui export change
   (`pnpm --filter "./packages/*" build`), or the apps see a stale `dist/` (TS2305/TS2307).
6. **NUMERIC/COUNT arrive as strings**; parse with `Number.parseInt(x, 10)`, and remember
   `Number(null)` is 0.
7. **Absent ≠ false**: no `watchers` key means "no visibility", not "nobody". An absent
   `social` capability means false; an absent `watcherAudience` means the pre-feature copy.
8. **Names are attached server-side or not at all.** No client-side filtering of names,
   ever.
9. **Don't add social rows to `GET /api/dashboard`** — they come from their own endpoint.
10. **Duplicated predicates live in one module.** The finished rule sits beside
    `getWatchStatusForUser`, the visible-connection rule is `visibleConnectionsSql`, and the
    display-name rule is `displayNameSql`. If you are copying SQL, stop and import it.
11. **Unscripted core test files never run** (§5.4 item 4). Api tests are named in
    `package.json` too (`test:auth`, `test:routes`). Web tests are picked up by glob.
12. **Endpoint literals are untyped client-side** — after any route rename, grep
    `apps/web/src` for the literal `/api/...`.
13. **Impersonation and read-only keys**: no new entries in `READ_ONLY_POSTS` or
    `WRITING_GETS`; no GET that writes.
14. **i18n: changed meaning = new key**; `i18n:sync` never overwrites a translation.
15. **The client is told answers, never rules** (F-134): `social` and `watcherAudience`
    are decided server-side; nothing in the bundle re-derives them from `user.isAdmin`.
16. **Migration files only** — never edit an applied migration.
17. **Grid sizing is container-relative** (`auto-fill` + `minmax`), because the detail page
    and the assistant dock shrink the pane below `md`/`lg` (a real pane measured 1040px).
18. **A module exporting a component exports only components**
    (`react-refresh/only-export-components`, and lint runs at `--max-warnings 0`). Put
    helpers in their own `.ts` file (`watcherNames.ts`).

## 9. Edge cases

| Case | Behavior |
|---|---|
| Self-connection | `validatePair` throws → 400. The DB CHECK (`a < b`) also forbids it. |
| Same pair again, either order, any letter case | `LEAST/GREATEST` + `ON CONFLICT DO NOTHING` → `created: false`. TypeScript never orders uuids. |
| Connection whose other end loses access or is disabled in Emby | Hidden everywhere: names, picker, history guard (403), sliders, their items in the inbox, recipient list. Admin dialog shows it greyed. Everything returns when access does. |
| Connection removed | As above, but until re-added. Their pending items vanish from the inbox and come back on reconnect (§1.2). |
| Title outside the **viewer's** scope in a connection's history or slider | Filtered out (count and page agree). |
| Title outside the **recipient's** scope (library or parental rating) | Dialog row disabled "Not in their libraries"; POST skips `unavailable`. If scope shrinks after sending, the item drops out of the inbox and the badge. |
| Recommender POSTs a title outside **their own** scope | 404, the same answer the detail page gives, so it never confirms the title exists. |
| Recipient has finished the title | Row disabled "Already watched"; POST skips `already_watched`; a pending item drops out when they finish it (movie: played; series: every non-special episode). |
| Recipient partly through a series, or a movie in progress | Not finished: stays in the inbox, series shows its progress pill. |
| Re-send after dismissal | Upsert clears `dismissed_at`, bumps `recommended_at` → back at the top. |
| Re-send while still pending | Bumps `recommended_at`; no duplicate row. |
| Two recommenders, same item, same recipient | Two rows; one section per recommender. |
| Dismiss twice | Idempotent 204. Someone else's row → 404, never 403. |
| Title deleted from the library | FK cascade removes the rows; nothing dangles. |
| Title deleted between dialog open and send | 404; dialog shows `failed` with the server's sentence. |
| Recipient disconnected mid-dialog | POST skips them `not_connected`. |
| Viewer with no connections | `social` false: no nav entry, no button, no picker, no sliders, no fetches; strip exactly as today (no `watchers` key). |
| Viewer with connections who watched the title | Named "You" in the tooltip and dialog; not counted among the unnamed. |
| Small household (F-110 small-N inference) | "3 Watched" plus two known names identifies the third. Accepted: counts are locked to stay; partial naming sharpens it, and that is inherent to the feature. |
| Admin | Audience stays `all` (no extra query). The admin's own connections still get sliders, inbox and picker. An admin reading anyone's history stays unscoped (admin surface). |
| "View as" (impersonation) | Target's connections, inbox, sliders and connected history visible. Send, dismiss and connection changes are refused (`IMPERSONATION_READ_ONLY`); dialogs show the refusal text. |
| Read-only API key | GETs work; POST/DELETE → 403 `API_KEY_READ_ONLY`. |
| Connected person is also the viewer's taste-twin donor | Unchanged: copy never names the donor (F-049), and the assistant gets no social data. Overlap in a connected history can hint at it; accepted, since connection is full visibility. |
| Connection added while the person is signed in | Nav entry and features appear on the next full load (`/auth/check`). |
| Approximate (backdated) plays, F-108 | Included in slider ordering exactly as in the viewer's own recent list; no date is ever printed. |
| `inbox count` vs page drift | Impossible by construction: the count is the length of the same list (§5.3). |
| Account deleted in Emby | Nothing marks it (F-126), so the connection persists harmlessly. A deleted `users` row cascades connections and recommendations. The audit keeps its labels. |

## 10. Implementation order

Dependency-ordered. Work directly on `dev`, commit locally, and **never push without being
asked** — a push to `origin/dev` starts the Docker build (see CLAUDE.md workflow notes).

1. **Migrations** `0186`/`0187` (§4). Verify with `pnpm --filter @aperture/core test:migrations`,
   then `pnpm db:migrate` if a database is reachable. If it isn't, say so and continue; the
   files are additive.
2. **Core** — `social/` (§5.1, §5.3), finished builders (§5.2), `permissionAudit` `detail`,
   barrel exports and the `test:social` script. Verify:
   `pnpm --filter @aperture/core test:social`, `test:exclusion`, `test:api-keys` (the audit
   scan), `test:library-scope`, then `pnpm --filter "./packages/*" build`.
3. **API** — `routes/social/` + registration (§6.1–6.3), `watcherAudience.ts` + both
   watch-stats call sites (§6.4), `requireSelfOrAdminOrConnected` + scope in
   `watchHistory.ts` + drop its `EXEMPT` entry (§6.5), `social` in `decidedCapabilities`
   (§6.7). Verify: `pnpm --filter @aperture/api typecheck`, `test:routes`, `test:auth`.
4. **Web foundation** — provider trio + mount (§7.1), nav item + badge (§7.2), the
   `/shared-with-me` route (§7.7). Verify: `pnpm --filter @aperture/web typecheck`.
5. **Web features** — hero button + dialog (§7.3), strip/dialog copy (§7.4), history picker
   (§7.5), dashboard sliders (§7.6), page body (§7.7), admin dialog + UserDetail +
   registry alias (§7.8). Verify: `pnpm --filter @aperture/web test` (the `registry.test.ts`
   and `watcherNames` tests).
6. **i18n** — en strings (§7.9), then `pnpm --filter @aperture/web i18n:sync`.
7. **Docs** — CLAUDE.md: add a "Social connections & recommendations" row to the
   Feature → files table; add `user_connections` and `social_recommendations` to the
   Database key tables; update the "Who may be NAMED" rule (its `users` branch is now live,
   the viewer is included, `watcherAudience` is decided); add one naming-trap rule stating
   the visible-connection and scope rules. Add the evidence entry to
   `docs/aperture-forensics.md` under the next free `F-` number. This file stays the deep
   spec; CLAUDE.md stays a pointer.
8. **Full gate** — `pnpm typecheck && pnpm lint`, re-run every test script above, and run
   `i18n:sync` again (it should produce no diff).

## 11. Manual acceptance pass (after implementation)

Browser checks happen on the **deployed** instance, once the operator says the new image is
running. A push only starts the build, so a check right after one tests the old image.

Use two connected test users A and B (admin-created), a third unconnected user C, and a
library that B cannot open.

1. C on any item: strip shows anonymous counts, no names, no Recommend button, no nav entry
   — unchanged from today.
2. A on an item both A and B watched: tooltip "You, B"; the dialog lists both with plays or
   episodes and the connections footer. On an item B and two others watched: "B and 2 other
   people you're not connected to".
3. A opens Watch History → picks B (URL `?user=`): B's movies and series render, no
   mark-unwatched affordance, no ticks, and nothing from the library A cannot open.
   Reload keeps the selection.
4. Before anything is shared, B has no "Shared with me" entry. A recommends an item to B:
   the entry appears with a badge, and the page shows "Recommended by A". B dismisses →
   gone, badge drops, and the entry stays until B leaves the page. A sends a second title; B finishes
   it via playback sync → gone on next load, badge drops. A tries to send a title from the
   library B cannot open → B's row is disabled "Not in their libraries".
5. B's dashboard: one slider for A under Top Picks; none for C; nothing for a connection with
   no recent watches.
6. Admin Users page: row menu → Connections… → add/remove reflected in both users' UIs after
   reload, and in each user's permission history on UserDetail ("Connection · B").
7. Switch A's access off: B loses A's names, slider, history and inbox items, and A is greyed
   in the admin dialog. Switch it back on → all return.
8. View as B (admin): inbox, sliders and connected history visible. Send and dismiss are
   refused with the read-only message.

## 12. Open questions (defaults are in force until the owner says otherwise)

1. **Nav label.** Default "Shared with me" (§1.2). If the owner prefers the original
   "Recommended for me", change `nav.sharedWithMe` and the page strings only; the route can
   stay.
2. **Recipient outside scope.** Default: shown disabled with the reason, which tells the
   recommender that the recipient cannot open that title. The alternative is to omit such
   recipients from the list entirely, which reveals less but looks like they vanished.
3. **"You" in the named list.** Default on. Off means dropping `viewer.id` from the
   audience in `resolveWatcherAudience`, with the viewer then counted among the unnamed.
4. **Inbox after disconnect.** Default: filtered, restored on reconnect. The alternative is
   to delete pending rows in `removeUserConnection` (same transaction).
5. **Slider order.** Default by name (stable). By most recent activity reads fresher on a
   busy household.
6. Cosmetic: sidebar icon (`Recommend`) and badge color (`primary`). Keep it to that one
   component.
