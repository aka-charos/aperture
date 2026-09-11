# Plan: Emby home-screen section sync (Aperture → Emby)

Status: planning — under discussion. Not implemented.

One-way sync Aperture → Emby, **API-only** (no filesystem access, no STRM, no duplicated items — hard requirement). Each mapped user's Emby home screen gets managed rows:

- a global **Top Picks** row per media type (`SectionType: "boxset"` → the *existing* Top Picks collections, whatever the Top Picks feature already produced), and
- a per-user **Recommended for you** row (`SectionType: "items"` + `Query.TagIds` on original items via TagService).

Aperture never renders Emby sections; it writes them. Emby-only: Jellyfin gets unsupported stubs. Server gate: **Emby ≥ 4.10.0.40**.

**Accepted trade-off (user decision):** API-only means no exact rank ordering on the recs row. A dynamic-media section sorts by a fixed server-side field (`SortBy`), tag membership carries no order, and the lean `ItemsQuery` has no `Ids`/`ParentId`. Encoding rank would require either STRM staging (rejected: filesystem coupling, duplicated items) or rewriting original items' `ForcedSortName`/`DateCreated` (rejected: library-wide metadata side effects, cross-user conflicts on shared titles). Unordered it is — `SortBy` becomes a config choice.

**Ordering experiment (cheap, before building the tag path):** playlists are the only API-only construct with intrinsic order. No playlist section type appears in the 4.10 editor/docs and the HomeScreenCompanion plugin ships playlists "independent of home-section settings" (evidence they can't back a section) — but `SectionType` is a free string and `ParentId` takes any item id, so one probe on a test user settles it: POST `{ SectionType: "boxset", ParentId: <playlistId> }` and check whether the row renders playlist children in playlist order. **If it works**, recs rows switch to per-user playlists (created on behalf of each user via admin key + user id — the standard repo pattern) and rank order is recovered for free; if not (expected), the tag design below stands. Run this first during implementation.

---

## Verified API surface (dev.emby.media/reference/RestAPI/ContentService)

| Endpoint | Body | Purpose |
|---|---|---|
| `GET /Users/{UserId}/HomeSections` | – | `ContentSection[]` — the user's configured rows |
| `POST /Users/{UserId}/HomeSections` | `ContentSection` | create **and** update (only write endpoint; `Id` present ⇒ update — verify on first sync, fallback delete+recreate) |
| `POST /Users/{UserId}/HomeSections/Delete` | `{ Ids: string[] }` | remove rows |
| `POST /Users/{UserId}/HomeSections/Move` | `{ Ids: string[], NewIndex: int }` | reorder |
| `GET /Users/{UserId}/Sections/{SectionId}/Items` | item-query params | the row's items (status/verification only) |
| `GET /Tags` | item-query params | tag list with ids |
| `POST /Items/{Id}/Tags/Add` · `/Tags/Delete` | `{ Tags: NameIdPair[] }` | atomic tag apply/remove on original items — no metadata rewrite |

`ContentSection` = `{ Id, SectionType ("items" dynamic media | "boxset" single-collection row), CustomName, Subtitle, ParentId, ItemTypes[], ExcludedFolders[], Query{TagIds, GenreIds, StudioIds, CollectionTypes, IsPlayed, IsFavorite, IsResumable, …}, SortBy, SortOrder, DisplayMode, ImageType, ViewType ("spotlight"), ScrollDirection, … }`. No explicit-items field exists (verified against the full DTO) — sections are query- or parent-backed only.

All calls use the existing admin API key from `system_settings` + user-id path param (same pattern as every provider call; `users.provider_access_token` is dead by design).

## ID mapping (audited)

- `movies.provider_item_id` / `series.provider_item_id` = the Emby item ids (unique) — the mapping key everywhere.
- Top Picks rows: collection id resolved by name (`findCollectionByName` with `top_picks_config` names). The collections are whatever the existing Top Picks feature maintains (`topPicks/collectionWriter.ts`); this feature creates **no** libraries/files itself. No collection (output disabled/not yet run) ⇒ row skipped with a log line.
- Recommendations: `recommendation_candidates.movie_id/series_id` (internal UUIDs) → JOIN movies/series for `provider_item_id`; NULL-id candidates skipped.
- Emby user id: `users.provider_user_id`, filtered by `users.provider = configured type`.

---

## Step 1 — Migration `db/migrations/0171_home_sections_config.sql`

Singleton table, `top_picks_config` pattern:

```sql
CREATE TABLE IF NOT EXISTS home_sections_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  top_picks_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  recommendations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  section_position INTEGER NOT NULL DEFAULT 0,          -- MoveHomeSections index, 0 = top
  top_picks_custom_name TEXT,                            -- NULL = use collection name
  recommendations_custom_name TEXT NOT NULL DEFAULT 'Recommended for you',
  recommendations_sort TEXT NOT NULL DEFAULT 'Random',   -- honest server-side SortBy; no rank exists
  recommendations_limit INTEGER NOT NULL DEFAULT 20,     -- per media type, before interleave
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO home_sections_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
```

## Step 2 — Core media layer (mirror invariant)

**`packages/core/src/media/types.ts`** — add `ContentSectionQuery` + `ContentSection` (shapes as above).

**`MediaServerProvider.ts`** — 4 new methods (both providers keep equal method counts):

```ts
getHomeSections(apiKey: string, userId: string): Promise<ContentSection[]>
upsertHomeSection(apiKey: string, userId: string, section: ContentSection): Promise<void>
deleteHomeSections(apiKey: string, userId: string, sectionIds: string[]): Promise<void>
moveHomeSections(apiKey: string, userId: string, sectionIds: string[], newIndex: number): Promise<void>
```

**`media/emby/homeSections.ts`** (new): wrappers over `provider.fetch` against the 4 ContentService endpoints; wire into `EmbyProvider.ts` + `emby/index.ts`. **`media/jellyfin/homeSections.ts`** (new): typed unsupported stubs; wire into `JellyfinProvider.ts` + `jellyfin/index.ts` (documented divergence).

## Step 3 — Core `packages/core/src/homeSections/` (new module, barrel export)

**`version.ts`** — server gate:

```ts
export const MIN_EMBY_VERSION = '4.10.0.40'
// Numeric [major, minor, build, patch] compare; false on missing/garbage version.
export function isEmbyVersionSupported(version: string | null | undefined): boolean
```

**`config.ts`** — `getHomeSectionsConfig()` / `updateHomeSectionsConfig(partial)` mirroring `topPicks/config.ts`.

**`sync.ts`** — `syncHomeSections(opts?)` / `removeHomeSections(opts?)`. Algorithm:

1. **Gate**: `config.enabled` else no-op. `provider.type !== 'emby'` ⇒ `{ skipped: 'unsupported-provider' }`. Live `getServerInfo(apiKey)` → `isEmbyVersionSupported` ⇒ `{ skipped: 'unsupported-server', serverVersion }`. Config stays `enabled` (intent); reality enforced per run — no auto-disable on downgrade.
2. **Targets**: `SELECT id, provider_user_id, username FROM users WHERE provider = $1 AND (is_enabled OR is_admin)`. Top-picks rows → all targets; recs rows → targets with a completed run.
3. **Top Picks sections** (per media type): collection via `findCollectionByName` (`top_picks_config` names); skip+log if missing. Desired section:
   `{ SectionType: "boxset", Subtitle: "aperture:top-picks-movies"|"aperture:top-picks-series", CustomName: <config.topPicksCustomName || collection name>, ParentId: <collectionId> }`.
4. **Recs sections per user**: ranked provider ids from `recommendation_runs`/`recommendation_candidates` (dashboard-identical SQL, `ORDER BY selected_rank LIMIT recommendations_limit`, movies+series interleaved). Two mechanisms, decided by the Step-0 probe:
   - **Playlist mode (if the probe succeeds — preferred)**: `createOrUpdatePlaylist(apiKey, providerUserId, "Aperture Recs <displayName>", rankedIds)` → section `{ SectionType: "boxset", Subtitle: "aperture:recs:<providerUserId>", CustomName, ParentId: <playlistId> }`. Rank order honored; still fully API-only.
   - **Tag mode (fallback, expected)**: ensure tag `aperture-recs-<providerUserId>` (via `GET /Tags`; create by `Tags/Add` on the first item, re-`GET` to resolve id) → diff `GET /Users/{userId}/Items?Tags=<name>` vs desired ids → `Tags/Add` new / `Tags/Delete` stale (original items; non-fatal per-op) → section `{ SectionType: "items", Subtitle: "aperture:recs:<providerUserId>", CustomName, Query: { TagIds: [tagId] }, SortBy: <config.recommendations_sort>, SortOrder: "Ascending" }`.
   Empty recs for a user ⇒ remove that user's recs section (+ tag cleanup in tag mode / delete playlist in playlist mode).
5. **Reconcile per user**: GET sections → partition by `Subtitle` marker prefix `aperture:`. Desired+existing ⇒ POST with existing `Id`; desired+missing ⇒ POST without `Id`. **Upsert-semantics probe**: after the first POST-with-Id of a run, re-GET; if markers duplicated, delete the older and warn (self-heals if POST is create-only). Marker sections no longer desired ⇒ delete. Then `moveHomeSections` to `section_position`.
6. **Cleanup (`removeHomeSections`)**: delete marker sections on all targets; tag mode ⇒ `Tags/Delete` the rec tag from all items; playlist mode ⇒ `deletePlaylist` per user.
7. **Result**: `{ usersProcessed, sectionsCreated, sectionsUpdated, sectionsRemoved, tagsApplied, tagsRemoved, errors: [{ userId, message }] }` — per-user try/catch, errors accumulate. Logger: `createChildLogger('home-sections-sync')`.

## Step 4 — API routes `apps/api/src/routes/home-sections/` (register in `routes/index.ts`)

- `POST /api/home-sections/sync` — `requireAdmin` — body `{ topPicks?, recommendations? }` → SyncResult.
- `GET /api/home-sections/status` — `requireAdmin` — `{ providerType, serverVersion, supported, config, lastJobRun }` + live marker probe on the first admin user.
- `GET|PATCH /api/home-sections/config` — `requireAdmin`. **Enable-time hard gate**: PATCH setting `enabled: true` runs a live version check first and rejects 400 ("Emby server 4.10.0.40+ required, found X") when provider ≠ emby or version below floor.

## Step 5 — Job wiring (trio enforced by `jobDefaults.test.ts`)

- `apps/api/src/routes/jobs/definitions.ts`: `{ name: 'sync-home-sections', description: '…', cron: '30 5 * * *' }`.
- `apps/api/src/routes/jobs/executor.ts`: `case 'sync-home-sections'` → dynamic-import `syncHomeSections`, log result fields (style of `case 'refresh-top-picks'`, executor.ts:589).
- `packages/core/src/jobs/jobConfig.ts`: `JOB_SCHEDULE_DEFAULTS['sync-home-sections'] = { scheduleType: 'daily', hour: 5, minute: 30 }` (after `refresh-top-picks` 05:00; recs run Sun 04:00).

## Step 6 — Web admin UI

`apps/web/src/pages/settings/topPicks/HomeSectionsConfigCard.tsx` beside `TopPicksOutputConfigCard.tsx`. Uses status: shows detected server **version + pass/fail badge**; the enable toggle and "Sync now" are **disabled with a tooltip** (naming the required version) when `supported` is false; shows the last skip reason. Fields: master toggle, per-row toggles (top picks / recommendations), position, custom names, sort select (honest server-side options), "Sync now", status line.

## Step 7 — Docs, tests, builds

- `CLAUDE.md`: cross-reference row (core `homeSections/`, API `home-sections/`, job `sync-home-sections`) + mirror note (jellyfin stubs intentional).
- Tests: `homeSections/version.test.ts` (parse/compare table incl. `4.10.0.40` pass, `4.10.0.39` fail, garbage fail) and `homeSections/sync.test.ts` (marker partitioning, desired-vs-existing diff, duplicate collapse, tag diff — mocked provider).
- `pnpm --filter "./packages/*" build` → `pnpm typecheck` → `pnpm lint`.

## Edge cases

- Unsupported provider/server: clean skip + visible status; PATCH enable rejected 400; runs never error; server downgraded after enable ⇒ runs skip with reason, config unchanged.
- Top Picks collections absent (output disabled / feature never run): top-picks rows skipped with a log line; recs rows unaffected.
- Recs tags are visible on item detail pages in Emby (minor cosmetic; tag name carries the username).
- Tag membership is global (tags live on the item), but the *section* is per-user — each user only sees their own row; two users tagging the same title is harmless (both tags coexist).
- Watch state is real (original items) — watching from the row updates the actual item.
- Duplicate markers: collapse; user deletes our row: recreated next sync; tag op failures: non-fatal, section still updates.
- Playlist mode (if adopted): playlists are per-owner — created per user via admin key; visibility of "Aperture Recs" playlists limited to that owner.

## Rejected alternatives (documented)

- **STRM staging per user** — rejected by user decision: filesystem coupling between Aperture and Emby, duplicated libraries/items; the feature must be API-only.
- **ForcedSortName/DateCreated rewrites on original items**: library-wide metadata side effects; cross-user conflicts on shared titles (two users, one title, two ranks).
- **BoxSet collections of originals for recs**: collections are server-wide — every user would see everyone's "Recommended for X"; tags + per-user sections avoid that.
- **Explicit-item sections**: no such field in `ContentSection` (verified) — sections are query- or parent-backed only.

## Open decisions (for discussion)

- Run the playlist probe first (chance to recover rank order API-only), or skip straight to tag mode accepting unordered?
- `recommendations_sort` default (`Random` vs `SortName` vs `DateCreated`).
- Markers `aperture:top-picks-movies` / `aperture:top-picks-series` / `aperture:recs:<userId>`; tag name `aperture-recs-<providerUserId>`.
- `DisplayMode`/`ImageType` passthrough, or omit (server defaults).
- Top Picks rows: keep boxset→existing collections, or also offer the tag mechanism for fully-uniform API-only rows (loses collection order)?

## Manual verification (against the 4.10.0.40 server)

1. Playlist probe on a test user (if pursuing). 2. Enable → Sync now → top-picks rows (existing collections) + per-user recs rows appear. 3. Re-run → updates in place, no duplicates. 4. Position change → rows move. 5. Recommendations toggle off → sync removes recs rows + tags cleaned (or playlists deleted). 6. User without runs → only top-picks rows. 7. Status against a <4.10.0.40 server → unsupported badge, toggle disabled, sync no-ops.
