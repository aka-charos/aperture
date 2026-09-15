# Plan: Emby home-screen section sync (Aperture → Emby)

Status: **implemented 2026-09-14** after a second audit. The rule lives in CLAUDE.md's naming traps and the evidence in [F-126](../aperture-forensics.md#f-126). What follows is the audited plan as it stood; the list directly below is where the build departs from it, and the build wins where they disagree.

## What shipped, and where it departs from this plan

- **Emby API confirmed from its own reference** (ContentService, TagService): the five HomeSections paths, `{ Ids }` / `{ Ids, NewIndex }` bodies, `{ Tags: NameIdPair[] }`, `ItemsQuery.TagIds`. `/Items` filters by tag *name* (`Tags`) and has no `TagIds`. The section POST returns an **empty body**. `SectionType` is undocumented; the Home Screen Companion plugin writes `"items"` for a tag row and `"boxset"` for a collection row.
- **New finding — the feedback loop.** Both mappers copied `item.Tags` into `movies.tags`, which both canonical-text builders embed as "Themes". Our own tag would have been embedded. Both mappers now drop `aperture:` tags (`media/managedTags.ts`, pinned).
- **B1 resolved as recommended:** both Top Picks rows are tag rows over the original items; the STRM-backed collection is not used.
- **No section-id state and no `Subtitle` marker.** The row's own tag id identifies it on read-back (the POST returns no id, so the planned `home_sections_state` would have been unfillable). The only table besides config is `home_sections_viewer_tags` — a **random** per-viewer token, because tags are browsable and `/Users/Public` hands out user ids.
- **Migration is `0173`** (0171/0172 were taken by then), with `applied_section_position` so rows move only when created or when the position setting changes.
- **Targets:** recommendation and playlist rows go to `is_enabled AND NOT provider_disabled`; **Top Picks rows go to every account `NOT provider_disabled`** (changed 2026-09-15 on the operator's call — the plan widened Top Picks only to admins, and the first build to nobody extra). Someone who stops qualifying has those rows removed. Switching the feature off is the same run with nothing desired.
- **Placement per feature (2026-09-15, [F-128](../aperture-forensics.md#f-128)).** The single position is replaced by Top / Bottom / Position number / After a row / Before a row for each of five features, with an admin default and a per-viewer override; recommendations are split into movie and series rows. Built-in rows share section ids across accounts, which is what makes an anchor portable.
- **Playlist mode (P1) was not built.** Tag mode only; rows sort by a server field (`Random` default).
- **Sync now** starts the job through `POST /api/jobs/sync-home-sections/run`; the only feature routes are `GET /api/home-sections` and `PATCH /api/home-sections/config`.
- **Admin UI is its own registry leaf**, `/admin/recommendations/home-sections`.
- **Generated playlists added (operator request, same day).** A channel from the Playlists/Collections page, or a playlist made from assistant suggestions, can go on its owner's home screen — from the card, or from a checkbox in the chat's create dialog. Explore-graph playlists are excluded on the operator's call; `graph_playlists.origin` was added to tell the two apart, since both use one table and one route. The row reads the playlist's current items from Emby and never regenerates it, and goes to the owner only.
- **Still unverified on a live server:** POST-with-Id update semantics (duplicates collapse on the next run if it creates instead), tag durability across an Emby metadata refresh (the nightly diff re-applies), and multi-id `Move` order (not relied on).

One-way sync Aperture → Emby, **API-only** (no filesystem access, no STRM, no duplicated items — hard requirement). Each mapped user's Emby home screen gets managed rows:

- a global **Top Picks** row per media type, and
- a per-user **Recommended for you** row.

Aperture never renders Emby sections; it writes them. Emby-only: Jellyfin gets unsupported stubs. Server gate: **Emby ≥ 4.10.0.40**.

**Accepted trade-off (user decision):** API-only means no exact rank ordering on a query-backed row. A dynamic-media section sorts by a fixed server-side field (`SortBy`), tag membership carries no order, and the lean `ItemsQuery` has no `Ids`/`ParentId`. Encoding rank would require either STRM staging (rejected: filesystem coupling, duplicated items) or rewriting original items' `ForcedSortName`/`DateCreated` (rejected: library-wide metadata side effects, cross-user conflicts on shared titles). Unordered it is — `SortBy` becomes a config choice.

---

## Audit summary (2026-09-11)

What the plan got right, verified against the tree: migration `0171` is genuinely the next free number ([db/migrations/](db/migrations/) tops out at `0170_zai_provider.sql`); `refresh-top-picks` really does run at **05:00** per `JOB_SCHEDULE_DEFAULTS` ([jobConfig.ts:180](packages/core/src/jobs/jobConfig.ts#L180)) while [definitions.ts:123](apps/api/src/routes/jobs/definitions.ts#L123) says `0 6 * * *` — the drifting copy CLAUDE.md warns about, and the plan read the authoritative one; `users.provider_access_token` has **zero readers** in core, so "dead by design" is accurate; the recs-ordering rule matches the dashboard's SQL and F-020.

Six findings block or change the build, seven more are corrections. They are folded into the steps below and listed here so none is lost.

### B1 — The Top Picks row is **not** API-only. It shows STRM duplicates.

This is the one finding that changes the design.

[`topPicks/collectionWriter.ts`](packages/core/src/topPicks/collectionWriter.ts) says so in its own header: *"using the items from the Top Picks library itself (not the original library items) to avoid duplicates"*. `getTopPicksLibraryMovieIds(movies, topPicksLibrary)` returns `[]` when the library argument is null, and [`topPicks/job.ts`](packages/core/src/topPicks/job.ts) sets `moviesLib = config.moviesLibraryEnabled ? topPicksLibs.movies : null`. So:

- A Top Picks collection **cannot exist** unless the STRM library output is enabled, written to disk, and scanned by Emby. With library output off, `writeTopPicksMoviesCollection` logs *"No movie items found in Top Picks library, skipping collection"* and returns null.
- Its members are items in the Top Picks **virtual library** — duplicates of the originals. Playing from that row writes watch state against the duplicate, not the real item.

So a `ParentId`-backed Top Picks row inherits a filesystem dependency and item duplication — exactly the two things the hard requirement excludes — and the plan's edge case *"Watch state is real (original items)"* was true only of the recs row. The old wording ("this feature creates no libraries/files itself") was true and misleading: the feature creates nothing, and the row it creates *displays* STRM duplicates.

**Resolution (recommended): build the Top Picks row the same way as the recs row** — a global tag on **original** items plus `SectionType: "items"` + `Query.TagIds`. That makes the feature uniform, removes the STRM dependency outright, and costs only the rank ordering that was already given up for the recs row. It also settles open question 5 below. Two alternatives, both worse: keep `ParentId` and document honestly that the row requires STRM output on (breaks the hard requirement); or mint a *second*, originals-backed BoxSet for this row (server-wide, so it also shows up in everyone's browse view, and Aperture would own a collection the Top Picks feature does not).

The steps below are written for the tag mechanism on both rows, with the `ParentId` variant kept as a documented fallback.

### B2 — The target query misses `provider_disabled`, and there is no removal path for it

`SELECT … WHERE provider = $1 AND (is_enabled OR is_admin)` admits a user the media server no longer has. Every per-user work loop in core gates on `provider_disabled = false` — [StrmWriter.ts:91](packages/core/src/strm/StrmWriter.ts#L91), both recommender pipelines, [rebuildAll.ts:130](packages/core/src/taste-profile/rebuildAll.ts#L130), [twinAffinity.ts:183](packages/core/src/recommender/twinAffinity.ts#L183), both watch-history syncs — and [strm/cleanup.ts:152](packages/core/src/strm/cleanup.ts#L152) treats the flag as grounds to **delete** that user's output. F-104 names this as the general rule.

Two halves, and the second is the one that rots: gate the write, **and** remove existing rows for a user who has since become `provider_disabled` or lost `is_enabled`. Skipping alone leaves their sections on the server forever. The same clause also lets a *disabled* admin through — `(is_enabled OR is_admin)` has no `is_enabled` requirement on the admin branch.

Note `users.is_enabled` means "AI recommendations are enabled for this user" ([0003_users.sql:35](db/migrations/0003_users.sql)), default FALSE — so deliberately widening the Top Picks row to admins is defensible, and must be stated rather than implied.

### B3 — No job-progress lifecycle, so Stop cannot work

F-079: a job that never calls `createJobProgress(jobId, name, steps)` gets **no** progress record, **no** `job_runs` row, an empty log pane, and `isJobCancelled` reduces to `undefined?.status === 'cancelled'` — permanently false — so the Cancel button is inert however diligently the work polls. Every symptom at once, none of them an error.

`syncHomeSections` is a per-user loop of several HTTP round trips each, so it needs the full lifecycle and a cancel poll **between users**, not just at entry. [`topPicks/job.ts`](packages/core/src/topPicks/job.ts) is the worked example: `createJobProgress` → `setJobStep`/`addLog`/`updateJobProgress` → `completeJob`, `failJob` in the catch, and `completeJob` skipped when cancelled (F-080 — `cancelJob` already wrote the row, and a terminal status is a one-way door).

### B4 — Job wiring is a **quintet**, not a trio

The plan lists definitions + executor + `JOB_SCHEDULE_DEFAULTS`, enforced by [`jobDefaults.test.ts`](apps/api/src/routes/jobs/jobDefaults.test.ts). That test covers only the definitions↔defaults pair. Two more are needed and neither fails any build (F-078):

- [`apps/web/src/pages/jobs/registry.ts`](apps/web/src/pages/jobs/registry.ts) — a category's `jobs` array. Its own docstring: *"a job missing from every category renders no card, so it has no Run button and, worse, no Cancel button"*. The Schedule tab still lists it, so the job looks present and cannot be stopped.
- [`apps/web/src/pages/jobs/constants.tsx`](apps/web/src/pages/jobs/constants.tsx) — `JOB_ICONS` and `JOB_COLORS`.

`sync-home-sections` title-cases cleanly to "Sync Home Sections", so no `JOB_DISPLAY_NAME_KEYS` entry is needed.

### B5 — i18n is absent from the plan, and one omission fails a test

New UI strings go to `apps/web/src/i18n/locales/en/translation.json`, then `pnpm --filter @aperture/web i18n:sync` stamps them into the other 14 locales. Beyond that, a **new namespace must be added to `ADMIN_ONLY_NAMESPACES` in [`apps/web/src/i18n/audience.ts`](apps/web/src/i18n/audience.ts)** (the list is sorted; keep it that way) or `audience.test.ts` fails `pnpm --filter @aperture/web test`. The card lives under `pages/settings/`, which `ADMIN_SURFACE_PATHS` already covers, so that half needs nothing.

Also: never write the product name into a string — use `{{appName}}`.

### B6 — A new core test file does not run unless it is scripted

[`packages/core/package.json`](packages/core/package.json) has **no** aggregate `test` script; every test file is named explicitly in a `test:<something>` entry. Same in [`apps/api/package.json`](apps/api/package.json) (`test:jobs` is what runs `jobDefaults.test.ts`). Only `apps/web` globs (`src/**/*.test.ts`). So the two proposed core tests need a `"test:home-sections"` script or they are dead files.

### Corrections

- **C1 — `getServerInfo` is not on the `MediaServerProvider` interface.** It exists on both concrete classes ([EmbyProvider.ts:86](packages/core/src/media/emby/EmbyProvider.ts#L86), [JellyfinProvider.ts:86](packages/core/src/media/jellyfin/JellyfinProvider.ts#L86)) and returns `{ id, name, version }`, but all four call sites duck-type it as `'getServerInfo' in provider` with a cast declaring only `{ id, name }` — **dropping `version`**, which is the whole point here. Add it to the interface: both providers already implement it, so the mirror invariant is satisfied by construction and the four existing casts can be cleaned up later.
- **C2 — `findCollectionByName` is not reachable from the barrel.** [`emby/index.ts`](packages/core/src/media/emby/index.ts) exports auth/users/libraries/movies/series/favorites/playlists — not `collections.js` (nor `persons.js`). The function takes `EmbyProviderBase`, not `MediaServerProvider`. Moot under B1's tag mechanism; a blocker for the `ParentId` fallback.
- **C3 — `provider_item_id` is `TEXT NOT NULL UNIQUE`** on `movies`/`series`/`episodes`, so "NULL-id candidates skipped" names the wrong column. What is nullable is `recommendation_candidates.movie_id` / `series_id`; the dashboard guards it with `AND rc.movie_id IS NOT NULL`.
- **C4 — `moveHomeSections` needs a defined order among our own rows.** Moving three sections to one `NewIndex` leaves their relative order undefined. Decide it: one call with an ordered `Ids` array if the endpoint honours array order, otherwise move them individually in reverse so each insert pushes the previous one down. Probe it (P4).
- **C5 — `Subtitle` is a user-visible field.** Using it to carry `aperture:recs:<userId>` may print that string under the row on the user's home screen. Probe it (P3); if it renders, the marker moves — see Step 1's `home_sections_state` table, which is the better answer anyway.
- **C6 — "Sync now" must go through `startJob`.** [`apps/api/src/routes/jobs/startJob.ts`](apps/api/src/routes/jobs/startJob.ts) is the only in-process way to start a job; it is what claims the name via `claimJob`. A bespoke route calling `syncHomeSections()` directly bypasses the claim guard, so a scheduled run and an operator's button can write the same sections concurrently (F-081), and the operator gets no progress and no Cancel.
- **C7 — the web bundle must not hold `MIN_EMBY_VERSION`.** The status response ships `supported`, `serverVersion` **and** `minVersion` as decided values; the tooltip interpolates them.
- **C8 — cron 05:30 collides with `enrich-studio-logos`.** Use **05:45**. A Top Picks run does up to two 60-second library-scan waits plus collection writes, so 30 minutes is the floor, not the comfortable gap.
- **C9 — the tag write is a metadata write, and the plan should stop implying otherwise.** "Atomic tag apply/remove … no metadata rewrite" is true about the *mechanism* (it is not a full item `POST`), false about the *effect*: the original item's `Tags` field changes, tags are visible on the item detail page, and an Emby metadata refresh set to replace fields may drop them unless the field is locked. This is a smaller version of the `ForcedSortName` side effect the plan rejects, so say what the difference is (one field, reversible, no sort/global-ordering impact, no cross-user conflict since tags coexist) rather than claiming there is none. Probe whether a library refresh survives tags (P5).

### Unverifiable from this repo — everything about the Emby API

Grep for `HomeSection|home_sections|homeSections` across the tree returns **one file: this plan**. There is no existing tag handling in core either (`Tags/Add`, `TagIds`: zero hits). So the entire "Verified API surface" table, the `ContentSection` DTO, the `SectionType` vocabulary, `Query.TagIds` and the tag endpoints are documentation claims, verified against dev.emby.media and not against anything here. Treat Step 0 as a gate on the build, not a formality.

---

## Step 0 — Probes (run before writing any of it)

Against the 4.10.0.40 test server, on a test user, with the admin API key. Each has a decision riding on it.

- **P1 — Ordering.** Playlists are the only API-only construct with intrinsic order. No playlist section type appears in the 4.10 editor/docs, and the HomeScreenCompanion plugin ships playlists "independent of home-section settings" (evidence they cannot back a section) — but `SectionType` is a free string and `ParentId` takes any item id. POST `{ SectionType: "boxset", ParentId: <playlistId> }` and check whether the row renders playlist children in playlist order. **If it works**, recs rows switch to per-user playlists and rank order is recovered for free; if not (expected), tag mode stands.
- **P2 — Upsert semantics.** Does `POST /Users/{UserId}/HomeSections` with `Id` present update, or create a second row? Decides whether the reconcile is a POST-with-Id or a delete-then-create.
- **P3 — Does `Subtitle` render?** Decides whether a marker can live there at all (C5).
- **P4 — `Move` with several ids.** Does `{ Ids: [a,b,c], NewIndex: 0 }` preserve array order? Decides C4.
- **P5 — Tag durability.** Apply a tag, run an Emby library metadata refresh, re-read the item. Decides whether tags need `LockedFields` and whether the sync must re-apply after every scan.
- **P6 — Tag-backed row against a global tag.** Does `SectionType: "items"` + `Query.TagIds` render for a non-admin user, filtered to the libraries that user can see? Gates B1's resolution.

Record the answers in this file before implementing.

## Verified API surface (dev.emby.media/reference/RestAPI/ContentService — external, not repo-verified)

| Endpoint | Body | Purpose |
|---|---|---|
| `GET /Users/{UserId}/HomeSections` | – | `ContentSection[]` — the user's configured rows |
| `POST /Users/{UserId}/HomeSections` | `ContentSection` | create **and** update (`Id` present ⇒ update — **P2**) |
| `POST /Users/{UserId}/HomeSections/Delete` | `{ Ids: string[] }` | remove rows |
| `POST /Users/{UserId}/HomeSections/Move` | `{ Ids: string[], NewIndex: int }` | reorder (**P4**) |
| `GET /Users/{UserId}/Sections/{SectionId}/Items` | item-query params | the row's items (status/verification only) |
| `GET /Tags` | item-query params | tag list with ids |
| `POST /Items/{Id}/Tags/Add` · `/Tags/Delete` | `{ Tags: NameIdPair[] }` | tag apply/remove on original items |

`ContentSection` = `{ Id, SectionType ("items" dynamic media | "boxset" single-collection row), CustomName, Subtitle, ParentId, ItemTypes[], ExcludedFolders[], Query{TagIds, GenreIds, StudioIds, CollectionTypes, IsPlayed, IsFavorite, IsResumable, …}, SortBy, SortOrder, DisplayMode, ImageType, ViewType ("spotlight"), ScrollDirection, … }`. No explicit-items field exists (verified against the full DTO) — sections are query- or parent-backed only. No item-count field appears either, so **row length is set by tag membership**, which is why `recommendations_limit` caps what gets tagged rather than what gets displayed.

All calls use the existing admin API key from `system_settings` (`getMediaServerApiKey()`, [systemSettings.ts:441](packages/core/src/settings/systemSettings.ts#L441)) plus a user-id path param — the same pattern as every provider call.

## ID mapping (audited)

- `movies.provider_item_id` / `series.provider_item_id` = the Emby item ids, `TEXT NOT NULL UNIQUE` — the mapping key everywhere, never null (C3).
- Recommendations: `recommendation_candidates.movie_id` / `series_id` (internal UUIDs, **nullable**) → JOIN `movies`/`series` for `provider_item_id`.
- Top Picks: `getTopMovies()` / `getTopSeries()` from [`topPicks/popularity.ts`](packages/core/src/topPicks/popularity.ts) — the same source the dashboard and the Top Picks page read, which is what lets the row exist without the STRM library (B1). The `ParentId` fallback instead resolves a collection by name and requires that library.
- Emby user id: `users.provider_user_id`, filtered by `users.provider = configured type`.

---

## Step 1 — Migration `db/migrations/0171_home_sections.sql`

Two tables. The singleton follows the `top_picks_config` pattern; the state table exists because of C5 — Aperture owning the id mapping beats stamping a machine marker into a field the user may be able to read.

```sql
CREATE TABLE IF NOT EXISTS home_sections_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  top_picks_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  recommendations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  section_position INTEGER NOT NULL DEFAULT 0,          -- Move index, 0 = top
  top_picks_custom_name TEXT,                            -- NULL = a translated default
  recommendations_custom_name TEXT NOT NULL DEFAULT 'Recommended for you',
  recommendations_sort TEXT NOT NULL DEFAULT 'Random',   -- honest server-side SortBy; no rank exists
  recommendations_limit INTEGER NOT NULL DEFAULT 20,     -- per media type; caps tag membership
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO home_sections_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Which Emby section id belongs to which Aperture-managed row, per user.
-- kind: 'top-picks-movies' | 'top-picks-series' | 'recs'
CREATE TABLE IF NOT EXISTS home_sections_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  provider_section_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, kind)
);
```

`ON DELETE CASCADE` means a user removed from Aperture drops their mapping — the sections on the server then have no owner, so cleanup must run **before** the user row goes, or those rows are orphaned. Same trap the STRM cleanup answers; note it in the sync's docstring.

The state table is a cache, never the authority: every run re-reads `GET /Users/{id}/HomeSections` and treats a stored id that is no longer present as "the user deleted our row, recreate it". A section present on the server with no stored id is adopted only if `Subtitle`/`CustomName` matches ours (belt to the state table's braces, and the self-healing property the marker design had).

## Step 2 — Core media layer (mirror invariant)

**[`packages/core/src/media/types.ts`](packages/core/src/media/types.ts)** — add `ContentSectionQuery` + `ContentSection`.

**[`MediaServerProvider.ts`](packages/core/src/media/MediaServerProvider.ts)** — six new methods (both providers keep equal method counts):

```ts
getServerInfo(apiKey: string): Promise<{ id: string; name: string; version: string }>  // C1: already on both classes, just unlisted
getHomeSections(apiKey: string, userId: string): Promise<ContentSection[]>
upsertHomeSection(apiKey: string, userId: string, section: ContentSection): Promise<ContentSection>
deleteHomeSections(apiKey: string, userId: string, sectionIds: string[]): Promise<void>
moveHomeSections(apiKey: string, userId: string, sectionIds: string[], newIndex: number): Promise<void>
addItemTags(apiKey: string, itemId: string, tags: string[]): Promise<void>
removeItemTags(apiKey: string, itemId: string, tags: string[]): Promise<void>
findTagId(apiKey: string, name: string): Promise<string | null>
```

`upsertHomeSection` returns the section so the created `Id` can be stored without a second GET.

**`media/emby/homeSections.ts`** (new): wrappers over `provider.fetch` ([base.ts](packages/core/src/media/emby/base.ts) — `EmbyProviderBase.fetch` is public and already handles auth headers, timeout, and error mapping). Wire into `EmbyProvider.ts` **and** `emby/index.ts`. Tags can share the file or get `media/emby/tags.ts`.

**`media/jellyfin/homeSections.ts`** (new): typed unsupported stubs; wire into `JellyfinProvider.ts` + `jellyfin/index.ts` (documented divergence).

## Step 3 — Core `packages/core/src/homeSections/` (new module, barrel export)

Export from [`packages/core/src/index.ts`](packages/core/src/index.ts). No `package.json` subpath export is needed — `topPicks` has none either.

**`version.ts`** — server gate:

```ts
export const MIN_EMBY_VERSION = '4.10.0.40'
// Numeric [major, minor, build, patch] compare; false on missing/garbage version.
export function isEmbyVersionSupported(version: string | null | undefined): boolean
```

**`config.ts`** — `getHomeSectionsConfig()` / `updateHomeSectionsConfig(partial)` mirroring [`topPicks/config.ts`](packages/core/src/topPicks/config.ts).

**`plan.ts`** — pure: given targets, ranked ids and the sections currently on the server, produce the create / update / delete / tag-diff work. No DB, no HTTP. This is the duplicated-predicate rule: the reconcile logic is the part with the silent failures, and it is the only part a test can pin.

**`sync.ts`** — `syncHomeSections(existingJobId?)` / `removeHomeSections(opts?)`. Algorithm:

0. **Job lifecycle (B3)**: `createJobProgress(jobId, 'sync-home-sections', <steps>)` first thing; `setJobStep`/`addLog` per phase; `isJobCancelled(jobId)` polled **between users**; `completeJob` on success, `failJob` in the catch, neither when cancelled.
1. **Gate**: `config.enabled` else no-op. `provider.type !== 'emby'` ⇒ `{ skipped: 'unsupported-provider' }`. Live `getServerInfo(apiKey)` → `isEmbyVersionSupported` ⇒ `{ skipped: 'unsupported-server', serverVersion }`. Config stays `enabled` (intent); reality enforced per run — no auto-disable on downgrade.
2. **Targets (B2)**:
   ```sql
   SELECT id, provider_user_id, username, display_name, is_enabled, is_admin
   FROM users
   WHERE provider = $1 AND provider_user_id IS NOT NULL AND provider_disabled = false
   ```
   Top-picks rows → every target (admins included even with `is_enabled = false`, since that flag means "AI recommendations on" and a global row is not one). Recs rows → targets with `is_enabled = true` and a completed run. Separately, **every user in `home_sections_state` who is no longer a target gets their rows and tags removed** — this is the half that otherwise rots.
3. **Top Picks sections** (per media type, tag mechanism): ranked ids from `getTopMovies()`/`getTopSeries()` → `movies`/`series` → `provider_item_id`. One global tag per media type (`aperture-top-picks-movies` / `-series`). Diff and apply once per run, not per user — the tag is global, only the section is per-user. Desired section:
   `{ SectionType: "items", CustomName: <config.topPicksCustomName || default>, Query: { TagIds: [tagId] }, ItemTypes: ["Movie"|"Series"], SortBy: <config.recommendations_sort>, SortOrder: "Ascending" }`.
   *Fallback (`ParentId`) variant, only if P6 fails:* resolve the collection by name via `findCollectionByName` (needs C2's barrel export) and emit `{ SectionType: "boxset", ParentId: <collectionId> }` — and state plainly in the UI that the row requires Top Picks **library** output, because the collection does not exist without it (B1).
4. **Recs sections per user** — ranked provider ids, spelled out rather than "dashboard-identical" (C4/F-020):
   ```sql
   SELECT m.provider_item_id
   FROM recommendation_candidates rc
   JOIN movies m ON m.id = rc.movie_id
   WHERE rc.run_id = (
           SELECT id FROM recommendation_runs
           WHERE user_id = $1 AND status = 'completed' AND media_type = 'movie'
           ORDER BY created_at DESC LIMIT 1)
     AND rc.is_selected = true
     AND rc.movie_id IS NOT NULL
   ORDER BY rc.selected_rank ASC NULLS LAST
   LIMIT $2
   ```
   plus the series mirror. `is_selected`, `selected_rank` and the newest-**completed**-run pin are all load-bearing: `final_score` would systematically bury reserved-slot picks, and a superseded run still holds its selected rows by design.
   - **Tag mode (expected)**: ensure tag `aperture-recs-<providerUserId>` (`GET /Tags`; create by `Tags/Add` on the first item, re-`GET` to resolve the id) → diff `GET /Users/{userId}/Items?Tags=<name>` against desired → `Tags/Add` new / `Tags/Delete` stale on **original** items, per-op non-fatal → section `{ SectionType: "items", Query: { TagIds: [tagId] }, SortBy: …, SortOrder: "Ascending" }`.
   - **Playlist mode (only if P1 succeeds)**: `createOrUpdatePlaylist(apiKey, providerUserId, "Aperture Recs <displayName>", rankedIds)` — [emby/playlists.ts:17](packages/core/src/media/emby/playlists.ts#L17) already finds by name scoped to `userId` and rewrites contents, so per-user playlists are safe — then `{ SectionType: "boxset", ParentId: <playlistId> }`. Rank order honored, still fully API-only.
   - **Interleaving only exists in playlist mode.** In tag mode the server re-sorts by `SortBy`, so `recommendations_limit` is a cap on tag membership and nothing else; do not build an interleave that the server discards.
   - Empty recs for a user ⇒ remove that user's recs section (+ tag cleanup / playlist delete).
5. **Reconcile per user**: GET sections → match against `home_sections_state` (falling back to a `CustomName`/marker match for rows we lost track of). Desired+known ⇒ POST with that `Id` (P2); desired+unknown ⇒ POST without `Id`, store the returned id. Managed rows no longer desired ⇒ delete and drop the state row. Then `moveHomeSections` to `section_position` with a **defined order among our own rows** (C4/P4).
6. **Cleanup (`removeHomeSections`)**: delete managed sections on all targets; drop the state rows; `Tags/Delete` every Aperture tag from every item that carries it; playlist mode ⇒ `deletePlaylist` per user. Runs on feature-disable, and per-user on de-targeting (step 2).
7. **Result**: `{ usersProcessed, sectionsCreated, sectionsUpdated, sectionsRemoved, tagsApplied, tagsRemoved, skipped?, serverVersion?, errors: [{ userId, message }] }` — per-user try/catch, errors accumulate. Logger: `createChildLogger('home-sections-sync')`.

## Step 4 — API routes `apps/api/src/routes/home-sections/` (register in [routes/index.ts](apps/api/src/routes/index.ts))

- `POST /api/home-sections/sync` — `requireAdmin` — returns `startJob('sync-home-sections')`'s result (C6): `{ jobId }` on 200, 409 with the claim's own message when one is already running. Never calls `syncHomeSections` directly.
- `GET /api/home-sections/status` — `requireAdmin` — `{ providerType, serverVersion, minVersion, supported, config, lastJobRun, lastSkipReason }`. `minVersion` ships as a decided value so the web bundle never holds the constant (C7).
- `GET|PATCH /api/home-sections/config` — `requireAdmin`. **Enable-time hard gate**: PATCH setting `enabled: true` runs a live version check first and rejects 400 ("Emby server 4.10.0.40+ required, found X") when provider ≠ emby or version below floor.

## Step 5 — Job wiring (five files, B4)

1. [`apps/api/src/routes/jobs/definitions.ts`](apps/api/src/routes/jobs/definitions.ts): `{ name: 'sync-home-sections', description: 'Sync managed rows to Emby home screens', cron: '45 5 * * *' }`.
2. [`apps/api/src/routes/jobs/executor.ts`](apps/api/src/routes/jobs/executor.ts): `case 'sync-home-sections'` → dynamic-import `syncHomeSections(jobId)`, log the result fields (style of `case 'refresh-top-picks'`, executor.ts:588).
3. [`packages/core/src/jobs/jobConfig.ts`](packages/core/src/jobs/jobConfig.ts): `'sync-home-sections': { scheduleType: 'daily', hour: 5, minute: 45 }` — after `refresh-top-picks` (05:00) and clear of `enrich-studio-logos` (05:30, C8); the recommendation runs are weekly Sun 04:00.
4. [`apps/web/src/pages/jobs/registry.ts`](apps/web/src/pages/jobs/registry.ts): add to `globalCurated`'s `jobs` array, beside `refresh-top-picks`.
5. [`apps/web/src/pages/jobs/constants.tsx`](apps/web/src/pages/jobs/constants.tsx): a `JOB_ICONS` entry (`HomeIcon`) and a `JOB_COLORS` entry.

Optional: a progressive-tense name under `runningJobs.jobNames` ("Syncing Home Sections"); without it the widget falls back to the card's own title, which reads fine.

## Step 6 — Web admin UI

`apps/web/src/pages/settings/topPicks/HomeSectionsConfigCard.tsx` beside `TopPicksOutputConfigCard.tsx` (registered through `cards.ts`). Uses status: detected server **version + pass/fail badge**; the enable toggle and "Sync now" **disabled with a tooltip naming `minVersion` from the API** when `supported` is false; last skip reason. Fields: master toggle, per-row toggles, position, custom names, sort select, "Sync now", status line.

Also (C8/registry rules — the plan previously skipped this entirely):

- [`apps/web/src/pages/admin/nav/registry.ts`](apps/web/src/pages/admin/nav/registry.ts): at minimum add `home screen`, `home sections`, `emby rows` to the `top-picks` entry's `aliases`, plus `fields` anchors for the toggle and the sort select. **Recommended instead**: give it its own leaf `home-sections` in the `recommendations` group (+ an `elements.tsx` entry), because half the feature is recommendation rows and burying it under Top Picks is the naming trap this registry exists to prevent. Cost: that group goes from 10 entries to 11, against the registry's own "split past ~12" rule.
- `registry.test.ts` pins entry↔element parity, every i18n key resolving in `en`, and **that every declared field anchor exists as a rendered `id`** — including catching the `id`-written-as-a-JSX-child shape that passes typecheck, lint and grep.

## Step 7 — Docs, tests, builds

- `CLAUDE.md`: cross-reference row (core `homeSections/`, API `home-sections/`, job `sync-home-sections`, tables `home_sections_config`/`home_sections_state`) + the mirror note (jellyfin stubs intentional). If B1's finding survives contact with the server, it earns a naming-trap bullet and an `F-NNN` in `docs/aperture-forensics.md`: *the Top Picks collection is STRM-backed, so anything pointing at it inherits a filesystem dependency*.
- Tests: `homeSections/version.test.ts` (parse/compare table incl. `4.10.0.40` pass, `4.10.0.39` fail, garbage fail, null fail) and `homeSections/plan.test.ts` (target selection incl. `provider_disabled` and de-targeted removal; desired-vs-existing diff; adopt-unknown; duplicate collapse; tag diff; empty-recs removal). **Add `"test:home-sections": "node --import tsx --test src/homeSections/version.test.ts src/homeSections/plan.test.ts"` to `packages/core/package.json`** or neither ever runs (B6).
- i18n: new strings into `locales/en/translation.json`, new namespace into `ADMIN_ONLY_NAMESPACES`, then `pnpm --filter @aperture/web i18n:sync` (B5).
- `pnpm --filter "./packages/*" build` → `pnpm typecheck` → `pnpm lint` → `pnpm --filter @aperture/web test` → `pnpm --filter @aperture/core test:home-sections` → `pnpm --filter @aperture/api test:jobs`.

## Edge cases

- Unsupported provider/server: clean skip + visible status; PATCH enable rejected 400; runs never error; server downgraded after enable ⇒ runs skip with reason, config unchanged.
- User becomes `provider_disabled` or loses `is_enabled`: their rows and tags are **removed**, not merely skipped (B2).
- User deleted from Aperture: `home_sections_state` cascades away, so cleanup must run before the delete or the Emby rows are orphaned.
- Recs tags are visible on item detail pages in Emby (minor cosmetic; the tag name carries the user id). An Emby metadata refresh may strip them — P5 decides whether `LockedFields` or a re-apply pass is needed (C9).
- Tag membership is global (tags live on the item), but the *section* is per-user — each user sees only their own row; two users tagging the same title is harmless (both tags coexist).
- Watch state is real on both rows **under the tag mechanism** (original items). Under the `ParentId` fallback the Top Picks row shows STRM duplicates and watch state lands on the duplicate (B1).
- Duplicate rows: collapse; user deletes our row: recreated next sync; tag op failures: non-fatal, section still updates.
- Playlist mode (if adopted): playlists are per-owner — created per user via the admin key; visibility limited to that owner.

## Rejected alternatives (documented)

- **STRM staging per user** — rejected by user decision: filesystem coupling, duplicated libraries/items; the feature must be API-only.
- **`ForcedSortName`/`DateCreated` rewrites on original items**: library-wide metadata side effects; cross-user conflicts on shared titles (two users, one title, two ranks).
- **BoxSet collections of originals for recs**: collections are server-wide — every user would see everyone's "Recommended for X"; tags + per-user sections avoid that.
- **Explicit-item sections**: no such field in `ContentSection` (verified) — sections are query- or parent-backed only.
- **Pointing the Top Picks row at the existing Top Picks collection** (the original plan): inherits the STRM dependency and shows duplicate items — B1.

## Open decisions

1. **B1's resolution** — tag the originals (recommended, uniform, no STRM), or keep `ParentId` and document the STRM dependency? Gated on P6.
2. Run the playlist probe (P1) first for a chance at rank order, or skip straight to tag mode accepting unordered?
3. `recommendations_sort` default — `Random` (recommended: a row with no rank should not pretend to one, and it changes between visits) vs `SortName` vs `DateCreated`.
4. Marker mechanism — `home_sections_state` table (recommended) vs `Subtitle` marker, gated on P3.
5. Admin UI home — a card inside Top Picks, or its own `home-sections` registry leaf (recommended)?
6. `DisplayMode`/`ImageType` passthrough, or omit (server defaults)? Recommend omit until someone asks.

## Manual verification (against the 4.10.0.40 server)

1. Probes P1–P6, answers recorded above. 2. Enable → Sync now → top-picks rows + per-user recs rows appear on a **non-admin** user's home screen. 3. Re-run → updates in place, no duplicates. 4. Position change → rows move, and our rows keep their relative order. 5. Recommendations toggle off → sync removes recs rows and cleans tags (or deletes playlists). 6. A user with no completed run → only top-picks rows. 7. Disable a user in Emby → next `sync-users` sets `provider_disabled`, next home-sections run removes their rows. 8. Status against a <4.10.0.40 server → unsupported badge, toggle disabled, sync no-ops. 9. Press Stop mid-run → the job actually stops between users and files a `job_runs` row.
