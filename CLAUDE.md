# Aperture — Repo Map

Self-hosted media recommendation & watch-tracking app for Emby/Jellyfin. AI recommendations via pgvector embeddings, plus integrations: TMDB, OMDb, Trakt, Seerr (Jellyseerr/Overseerr), MDBList, JustWatch, n8n, Tavily.

> **Keep this map current.** When you add/move/rename a route, page, core module, or table, update the relevant section here in the same change. This file is the primary navigation aid — stale entries cause wrong-file edits.

## Architecture (30 seconds)

pnpm monorepo, ESM everywhere, no ORM (raw SQL via `pg`):

- **`packages/core`** (`@aperture/core`) — ALL domain logic. Built with `tsc` → `dist/`. Subpath exports: `.`, `/config`, `/db`, `/media`, `/recommender`, `/strm`, `/channels`, `/jobs`, `/watching`. Root `src/index.ts` is a giant barrel (~1090 lines).
- **`apps/api`** (`@aperture/api`) — thin Fastify HTTP layer (port 3456): routing, auth, job orchestration. Handlers call core functions; `src/lib/db.ts`, `lib/logger.ts`, `config/env.ts` are pure re-export shims of core.
- **`apps/web`** (`@aperture/web`) — Vite + React 18 SPA (dev port 3457, proxies `/api` → 3456). MUI 6, react-router 7, i18next (15 locales), d3, recharts. **Never imports `@aperture/core`** (server code would break the bundle — duplicate tiny helpers instead, see `src/i18n/localeDirection.ts`). No central API client: raw `fetch('/api/...', { credentials: 'include' })` everywhere.
- **`packages/ui`** (`@aperture/ui`) — shared React components (MoviePoster, StarRating, BaseCarousel, RankBadge, StatusCard, TrailerModal, `getProxiedImageUrl`). Web aliases it to `src/` for hot reload, but typecheck/build use `dist/`.
- **`db/migrations/`** — 121 numbered SQL files (`0001`–`0121`). Postgres + pgvector.

## Commands

```
pnpm dev                # api + web concurrently (kills stale 3456/3457 first)
pnpm build              # pnpm -r build (topo order)
pnpm typecheck          # builds packages/* FIRST, then pnpm -r typecheck
pnpm lint / validate    # eslint --max-warnings 0 / lint + typecheck
pnpm db:migrate|db:status
pnpm --filter @aperture/web i18n:sync   # propagate new en strings to 14 locales
```

**Critical:** apps consume the compiled `dist/` of core/ui. After adding/changing any export in `packages/core` or `packages/ui`, run `pnpm --filter "./packages/*" build` or app typecheck fails with TS2305/TS2307.

## Database

- Pool + helpers: `packages/core/src/lib/db.ts` (`query`, `queryOne`, `transaction`). Env: `packages/core/src/config/env.ts` (`DATABASE_URL` required; `@db:`→`@localhost:` rewrite unless `DOCKER_ENV`).
- Migrations: add next-numbered `NNNN_name.sql` to `db/migrations/`. Applied at API startup (`RUN_MIGRATIONS_ON_START`) via `packages/core/src/migrations.ts`, or manually via `scripts/migrate.mjs` — **two runners, duplicated logic, both track `aperture_migrations`**; keep behavior in sync if touching either.
- Key tables: `movies`, `series`, `episodes`, `watch_history` (+ `playback_progress`), `users`, `sessions`, `user_settings`/`user_preferences`/`user_ratings`, `user_watching_series`, `user_taste_profiles` (+ franchise/genre/interest tables), `recommendation_runs/candidates/evidence`, `recommendation_config`, embedding tables (per-dimension, e.g. 1536/3072/4096 — resolve via `getActiveEmbeddingTableName` in `core/src/lib/ai-provider.ts`), `discovery_pool/candidates/requests`, `gap_analysis_runs/results`, `channels`, `graph_playlists`, `strm_libraries`, `library_config`, `top_picks_config`, `job_config`/`job_runs`, `system_settings`, `api_errors`, `api_keys`, `assistant_conversations/…`, caches (`tmdb_collection_cache`, `tmdb_poster_cache`, `justwatch_chart_cache`, `person_tmdb_profile_cache`, `person_media_server_cache`, `similarity_validation_cache`).
- ALL integration config (media server, TMDB key, Trakt, Seerr, MDBList, AI providers, output paths…) lives in `system_settings`, accessed through `packages/core/src/settings/systemSettings.ts` and `core/src/lib/ai-provider.ts` — never read env directly for these.

## Feature → files cross-reference

| Feature | Web (`apps/web/src`) | API (`apps/api/src/routes`) | Core (`packages/core/src`) | Main tables |
|---|---|---|---|---|
| Auth / sessions / prefs | `hooks/AuthProvider.tsx`, `pages/Login.tsx` | `auth/`, plugin `plugins/auth.ts` | `settings/`, `apiKeys.ts` | `users`, `sessions`, `api_keys` |
| Setup wizard | `pages/setup/` | `setup/` (public; uses `x-internal-request` admin bypass) | many (config setters) | `setup_progress`, `system_settings` |
| Dashboard | `pages/dashboard/` | `dashboard/` (pure SQL, no core imports) | — | aggregates |
| Movies / Series library | `pages/Movies|Series.tsx`, `pages/media-detail/` | `movies/`, `series/` | `media/` (Emby/Jellyfin providers), `tmdb/` | `movies`, `series`, `episodes` |
| Browse (filters/people) | `pages/Browse.tsx`, `pages/browse/` | `movies/handlers/filters.ts`, `series/…`, `discover/` | `discover/peopleBrowse.ts` | `movies`, `series` |
| Recommendations | `pages/MyRecommendations.tsx` | `recommendations/` | `recommender/` (movies/, series/, shared/) | `recommendation_*`, embedding tables |
| Similarity / Explore graph | `pages/explore/`, `components/SimilarityGraph/`, `components/GraphExplorer/` | `similarity/` | `similarity/` (index, reasons, diverse) | embedding tables, `similarity_validation_cache` |
| Graph playlists | `pages/playlists/` (GraphPlaylist*) | `graphPlaylists/` | `graphPlaylists/` | `graph_playlists` |
| Playlists/Channels/Collections | `pages/playlists/`, `pages/collections/` | `channels/` | `channels/` (media-type aware: `channels.media_types` + `example_movie_ids`/`example_series_ids`; `build.ts` = the one item-list builder shared by both writers and `/preview`; `webExpand.ts` resolves web picks against `movies`/`series`) | `channels` |
| Top Picks | `pages/top-picks/`, admin: `pages/settings/topPicks/` | `top-picks/`, also `settings/handlers/topPicks.ts` + `setup/handlers/topPicks.ts` | `topPicks/` | `top_picks_config` |
| Watching ("Shows You Watch") | `pages/watching/`, `hooks/WatchingContext.tsx` (localStorage cache v5) | `watching/` | `watching/` (upcomingEpisodes, tmdbTotals, favoriteSync) via `@aperture/core/watching` | `user_watching_series`, `series.tmdb_total_*`/`tmdb_status` |
| Watch history / stats | `pages/MyWatchHistory.tsx`, `pages/WatchStats.tsx`, `pages/watch-history/` | `users/handlers/profile/watchHistory*.ts`, `watchStats.ts` | `recommender/*/sync.ts` (history sync) | `watch_history` |
| Ratings (hearts) | `hooks/UserRatingsProvider.tsx` | `ratings/` | `trakt/` (push) | `user_ratings`, `watch_history` |
| Discovery (missing content → Seerr) | `pages/discovery/` | `discovery/`, `seerr/` | `discover/` (pipeline, sources, filter, scorer), `seerr/`, `justwatch/` | `discovery_*` |
| Person/Studio pages | `pages/PersonDetail.tsx`, `pages/StudioDetail.tsx` | `discover/` | `discover/person*`, `tmdb/person.ts`, `enrichment/studioLogos.ts` | person caches, `studios_networks` |
| Gap analysis (collections) | `pages/admin/GapAnalysisPage.tsx` | `gap-analysis/` (calls jobs executor directly) | `gap-analysis/`, `tmdb/collections.ts` | `gap_analysis_*`, `tmdb_collection_cache` |
| Assistant (AI chat) | `components/assistant/`, `pages/assistant/`, `components/AssistantModal.tsx` | `assistant/` (handlers, tools, prompts, schemas) | `lib/ai-provider.ts` | `assistant_*` |
| Search (global/semantic) | `components/GlobalSearch.tsx`, `pages/Search.tsx` | `search/` | `similarity/` (semanticSearch) | embedding tables |
| Jobs (admin console) | `pages/jobs/`, `components/RunningJobsWidget.tsx` | `jobs/` (definitions, executor, state, handlers), `lib/scheduler.ts` | `jobs/` (progress, jobConfig) | `job_config`, `job_runs` |
| Admin settings | `pages/settings/` (~40 section components) | `settings/` (16 handler modules) | `settings/systemSettings.ts`, `lib/recommendationConfig.ts` etc. | `system_settings`, `recommendation_config` |
| User settings | `pages/UserSettings.tsx` + `pages/UserSettings/` | `settings/handlers/userSettings.ts`, `users/handlers/profile/` | `lib/userSettings.ts`, `lib/userAlgorithmSettings.ts`, `taste-profile/` | `user_settings`, `user_taste_profiles` |
| STRM / library output | (admin settings sections) | via jobs | `strm/` (StrmWriter, movies/, series/, poster overlays) | `strm_libraries` |
| Enrichment (TMDB/OMDb/MDBList metadata) | `pages/jobs/hooks/useEnrichmentStatus.ts` | `jobs/handlers/enrichment.ts` | `enrichment/`, `omdb/`, `mdblist/enrichment.ts` | `enrichment_runs`, fields on `movies`/`series` |
| Trakt | `pages/UserSettings/…TraktIntegrationCard` | `trakt/` (exports `syncAllTraktRatings` used by executor) | `trakt/` | `system_settings`, user tokens |
| Backup/restore | `pages/settings/…BackupSection` | `backup/` (+ no-auth setup variants) | `backup/` (pg_dump/restore) | `backup_config` |
| Images / proxy | `components/ImageUpload.tsx`; posters via `getProxiedImageUrl` | `images/`, `media-proxy/` | `uploads/` | `media_images` |
| API errors | `components/ApiErrorAlert.tsx` | `apiErrors/` | `errors/` (cross-cutting sink for all integration clients) | `api_errors` |
| Favorites | media-detail components | `favorites/` | `favorites/` | media-server side |
| i18n | `src/i18n/` (see below) | `i18n/` (runtime overrides from `/config/i18n`) | `lib/locales.ts` | — |
| Maintenance (posters) | `pages/settings/…PosterRepairSection` | `maintenance/` | `maintenance/posterRepair.ts` | — |

## Naming traps (easy to edit the wrong module)

- **`discover/` vs `discovery/`** (both in api routes and mirrored in web/core): `discover` = browse people/studios + TMDB-external detail (`/api/discover/*`); `discovery` = missing-content suggestion engine feeding Seerr requests (`/api/discovery/*`). There is also `assistant/discovery/` (web-grounded chat candidates) — unrelated. Its web grounding is **multi-source** via `assistant/discovery/sources/` (a `WebSearchSource` registry): Google grounding (Gemini `google_search`) + Tavily (core `lib/tavily.ts`, config in `system_settings.tavily_integration`, `/api/settings/tavily`). Sources compose (combined into one structuring pass) and fall back for one another; Tavily errors log under the `tavily` provider in `api_errors`.
- **Assistant tool results are post-processed**: `assistant/helpers/unwatched.ts` wraps every tool (`withUnwatchedFilter`, on when the request carries `x-exclude-watched` from the composer's "unwatched only" checkbox) and strips watched items out of any `items`/`carousels[].items` it finds. Tools that report on what the user *has* watched are listed in `EXEMPT_TOOLS` — add new ones there or they'll come back empty.
- **Assistant chat status line**: the whole turn runs inside `createUIMessageStream`'s `execute` in `assistant/handlers/chat.ts` so each phase can emit a transient `data-status` part (`assistant/helpers/status.ts`). `withStatusEvents` is a **third** cross-cutting tool wrapper alongside `withUnwatchedFilter`/`withToolErrorHandling` — a new tool needs a `TOOL_PHASES` entry or it reports the generic "Working on it…". Phase names are i18n key fragments resolved as `assistant.status.<phase>`, never English. `discoveryScouting`/`broadening` cover web-facing work and their wording must stay ambiguous about that. Client side: assistant-ui renders `data-*` parts as `null`, so they're caught in `useChatRuntime({ onData })` and passed via the `assistantStatus.ts` module store to `Thread.tsx`'s `LoadingIndicator`. Note `toUIMessageStream` needs `sendStart: false` (a second `start` opens a second assistant message) **and** its own `onError`, or mid-stream provider failures lose the coded `AI_ERROR:` text.
- **Chat cards remember the request**: `assistant/helpers/requestContext.ts` (`withRequestContext`, the **fourth** cross-cutting tool wrapper, applied outermost in `chat.ts` so it stamps the finished result) copies `latestUserText` onto every `items`/`carousels[].items` container as `request`. It rides along in the persisted `tool_invocations`, so it survives a conversation reload. Its consumer is the chat's "create playlist from these" dialog, which posts `chatContext: { request, reasons }` to `/api/graph-playlists/ai-name|ai-description`; that switches core's `PlaylistTextMode` to `'chat'` (`lib/ai-playlist-generation.ts`), whose prompts treat the request as the brief. The field is optional end-to-end — the Explore-graph `CreatePlaylistDialog` posts without it and stays in `'graph'` mode, which claims the playlist came from a similarity exploration.
- **Channel generation is two-phase**: the web refresh button calls `POST /api/channels/:id/preview` (builds the list, writes nothing), then `POST /api/channels/:id/generate` with `{ itemIds }` — that body makes the writers skip generation and push exactly the approved set (`ChannelUpdateOptions.itemIds`). A bodyless `generate` still generates-and-pushes, which is what the scheduler path (`processAllChannels`) does. **`preview` is not cheap**: besides `buildChannelItems` it runs `generateChannelPickReasons` (core `channels/reasons.ts`) — one text-generation call per 8 non-seed picks — to write the "why this is here" note on each preview card. Fails open (no writing model → no notes, never an error), and seeds are excluded by design.
- **A channel's description is media-server metadata, not just a DB column**: it ships as the playlist/collection Overview. `updateChannelPlaylist`/`updateChannelCollection` pass it on every generate, and `syncChannelDescription` (core `channels/describe.ts`, called from `PUT /api/channels/:id`) pushes it alone when the text is edited and saved — editing a description must never re-write the item list. An empty description leaves the server's existing overview alone rather than blanking it. Renaming a channel still orphans the old Box Set/playlist, since lookup is by name.
- **One dialog, two i18n namespaces**: `pages/playlists/components/PlaylistDialog.tsx` is the editor for *both* playlists and collections — `pages/collections/` renders it with `i18nNamespace="collections"` and every label goes through `pt(key)`. So a new string must be added to **both** `playlists` and `collections` in `en/translation.json` (the two blocks are near-duplicates that differ only in the words "playlist"/"collection"), or one surface renders a raw key. Its AI sparkle buttons post to `/api/channels/ai-preferences|ai-name|ai-description`; the preferences one takes an optional `userNotes` (what's already in the box) — sent only for "build on what I wrote", omitted for "start fresh" so a re-roll can escape its own last answer.
- **Three "similar" systems**: `movies|series/:id/similar` (simple embedding neighbors) vs `/api/similarity/*` (multi-hop graph for Explore) vs `/api/graph-playlists` (playlists built from that graph).
- **Top Picks config lives in 4 places**: `routes/top-picks/`, `routes/settings/handlers/topPicks.ts`, `routes/setup/handlers/topPicks.ts`, and the `refresh-top-picks`/`auto-request-top-picks` jobs.
- Version strings drift: `routes/api.ts` says `0.1.0`, `routes/health` hardcodes `0.7.8`.

## Jobs system (how background work runs)

1. Job catalog: `apps/api/src/routes/jobs/definitions.ts` (static list; **crons there can drift — DB `job_config` via core `getAllJobConfigs()` is authoritative**).
2. Execution: `apps/api/src/routes/jobs/executor.ts` — one `switch` mapping job name → core function. Adding a job = core function + executor case + definitions entry (+ default `job_config` row if scheduled).
3. Scheduling: `apps/api/src/lib/scheduler.ts` (node-cron; executor injected via `setJobExecutor` in `routes/jobs/index.ts`, which also guards against double-runs).
4. Progress: in-memory + SSE, lives in **core** `jobs/progress.ts` (`withProgress`, `subscribeToJob`); run history in `job_runs`.
5. Shared mutable state: `routes/jobs/state.ts` `activeJobs` Map is also imported by `gap-analysis` and setup, which call `runJob` directly (bypassing jobs HTTP routes).

## Recommender / embeddings pipeline (order matters)

sync-users → sync-movies/series (media server → DB) → enrichment (TMDB/OMDb fields onto rows) → generate embeddings (`buildCanonicalText` — **includes enriched fields; changing enrichment output means re-embedding**) → generate recommendations (taste vector → pgvector candidates → score: similarity/novelty/rating + taste-profile boosts → diversity selection → AI explanations → `recommendation_*` tables) → outputs (STRM libraries, channels, playlists, collections).

Embedding tables are shared consumers: recommender, `/api/similarity` graph, semantic search, discovery scoring, taste-profile interests. Movies and series are **parallel pipelines** (`recommender/movies/` vs `recommender/series/`) — a fix in one usually needs mirroring in the other. Same for `media/emby/` vs `media/jellyfin/`.

## Auth model

`plugins/auth.ts`: `x-api-key` header (takes precedence) or `aperture_session` cookie (30-day DB session). `requireAuth`/`requireAdmin`; **`requireAdmin` is bypassed by `x-internal-request: true`** (setup wizard's internal `fastify.inject` calls). API-key users are forced `provider:'emby'`, `collectionsEnabled:false`.

## Web conventions

- Provider tree (App.tsx): `I18nextProvider > RtlProviders > BrowserRouter > SetupProvider > AuthProvider`; authed pages additionally get `ViewModeProvider > UserRatingsProvider > WatchingProvider > AssistantDockProvider` + floating `AssistantModal`.
- Route table lives in `apps/web/src/App.tsx`; shell is `components/Layout.tsx` (sidebar items feature-gated by watching/collections flags).
- Hooks pattern: `XProvider.tsx` + `x-context.ts` + `useX.ts` triplets in `src/hooks/`.
- **New UI string**: add to `src/i18n/locales/en/translation.json` (en is source of truth), use `t('ns.key')`, then `pnpm i18n:sync` to stamp placeholders into the other 14 locales. RTL locales: ar, he — use logical CSS properties. Server error strings: wrap with `lib/withServerMessageDetail.ts`. Authoritative guide: `src/i18n/CONVENTIONS.md`.
- Client caches to remember when changing API shapes: `WatchingContext` (localStorage, versioned — bump version on shape change), `ViewModeProvider` (localStorage + server prefs).
- **Breakpoints lie inside the main pane**: MUI breakpoints are *window* media queries, but `Layout.tsx` shrinks `<main>` with `marginInlineEnd: dockWidth` when the assistant is docked, and `MediaDetailModal` renders a whole page inside a dialog. A grid keyed on `md`/`lg` therefore keeps its full-desktop column count in a half-width pane (this is what shrank Related Movies to ~110px posters). Size in-pane grids off their container — `gridTemplateColumns: 'repeat(auto-fill, minmax(Npx, 1fr))'`, or MUI 6's `theme.containerQueries` — rather than subtracting `dockWidth` from a breakpoint, which still gets the dialog case wrong.
- **Assistant surfaces**: three containers share `AssistantChatSurface` — the dock (Fab default, md+), the dialog (opt-in via the header toggle, and the fallback below md), and the `/assistant` page. Only the page renders the conversation list inline (`sidebarInline`); the floating pair use the history drawer. The header's expand button routes to `/assistant` carrying `{ conversationId }` in the route state, which `useAssistantChat(active, initialConversationId)` seeds — without it the page would resume whichever conversation was updated last.
- **Item detail in a dialog**: `components/MediaDetailModal.tsx` renders the *route page* `pages/media-detail` (which now takes optional `id`/`onBack`/`onOpenMedia` instead of only reading `useParams`), hosted by `hooks/MediaDetailModalProvider`. Chat cards call `useMediaDetailModal()`; a **null** opener means "no host mounted, navigate instead" — that's how the docked assistant keeps routing the main pane while the /assistant page and the floating dialog open in place (`AssistantChatSurface` prop `openMediaInModal`). Related titles / insight evidence inside the dialog swap the target rather than route, or they'd move the page under the dialog. `MediaBackdrop`'s `mx/mt: -3` is why the dialog content keeps `p: 3`.

## When you touch X, check Y

- **New/changed core or ui export** → rebuild packages before typecheck; check `packages/core/src/index.ts` barrel (exports won't resolve until added there or to a subpath export in core `package.json`).
- **Schema change** → new `db/migrations/NNNN_*.sql`; check both migration runners; grep for the table name across core (raw SQL is duplicated in many modules).
- **Enrichment fields** → re-embedding may be required (canonical text), similarity `reasons.ts`, gap analysis, top picks all read enriched columns.
- **Series/watching changes** → `watching/tmdbTotals.ts` caches TMDB totals on `series` rows (`tmdb_total_episodes/seasons`, `tmdb_status`); Watching page, upcoming episodes, and MyWatchHistory grids all read them.
- **Media-server calls** → implement in BOTH `media/emby/` and `media/jellyfin/`; interface is `media/MediaServerProvider.ts`.
- **Movie-side recommender/sync fix** → check the series mirror (and vice versa).
- **Renaming/removing an API route** → grep `apps/web/src` for the literal `/api/...` string (no typed client to catch it).
- **Integration client changes** (tmdb/omdb/trakt/mdblist/seerr/justwatch) → they log to `errors/` (`api_errors`) and often have DB caches with TTLs; check retry gating (`shouldAutoRetry`).
- **Job behavior** → schedule comes from DB `job_config`, not `definitions.ts`; progress API is in core.

## Workflow notes

- Work happens directly on `dev` (no feature branches). `main` is a stale upstream mirror; `.github/workflows/sync-dev.yml` force-resets `dev` to `main` on pushes to `main`. Pushing to `origin/dev` triggers the Docker build — don't push without being asked.
- Docker: `docker/Dockerfile` (4-stage; copies built dists + `db/`); compose variants per platform (dev/prod/external-db/windows/unraid/synology/qnap). Runtime data in `data/` (gitignored except `.gitkeep`s); operator i18n overrides mount at `/config/i18n`.
- Docs for humans live in `docs/` (admin guides, feature docs, screenshots).
