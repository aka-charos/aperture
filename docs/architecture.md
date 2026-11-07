# Architecture

A technical overview of how Aperture is put together: the packages, the pipeline that turns a library into recommendations, and where each feature lives. For the full file-by-file map, the rules that hold across the codebase and the reasons behind them, read [`CLAUDE.md`](../CLAUDE.md) and [the forensics log](aperture-forensics.md).

## Table of Contents

- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [The Pipeline](#the-pipeline)
- [Embeddings and Similarity](#embeddings-and-similarity)
- [Recommendations](#recommendations)
- [What Each Viewer Sees](#what-each-viewer-sees)
- [The AI Assistant](#the-ai-assistant)
- [Other Features](#other-features)
- [Background Jobs](#background-jobs)
- [Database](#database)

---

## Project Structure

A pnpm monorepo, ESM throughout, with no ORM (raw SQL through `pg`):

```
aperture/
├── apps/
│   ├── api/          # Fastify HTTP layer (port 3456): routing, auth, job orchestration
│   │   └── src/
│   │       ├── plugins/auth.ts   # Sessions, API keys, "view as user"
│   │       ├── lib/              # Permissions, viewer scope, scheduler, shared helpers
│   │       └── routes/           # One folder per area (assistant/, jobs/, settings/, …)
│   └── web/          # Vite + React 18 SPA (dev port 3457), MUI 6, react-router 7, i18next
│       └── src/
│           ├── pages/            # One folder or file per screen; pages/admin/ is the console
│           ├── components/       # Shared components (assistant/, tour/, docs/, …)
│           ├── hooks/            # Providers and their hooks
│           └── i18n/             # 14 locales, English the source
├── packages/
│   ├── core/         # All domain logic (@aperture/core), compiled to dist/
│   │   └── src/
│   │       ├── recommender/      # movies/, series/ (parallel pipelines), shared/
│   │       ├── taste-profile/    # Taste vectors, clusters, genre preference
│   │       ├── media/            # Emby and Jellyfin providers behind one interface
│   │       ├── enrichment/       # TMDb, OMDb, MDBList metadata and studio logos
│   │       ├── ratings/          # Ratings refresh and the unified quality rating
│   │       ├── analysis/         # Title analysis: retrieval, prompts, bench, offsite
│   │       ├── translation/      # Synopsis and analysis translation
│   │       ├── nextFromHere/     # Next from here
│   │       ├── trails/           # The credits index Next from here reads
│   │       ├── homeSections/     # Emby home screen rows
│   │       ├── social/           # Connections and Watch This
│   │       ├── notifications/    # Per-event notifications (email and the Android app)
│   │       ├── newsletter/       # Newsletters and send groups
│   │       ├── email/            # SMTP transport and the email template
│   │       ├── discover/         # Discovery pipeline (missing content for Seerr)
│   │       ├── seerr/            # Seerr requests and issues
│   │       ├── onboarding/       # Tour, checklist and tip state
│   │       ├── strm/             # Legacy STRM/symlink library output
│   │       ├── jobs/             # Progress, run history, schedule config
│   │       └── settings/         # system_settings access
│   └── ui/           # Shared React components (@aperture/ui): posters, carousels, badges
├── db/migrations/    # Numbered SQL migrations, applied at startup
├── docker/           # Dockerfile (4-stage)
└── scripts/          # Migration runner, probes, dev tooling
```

The apps consume the compiled `dist/` of `core` and `ui`, so a change to an export there needs a package build before the apps typecheck. The web bundle never imports `@aperture/core`: anything the browser needs to know is decided on the server and sent in the response.

The first download is only the app shell: each page is its own chunk, loaded when opened, and every language but English is fetched when chosen. The build pre-compresses the bundle (Brotli and gzip) and the API serves those files directly, with no compression layer over its own responses. Files under `/assets/` are named after their content, so they are cached for a year.

---

## Tech Stack

- **Backend**: Fastify, TypeScript, PostgreSQL with pgvector, node-cron
- **Frontend**: React 18, Vite, MUI 6, React Router 7, i18next, d3, recharts, assistant-ui
- **AI**: the AI SDK, with OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Z.AI, Hugging Face, Ollama, LM Studio, Unsloth Studio and any OpenAI-compatible endpoint
- **Integrations**: Emby, Jellyfin, TMDb, OMDb, MDBList, Trakt, Seerr (Jellyseerr/Overseerr), JustWatch, Tavily, fastCRW, n8n, LLDAP, any SMTP server
- **Infrastructure**: Docker, pnpm workspaces, GitHub Actions

All integration settings live in the `system_settings` table and are edited in the admin console; environment variables only describe the deployment.

---

## The Pipeline

The order matters, because each step reads what the step before wrote:

1. **Sync users** from the media server, with the libraries each account may open.
2. **Sync the library** (movies, series, episodes) and **watch history** from the media server.
3. **Enrich** titles with TMDb, OMDb and MDBList metadata; refresh IMDb ratings nightly; compute each title's **unified rating**.
4. **Embed** each title's canonical text (genres, plot, keywords, credits, …) into a vector, then centre the vectors on the library mean.
5. **Build a taste profile** per viewer: a weighted mean of the vectors of what they watched, rated and finished, split into clusters when their taste has distinct parts.
6. **Score candidates** for each viewer (similarity, novelty, quality), apply preference adjustments, fill reserved slots (interests, taste twins, acclaimed titles), and pick a varied list with MMR.
7. **Explain** each pick with an AI-written note built from the pick's data and the viewer's history, reusing a note whose inputs have not changed.
8. **Publish**: in the app, as rows on each viewer's Emby home screen, and (legacy, off by default) as STRM/symlink libraries.

A scheduled run skips viewers whose inputs have not changed (the activity gate); a manual run always runs.

---

## Embeddings and Similarity

Embeddings are stored per model in one table per width (256 to 4096 dimensions), so switching model keeps the old set beside the new one. Movies and series are embedded separately; episodes optionally, for the assistant's episode search. Each movie and series vector also has a mean-centred copy, which taste profiles are built from and candidates are retrieved against. Queries whose other side is a fresh embedding of text (custom interests, semantic search) and the evidence lookup stay on the raw vectors, since nothing centred that text.

Several features read the same vectors: the recommender, similar titles on a detail page, the Explore graph and graph playlists, semantic search, the assistant, discovery scoring and Next from here. A nearest-neighbour query that filters its results afterwards (by library scope, watch status or country) goes through one helper that keeps the index walking until the filter is satisfied.

---

## Recommendations

Movies and series run as two parallel pipelines (`recommender/movies/` and `recommender/series/`) over shared scoring and selection code. Each run is stored with its inputs and outputs, so the insights panel can show, for any scored title, the blend, the weights the run used and the titles in the viewer's history that support it. An optional decision model can judge whether each supporting title is a real reason.

The quality term scores the unified rating: IMDb with Metacritic and Rotten Tomatoes for films, IMDb for series.

---

## What Each Viewer Sees

Every viewer sees only the libraries their media-server account can open and that are enabled in Aperture, within their parental-rating limit. That scope is decided in one place and applied to browse, search, similar titles, the graphs, detail pages, the assistant, recommendations and anything shown from another viewer's activity. A title outside it answers exactly like one that does not exist.

Feature permissions (Discover, requests, Collections, the assistant, email notifications, watch-history management) are decided on the server from the session and sent to the browser as decided values. API keys carry scopes that can narrow, never widen, the account behind them.

---

## The AI Assistant

`apps/api/src/routes/assistant/` holds the chat: handlers, prompts and tools. Each turn is routed as a library question or a discovery question. A discovery turn runs a grounded web search (Google, Tavily and fastCRW together), resolves the results against the library, and adds the viewer's nearest scored titles; a library turn uses tools over the library, the viewer's history and ratings, people, franchises, stored analyses and episodes. Every tool result is limited to the viewer's libraries.

The web side (`apps/web/src/components/assistant/`) renders the stream with assistant-ui in three places: a dock, a dialog and the `/assistant` page. The server saves each turn in `assistant_conversations` and `assistant_messages`, including the order of prose and cards.

---

## Other Features

| Feature | Core module | Notes |
|---------|-------------|-------|
| Title analysis | `analysis/` | Critic-informed articles from fastCRW or Google grounding; bench and offsite batches |
| Synopsis translation | `translation/` | Any OpenAI-compatible endpoint; translations keyed to the text they came from |
| Next from here | `nextFromHere/`, `trails/` | Neighbours plus a credits index, weighed by the viewer's record |
| Emby home rows | `homeSections/` | Tags on the original items, one Emby section per row |
| Connections and Watch This | `social/` | Admin-paired accounts; everything filtered by the reader's scope |
| Notifications | `notifications/` | One reader of what is new, for email and the Android app |
| Newsletters | `newsletter/` | Per-reader copies, sent only to people who opted in |
| Discovery | `discover/`, `seerr/` | Missing content ranked by taste, requests filed as the requester |
| Onboarding | `onboarding/` | Tour, checklist and tips, kept apart from recommendation inputs |

---

## Background Jobs

All background work runs as a named job with live progress, a log, cancellation and run history:

- **Catalog**: `apps/api/src/routes/jobs/definitions.ts` lists the 40 jobs.
- **Execution**: `apps/api/src/routes/jobs/executor.ts` maps each job to its core function.
- **Scheduling**: `apps/api/src/lib/scheduler.ts` (node-cron) reads the `job_config` table, seeded from `JOB_SCHEDULE_DEFAULTS` in core. Schedules are daily, weekly on chosen weekdays, biweekly, every N hours or minutes, or manual.
- **Progress**: in memory and streamed over SSE (core `jobs/progress.ts`); finished runs in `job_runs`.

See [Jobs overview](admin/jobs-overview.md) and [Job scheduling](admin/job-scheduling.md) for what each job does and when it runs.

---

## Database

PostgreSQL with pgvector. Migrations are numbered SQL files in `db/migrations/`, applied at startup (`RUN_MIGRATIONS_ON_START`) or with `pnpm db:migrate`. Key tables:

- `users`, `sessions`, `api_keys`, `impersonation_sessions`, `permission_changes`: accounts, sign-in and audit
- `movies`, `series`, `episodes`: the library, with enriched metadata and the unified rating
- `embeddings_<n>`, `series_embeddings_<n>`, `episode_embeddings_<n>`: vectors per width
- `watch_history`, `user_ratings`, `user_watching_series`: what each viewer watched, rated and follows
- `user_taste_profiles`, `user_preferences`, `user_settings`: taste vectors, the Watcher Identity and settings
- `recommendation_runs`, `recommendation_candidates`, `recommendation_evidence`, `recommendation_config`: recommender runs and configuration
- `title_analysis`, `title_translations`: analyses and their translations
- `discovery_*`, `gap_analysis_*`: discovery and gap analysis
- `channels`, `graph_playlists`: playlists and collections
- `home_sections_*`: Emby home rows
- `user_connections`, `social_recommendations`: connections and Watch This
- `user_notification_preferences`, `app_devices`, `newsletters`, `newsletter_groups`, `newsletter_deliveries`: notifications and newsletters
- `assistant_conversations`, `assistant_messages`: the assistant
- `job_config`, `job_runs`: jobs
- `system_settings`: every integration and instance setting

[`CLAUDE.md`](../CLAUDE.md) lists every table with the feature that owns it.
