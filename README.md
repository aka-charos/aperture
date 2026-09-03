# Aperture

[![Upstream](https://img.shields.io/badge/upstream-v0.7.8-blue.svg)](https://github.com/dgruhin-hrizn/aperture/releases)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Faka--charos%2Faperture%3Adev-blue?logo=docker)](https://github.com/aka-charos/aperture/pkgs/container/aperture)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

**Aperture** — self-hosted AI recommendations, discovery and watch tracking for **Emby** and **Jellyfin**.

Aperture syncs your library and everyone's watch history, embeds every title as a vector, builds a taste profile per user, and writes personalized recommendation libraries back into your media server. Around that core it has grown into a full companion app: an AI chat assistant that can search the web _and_ your shelf, a discovery engine that files requests in Jellyseerr/Overseerr, a similarity graph, playlists and collections, watch statistics, and an admin console for every knob involved.

Works for **movies** and **TV series**, in **15 languages**.

---

## About this fork

This repository ([aka-charos/aperture](https://github.com/aka-charos/aperture)) is a fork of [dgruhin-hrizn/aperture](https://github.com/dgruhin-hrizn/aperture). It tracks upstream **v0.7.8** and has added several hundred commits of features and fixes on top.

- Active development happens on **`dev`**. That is the branch to deploy from.
- `main` is a stale mirror of upstream and exists only to make rebases easy.
- Images are published to **`ghcr.io/aka-charos/aperture:dev`** on every push to `dev`.
- Version identity is two fields, not one string: `APP_VERSION` is the upstream lineage (`0.7.8`), `APP_BUILD` is the fork build (`mod.<commits>.g<sha>`). Both appear in the admin console and in `/api/health`.

**This README is written as a delta.** Upstream's own documentation still describes the base application; what follows concentrates on what is different here — [what the fork changes](#what-this-fork-changes), section by section, with the parts that arrived unchanged gathered under [Inherited from upstream](#inherited-from-upstream). If you are comparing the two projects, the next table and that section are the whole answer.

### At a glance

| Area                | What the fork adds                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI providers**    | Six AI roles (embeddings, chat, text generation, exploration, web search, title analysis), each independently configurable across OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Ollama, LM Studio and any OpenAI-compatible endpoint. Live model catalogs, per-1M-token pricing, tool-calling badges, reasoning-effort control, fallback models and fallback API keys. |
| **Embeddings**      | Model and dimension are a setting, not a constant (768–4096, including 2560). Mean-centred vectors, retrieval-mode selection where the model supports one, a stored-sets panel showing what is embedded and what switching would cost, and an offline evaluation harness with CSV export.                                                                                       |
| **Recommender**     | MMR diversity, taste twins, reserved slots for stated interests and acclaimed titles, era affinity, availability-adjusted genre preference, taste clustering, an activity gate that skips pointless regenerations, and an insights panel showing the actual arithmetic behind every match score.                                                                                |
| **Assistant**       | Intent-routed chat: library questions query your shelf, discovery questions run a grounded web search and resolve results against it. Dockable panel, dedicated page, streaming phase status, conversation history, rich cards, and "build a playlist from these picks".                                                                                                        |
| **Discovery**       | Missing-content engine that scores candidates against your taste and files requests in Jellyseerr/Overseerr, plus a per-title critic-informed analysis writer backed by self-hosted search (fastCRW) or Google grounding.                                                                                                                                                       |
| **Admin console**   | Rebuilt as a two-level nav generated from one registry — 8 groups, 40+ sections, a ⌘⇧K search palette that indexes sections, individual settings _and_ every job, plus per-section preconditions.                                                                                                                                                                               |
| **Branding & i18n** | Rename the instance, mount your own logo and favicon, set brand colours, edit any UI string in-app or via CSV, restrict which languages users may pick — all without rebuilding the image.                                                                                                                                                                                      |
| **Security & ops**  | Deployment-posture panel with live evidence, runtime-editable trusted proxies, session hardening, per-account login lockout, API keys, admin "view as user" (read-only), and a job system with cancellation, editable multi-day schedules and log windowing.                                                                                                                    |

---

## Quick start

### 1. Download the compose file for your platform

| Platform              | File                             | Download                                                                                             |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Unraid**            | `docker-compose.unraid.yml`      | [Download](https://raw.githubusercontent.com/aka-charos/aperture/dev/docker-compose.unraid.yml)      |
| **QNAP**              | `docker-compose.qnap.yml`        | [Download](https://raw.githubusercontent.com/aka-charos/aperture/dev/docker-compose.qnap.yml)        |
| **Synology**          | `docker-compose.synology.yml`    | [Download](https://raw.githubusercontent.com/aka-charos/aperture/dev/docker-compose.synology.yml)    |
| **Windows**           | `docker-compose.windows.yml`     | [Download](https://raw.githubusercontent.com/aka-charos/aperture/dev/docker-compose.windows.yml) ¹   |
| **Linux / other**     | `docker-compose.prod.yml`        | [Download](https://raw.githubusercontent.com/aka-charos/aperture/dev/docker-compose.prod.yml)        |
| **External Postgres** | `docker-compose.external-db.yml` | [Download](https://raw.githubusercontent.com/aka-charos/aperture/dev/docker-compose.external-db.yml) |

> ¹ Docker Desktop with Emby/Jellyfin running natively on Windows needs extra path mapping — see the [Windows guide](docs/admin/windows-docker-desktop.md).

### 2. Point it at this fork's image

The compose files still carry upstream's image line. Change it:

```yaml
services:
  app:
    image: ghcr.io/aka-charos/aperture:dev # was ghcr.io/dgruhin-hrizn/aperture:latest
```

### 3. Configure

Edit the compose file and set:

- `APP_BASE_URL` — how you reach the app, e.g. `http://192.168.1.100:3456`
- `SESSION_SECRET` — a random string, 32+ characters
- `TZ` — your IANA timezone; job schedules run in it
- Volume paths — the libraries output folder, the backups folder, and your media share (read-only)

### 4. Create the folders

```bash
mkdir -p /mnt/user/Media/ApertureLibraries
mkdir -p /mnt/user/appdata/aperture/backups
```

Put `ApertureLibraries` **inside** the media share your server already has mounted, and Emby/Jellyfin will see it with no extra configuration.

### 5. Start

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 6. Run the setup wizard

Open `http://YOUR_SERVER_IP:3456`. First-run setup is refused from non-local addresses until it completes, so nobody who finds the port before you can claim the admin account.

1. **Restore** (optional) — restore from a backup if you are migrating
2. **Media server** — connect Emby or Jellyfin
3. **Source libraries** — pick which libraries to analyse
4. **File locations** — path mappings for symlinks / STRM
5. **AI recommendations** — library naming and cover images
6. **Validate** — verify the output paths are writable and visible to your server
7. **Users** — choose who receives recommendations
8. **Top Picks** (optional) — global trending libraries
9. **AI / LLM** — configure the AI roles you want
10. **Initial jobs** — first sync, with live progress
11. **Complete** — summary and next steps

Then sign in with your Emby/Jellyfin credentials.

### Updating

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Migrations run at startup (`RUN_MIGRATIONS_ON_START`), so an update is pull-and-restart.

---

## What this fork changes

Everything in this section is fork work on top of upstream v0.7.8. Where a heading names something upstream already had, the text describes what is now different about it; the parts that arrived unchanged are listed separately under [Inherited from upstream](#inherited-from-upstream).

### AI providers and models — rebuilt

Upstream took one OpenAI key and used one model for everything.

- **Six independent roles** — embeddings, chat, text generation, exploration, web search, title analysis — each with its own provider, model, key and options.
- **Nine provider families**: OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Ollama, LM Studio / any OpenAI-compatible endpoint, Hugging Face. Local servers are probed for what they actually have installed rather than assumed.
- **Live model catalogs** with per-1M-token pricing, tool-calling and reasoning badges; retired models drop out on their own.
- **Reasoning effort** per role, offered in each model's own vocabulary rather than an invented one, because a reasoning model bills its scratchpad from the same output allowance as the answer.
- **Fallback models and fallback API keys** for free-tier work, with call pacing and per-key cooldowns — a spare key answers "this account is out of quota", a spare model answers "this model is gone".
- **Spend dashboard** measuring what OpenRouter actually charged. Unpriced calls are reported as unknown, never as $0.
- Sibling key resolution: configure a provider once and every role on that provider reuses it.

### Embeddings — model, width and vector space are settings now

- **Model and dimension are configurable** (768 through 4096, including 2560), each width in its own table, so switching starts a new set beside the old one instead of destroying it. Switch back and the old set is still there.
- **Stored-sets panel** showing every set, its coverage, its dates and exactly what switching would cost — re-embed → re-centre → rebuild taste profiles → regenerate.
- **Mean-centred vectors**: subtracting what every title in the library has in common measurably improved retrieval, and centring runs at the end of each embedding job rather than being a chore to remember.
- **Retrieval mode** offered only for models that document how to carry one, delivered as a request parameter or a text prefix depending on the model.
- **Canonical text reworked** — six of fifteen fields were nationality-coded, so the vector partly worked as a nationality detector; content rating, awards and composers came out, and OMDb's longer plot came in.
- **Episode-level embeddings** (optional) power episode search in the assistant.
- **Offline evaluation harness** (`evaluate-recommender`) so a retrieval change can be measured instead of argued about: held-out ranking against random and rating-only baselines, nearest-neighbour dumps raw and centred side by side, every stored set measured, results archived and exported as CSV.

### Recommender — how a pick is chosen, and why

- **MMR diversity** replaces the old genre-coverage sort, which let one Drama close Drama for the rest of the list.
- **Reserved slots** for things the ranking will never reach on its own: **stated interests**, **taste twins** (the viewer whose history overlaps yours far more than chance), and **acclaimed titles**. Every slot count is admin-visible; there are no hidden shares underneath.
- **Taste clustering** — a profile splits into up to three clusters, so a viewer with two distinct tastes is not averaged into one vector that matches neither.
- **Era affinity** — decade preference measured against the viewer's own shelf.
- **Genre preference is availability-adjusted**, not volume-based: someone who hides the horror library no longer reads as horror-averse.
- **Engagement weighting** by how much of a series was actually finished, so forty abandoned shows stop outvoting five finished ones.
- **Disliked titles weigh zero** instead of being scaled onto a curve that peaked at 5/10.
- **Activity gate** — a scheduled run skips users whose library and history have not changed enough to move a pick; a manual run always runs.
- **Match insights on every scored title**, not just the twenty that were picked: blended score, preference adjustment, per-term weight shares, variety, and the titles in your own history that support the pick — with a different, honest heading when the pick came from a reserved slot and the ranking is not the reason.
- **Explanations** are written from real data (plot, keywords, directors, neighbours in your history) under a no-invention rule, survive a truncated response instead of replacing all ten with a template, and can be re-run on their own without re-scoring.
- **Admin controls** for preference strength, gate thresholds, slot budgets and candidate pool size, with the pool bounded by the number of items that actually exist.

### AI assistant — new

- Chat that **routes each turn**: library questions search your shelf, discovery questions run a grounded web search and resolve the results back against your library by IMDb ID → TMDB ID → title + year.
- Available as a **dockable side panel**, a **dialog**, or the full **`/assistant`** page, with conversation history that survives a reload and renders in the order it was written.
- **Live phase status** ("searching the web", "checking your library") in place of a static spinner, and cards that stream in rather than waiting for the slow part.
- Tools for semantic search, filtered search, watch history, ratings, similar titles, person lookups, episode search, and your own recommendation run — including a library-scoped personalized search over the pool the recommender already scored.
- **National cinema is searchable** (country, not language — languages are populated for under 1% of a real library), with ~120 demonyms mapped to the stored country names.
- Rich cards with synopsis, grounded reason, director, favourite and watched state; open a title in place without leaving the conversation.
- **Build a playlist or collection from chat picks**, carrying the request that produced them.
- Optional **unwatched-only** mode, and suggestion chips drawn from your newest completed run.

### Discovery, web search and title analysis — new

- **Discovery engine** — finds content you do _not_ own, scores it against your taste clusters, and files requests through **Jellyseerr / Overseerr**.
- **Grounded web search** as its own AI role, with Google grounding plus **Tavily** as a second source; sources compose and fall back for one another, and free-tier grounding quota is metered per key with automatic rotation.
- The taste brief personalises **which candidates win, never which searches run** — the profile is structurally unable to reach a search call.
- **Title analysis** — an optional critic-informed account of what a film or show actually is, retrieved from the open web through self-hosted **fastCRW** search or Google grounding, cached per title and shared by every user.
- **Gap analysis** — incomplete TMDB collections in your library, with what is missing.
- **Missing episodes and seasons** surfaced on series pages with per-season requests.

### Watch statistics — every number opens

- Genres (film and TV), decades, ratings, people, studios, networks, a time-of-day heatmap, a rewatch breakdown, TV vs film time, and a "your taste vs the crowd" comparison.
- **Every figure on the page opens the titles behind it**, counted with the same SQL that produced the number, so a "7 films" chip cannot open five.
- **Watcher identity** — a natural-language description of what your viewing says about you.

### Browse, detail pages and the rest of the UI

- **Production-country filter** with search, multi-select and AND/OR matching, plus a searchable network filter and reordered content ratings.
- **Detail pages say each thing once** — ratings and awards on the hero line, director and writer beside them, one info card below; the duplicate genre, critic-rating and awards panels are gone.
- **Series detail** with per-season and per-episode progress and inline episode descriptions.
- **Person and studio pages** with biography and birth/death data.
- **Shows You Watch** — a segmented bar combining progress, availability and what is missing, plus Airing/Ended tabs driven by TMDB status rather than a stale server field.
- **Watch history** searches the whole history rather than the loaded page, with status filters and real resume bars.
- **Channels build collections and playlists from TV series too**, with a preview-and-approve step and an AI note on each pick before anything is written.
- **Cross-media connections** in the Explore graph — films to series and back — which was previously a toggle that could never match anything.
- **Collapsible sidebar** with a hover flyout, page titles in the app bar instead of 80px of repeated heading, a welcome guide that snoozes instead of nagging, and a resizable assistant dock.

### Admin console — rebuilt

- Generated from **one registry**: 8 groups, 40+ sections, with the route table, the nav and the search index all derived from the same data, so a section cannot exist in one and not the others.
- **⌘⇧K search palette** indexing sections, ~33 individual settings _and_ all 33 jobs, scored per word so "novelty weight" finds the slider even though neither word is its label.
- **Per-section preconditions** shown as a dimmed row with a reason, rather than an unclickable tab.
- An error boundary per section, so one broken panel cannot take the console down with it.

It lives at **`/admin`**, reached from the app bar:

| Group               | Covers                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**        | Version, build, health, quick status                                                                                                |
| **Library**         | Media server, source libraries, file locations, gap analysis                                                                        |
| **Integrations**    | TMDB, OMDb, MDBList, Trakt, Seerr, LLDAP, n8n, Tavily, fastCRW, JustWatch streaming, ratings refresh                                |
| **AI**              | Role configuration, spend dashboard, cost estimator, embeddings                                                                     |
| **Recommendations** | Algorithm tuning, evaluation, explanations, output format, library naming, Top Picks, watching, genre strips, channel web expansion |
| **Appearance**      | Instance branding, theme colours, poster display, language defaults, translations editor                                            |
| **Access**          | Users, API keys, deployment posture                                                                                                 |
| **Ops**             | Jobs, backup, poster repair, logs, database                                                                                         |

### Branding, languages and text

- **Rename the instance** — the name reaches all 15 locales and the browser tab from the first byte.
- **Mount your own logo and favicon** (`BRANDING_DIR`) and set the two brand colours from the UI.
- **Edit any UI string** in the app or via CSV round-trip, or drop `overrides.<lng>.json` into `I18N_OVERRIDES_DIR` to customize text without rebuilding the image.
- **Language allowlists** — choose which UI and AI languages users may pick, and the default for each.
- **Greek (el) added**, bringing the locale count to 15; ar and he render right-to-left.
- **Configurable media-server display name** used throughout the UI, and a separate public URL for user-facing media-server links.

### Security, access and deployment

- **An HTTP header no longer grants admin access.**
- **Admin "view as user"** — see the app exactly as another user sees it, read-only, on a one-hour lease, with a persistent banner and an exit that is always on screen. The admin's own session is never swapped out.
- **Deployment posture panel** that checks configuration _against live traffic_: an instance behind a tunnel with no trusted proxy looks perfectly healthy from config alone, so it watches for forwarded headers it is not trusting.
- **Trusted proxies editable at runtime**, applied without a restart.
- Session hardening (30-day absolute lifetime, 7-day idle timeout, immediate revocation on disable), per-account login lockout alongside the IP rate limit, and a cleanup job for both.
- **Optional LLDAP email import**, with email, login and activity shown on Admin → Users.
- Search engines told to stay away from the instance.

### Jobs and operations

- **Editable schedules** — daily, weekly on as many weekdays as you like, biweekly, every N hours or minutes, or manual — with the next run date shown from the same resolver the scheduler uses.
- **Cancellation that works**: a cancelled job holds its slot until it actually stops, and a refused start says why instead of silently doing nothing.
- **Log windowing** that keeps the head as well as the tail, and says how many entries were actually lost.
- **API error tracking**, poll-log quieting, URL masking, and credentials redacted from settings logs.
- **n8n integration** — webhook client with timeout and auth, a provider-agnostic `search_web` tool, and an optional pre-processing hook on the chat pipeline that fails open if n8n is unreachable.

---

## Inherited from upstream

These arrived with upstream v0.7.8 and work as they always did, apart from the changes listed above:

- **Per-user recommendation libraries** written into your media server as STRM files or symlinks, with NFOs, artwork and subtitles preserved.
- **Top Picks** — global, popularity-driven libraries, collections or playlists, with rank badges on posters and optional automatic requesting of missing entries.
- **1–10 star ratings** from any poster, and **Trakt.tv** two-way sync.
- **Global search**, the similarity graph and graph playlists, franchises, the dashboard.
- **The 11-step setup wizard**, automatic daily database backups with configurable retention, and restore from either setup or the admin console.
- **TMDB, OMDb, MDBList, JustWatch and Seerr** integrations.

---

## Jobs

Everything runs as a named job with live progress, a log, cancellation and run history. Schedules are editable in **Admin → Ops → Jobs** — daily, weekly (on as many weekdays as you like), biweekly, every N hours or minutes, or manual.

**Continuous**

| Job                                                       | Default          |
| --------------------------------------------------------- | ---------------- |
| `sync-users`                                              | Every 30 minutes |
| `sync-series-watch-history`                               | Hourly           |
| `sync-watching-favorites`                                 | Hourly           |
| `sync-movie-watch-history`                                | Every 2 hours    |
| `sync-movies`, `sync-series`                              | Every 3 hours    |
| `sync-movie-libraries`, `sync-series-libraries`           | Every 3 hours    |
| `enrich-metadata`                                         | Every 6 hours    |
| `generate-movie-embeddings`, `generate-series-embeddings` | Every 6 hours    |
| `sync-trakt-ratings`                                      | Every 6 hours    |

**Daily**

| Job                              | Default |
| -------------------------------- | ------- |
| `backup-database`                | 02:00   |
| `refresh-ratings`                | 02:30   |
| `sync-lldap-emails`              | 03:15   |
| `cleanup-auth-state`             | 03:30   |
| `refresh-top-picks`              | 05:00   |
| `enrich-studio-logos`            | 05:30   |
| `generate-discovery-suggestions` | 06:00   |
| `enrich-mdblist`                 | 07:00   |

**Weekly (Sunday)**

| Job                                                                             | Default |
| ------------------------------------------------------------------------------- | ------- |
| `generate-movie-recommendations`, `generate-series-recommendations`             | 04:00   |
| `refresh-assistant-suggestions`, `refresh-ai-pricing`, `auto-request-top-picks` | 00:00   |

**Manual only**

`full-reset-movie-recommendations` · `full-reset-series-recommendations` · `rebuild-taste-profiles` · `refresh-recommendation-explanations` · `refresh-embedding-centering` · `evaluate-recommender` · `generate-title-analysis` · `refresh-library-gaps`

> Jobs at the same cadence are staggered by minute offset to avoid contention. Anything that spends money on model calls polls for cancellation between calls, not just between users.

---

## Configuration

Almost everything is configured in the UI and stored in the database — media server, API keys, AI providers, output paths, schedules. Environment variables cover only deployment shape.

| Variable                   | Default               | Purpose                                                        |
| -------------------------- | --------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`             | —                     | **Required.** Postgres connection string (pgvector)            |
| `SESSION_SECRET`           | —                     | **Required.** 32+ random characters                            |
| `APP_BASE_URL`             | —                     | How users reach the app                                        |
| `PORT`                     | `3456`                | HTTP port                                                      |
| `TZ`                       | —                     | IANA timezone for job schedules                                |
| `RUN_MIGRATIONS_ON_START`  | `true`                | Apply pending migrations at boot                               |
| `DEPLOYMENT_MODE`          | `direct`              | `direct`, `proxy`, `tunnel` or `cloudflared`                   |
| `TRUST_PROXY`              | —                     | Trusted proxy address or CIDR. Pin the proxy; never use `true` |
| `HOST`                     | —                     | Bind address                                                   |
| `COOKIE_SECURE`            | on in production      | Force the `Secure` cookie flag                                 |
| `API_DOCS`                 | `admin` in production | `public`, `admin` or `off` for `/openapi`                      |
| `ALLOW_PASSWORDLESS_LOGIN` | off                   | Production gate over the admin toggle                          |
| `SETUP_ALLOW_REMOTE`       | off                   | Allow first-run setup from non-local addresses                 |
| `CSP_REPORT_ONLY`          | off                   | Report-only content security policy                            |
| `I18N_OVERRIDES_DIR`       | `/config/i18n`        | Runtime UI string overrides                                    |
| `BRANDING_DIR`             | `/config/branding`    | Custom logo and favicon                                        |
| `MEDIA_SERVER_PUBLIC_URL`  | —                     | Separate public URL for user-facing media-server links         |
| `QUIET_POLL_LOGS`          | off                   | Silence high-frequency poll-route access logs                  |
| `MASK_LOG_URLS`            | off                   | Redact URLs in logs                                            |

---

## Documentation

### Guides

| Guide                                  | Description                                         |
| -------------------------------------- | --------------------------------------------------- |
| [Admin Guide](docs/admin-guide.md)     | Setup walkthrough, job management, algorithm tuning |
| [User Guide](docs/user-guide.md)       | Features for end users                              |
| [Configuration](docs/configuration.md) | Volumes, reverse proxy, integrations                |
| [API Reference](docs/api-reference.md) | Endpoint documentation                              |
| [Architecture](docs/architecture.md)   | Pipeline, database schema, technical overview       |
| [Development](docs/development.md)     | Local setup, scripts, contribution notes            |

### Feature pages

[Recommendations](docs/features/recommendations.md) ·
[AI Assistant](docs/features/ai-assistant.md) ·
[Discovery](docs/features/discovery.md) ·
[Explore & similarity graphs](docs/features/explore.md) ·
[Browse](docs/features/browse.md) ·
[Dashboard](docs/features/dashboard.md) ·
[Global search](docs/features/global-search.md) ·
[Movie detail](docs/features/movie-detail.md) ·
[Series detail](docs/features/series-detail.md) ·
[Shows You Watch](docs/features/shows-you-watch.md) ·
[Watch history](docs/features/watch-history.md) ·
[Watch stats](docs/features/watch-stats.md) ·
[Playlists](docs/features/playlists.md) ·
[Top Picks](docs/features/top-picks.md) ·
[Franchises](docs/features/franchises.md) ·
[Person pages](docs/features/person-pages.md) ·
[Studio pages](docs/features/studio-pages.md) ·
[Ratings](docs/features/ratings.md) ·
[Trakt](docs/features/trakt-integration.md) ·
[Virtual libraries](docs/features/virtual-libraries.md) ·
[User settings](docs/features/user-settings/)

### Admin pages

[Setup wizard](docs/admin/setup-wizard.md) ·
[Recommended workflow](docs/admin/recommended-workflow.md) ·
[Post-setup checklist](docs/admin/post-setup-checklist.md) ·
[Media server](docs/admin/media-server.md) ·
[Libraries](docs/admin/libraries.md) ·
[File locations](docs/admin/file-locations.md) ·
[Output format](docs/admin/output-format.md) ·
[AI providers](docs/admin/ai-providers.md) ·
[Embedding models](docs/admin/embedding-models.md) ·
[Chat models](docs/admin/chat-models.md) ·
[Text models](docs/admin/text-models.md) ·
[AI explanations](docs/admin/ai-explanations.md) ·
[Algorithm tuning](docs/admin/algorithm-tuning.md) ·
[Jobs overview](docs/admin/jobs-overview.md) ·
[Job scheduling](docs/admin/job-scheduling.md) ·
[Integrations](docs/admin/integrations-overview.md) ·
[TMDB](docs/admin/tmdb.md) ·
[OMDb](docs/admin/omdb.md) ·
[MDBList](docs/admin/mdblist.md) ·
[Trakt](docs/admin/trakt.md) ·
[Seerr](docs/admin/seerr.md) ·
[Users](docs/admin/user-management.md) ·
[Permissions](docs/admin/user-permissions.md) ·
[Backup & restore](docs/admin/backup-restore.md) ·
[External database](docs/admin/external-database.md) ·
[Maintenance](docs/admin/maintenance.md) ·
[Windows / Docker Desktop](docs/admin/windows-docker-desktop.md)

### For contributors

- [`CLAUDE.md`](CLAUDE.md) — repo map: where every feature lives, and the invariants that hold across the codebase.
- [`docs/aperture-forensics.md`](docs/aperture-forensics.md) — the evidence behind the non-obvious decisions: what was measured, what failed, and what was tried and rejected. Read the relevant section before changing or arguing with a rule in `CLAUDE.md`.

---

## Development

```bash
pnpm install
pnpm dev            # api (3456) + web (3457, proxying /api)
pnpm build          # topological build of every package
pnpm typecheck      # builds packages first, then typechecks
pnpm lint           # eslint --max-warnings 0
pnpm validate       # lint + typecheck
pnpm db:migrate     # apply migrations
pnpm db:status      # show migration state
```

Propagate new English strings to the other 14 locales:

```bash
pnpm --filter @aperture/web i18n:sync
```

Layout:

- `packages/core` (`@aperture/core`) — all domain logic; the apps consume its compiled `dist/`
- `packages/ui` (`@aperture/ui`) — shared React components
- `apps/api` (`@aperture/api`) — thin Fastify HTTP layer
- `apps/web` (`@aperture/web`) — Vite + React SPA
- `db/migrations` — numbered SQL, applied at startup

After changing an export in `packages/core` or `packages/ui`, rebuild the packages before typechecking the apps.

---

## Tech stack

- **Backend** — Fastify 5, TypeScript, PostgreSQL + pgvector, raw SQL (no ORM), pino, node-cron
- **Frontend** — React 18, Vite, MUI 6, react-router 7, i18next, assistant-ui, d3, recharts
- **AI** — Vercel AI SDK with providers for OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Ollama, Hugging Face and any OpenAI-compatible endpoint
- **Infrastructure** — Docker (multi-arch amd64/arm64), pnpm workspaces, GitHub Actions

---

## License

[GNU Affero General Public License v3.0](LICENSE)
