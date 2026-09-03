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

### Headline additions over upstream

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

## Feature tour

### Recommendations

- **Per-user libraries** written into your media server as STRM files or symlinks, with NFOs, artwork and subtitles preserved.
- **Taste profiles** built from watch history, favourites, ratings and completion — weighted by how much of a series someone actually finished, and split into up to three clusters so a viewer with two distinct tastes is not averaged into one.
- **Scoring** blends similarity, novelty and rating, each weight admin-tunable per media type, then corrected so a weight buys the influence it claims.
- **Selection** uses MMR (maximal marginal relevance) rather than a genre-coverage sort, with reserved slots for:
  - **stated interests** — free-text things you want more of,
  - **taste twins** — picks borrowed from the viewer whose history overlaps yours far more than chance, and
  - **acclaimed titles** the ranking would otherwise never reach.
- **Match insights** on every title the recommender scored — not just the twenty it picked. The panel shows the blended score, the preference adjustment, the per-term weight shares, variety, and the titles in your own history that support the pick.
- **AI explanations** written from real data (plot, keywords, directors, nearest neighbours in your history) with an explicit no-invention rule, refreshable on their own without re-scoring.
- **Activity gate** — scheduled runs skip users whose library and history have not changed enough to move a pick; a manual run always runs.

### AI assistant

- Chat that routes each turn: **library** questions search your shelf, **discovery** questions run a grounded web search and resolve the results back against your library by IMDb ID → TMDB ID → title + year.
- Available as a **dockable side panel**, a **dialog**, or the full **`/assistant`** page, with conversation history and live phase status ("searching the web", "checking your library") instead of a static spinner.
- Tools for semantic search, filtered search, watch history, ratings, similar titles, person lookups, episode-level search, and your own recommendation run.
- Rich cards with synopsis, reason, director, favourite state and watched state; open a title in place without leaving the conversation.
- **Build a playlist or collection from chat picks**, carrying the request that produced them.
- Optional **unwatched-only** mode, and suggestion chips drawn from your newest completed run.

### Discovery and requests

- **Discovery engine** — finds content you do _not_ own, scores it against your taste clusters, and offers it for request through **Jellyseerr / Overseerr**.
- **My Requests** page tracking what you asked for and where it got to.
- **Gap analysis** — finds incomplete TMDB collections in your library and shows what is missing.
- **Missing episodes and seasons** surfaced on series pages, with per-season requests.

### Browse, search and detail pages

- **Browse** with filters for genre, year, rating, content rating, network, studio, people and **production country** (with AND/OR matching), grid and list views, and saved sort.
- **Global search** (⌘K) plus a **semantic search** page that finds by concept rather than keyword.
- **Movie and series detail pages** — each fact stated once: ratings and awards on the hero line, full cast and crew, languages and countries, related titles, watch progress, trailer, favourite and mark-watched actions.
- **Series detail** with per-season and per-episode progress and inline episode descriptions.
- **Person, studio and franchise pages** built from your library and TMDB.
- **Title analysis** — an optional critic-informed account of what a film or show actually is, retrieved from the open web (self-hosted fastCRW search, or Google grounding) and cached per title.

### Watching and history

- **Shows You Watch** — everything in flight, with a segmented bar combining progress, availability and what is missing, plus Airing/Ended filters driven by TMDB status.
- **Watch history** with full-history search, status filters, resume bars and last-played timestamps.
- **Watch Stats** — genres, decades, ratings, people, studios, networks, a time-of-day heatmap, a rewatch breakdown, TV vs film time, and a "your taste vs the crowd" comparison. **Every number opens the titles behind it.**
- **Watcher identity** — a natural-language description of what your viewing says about you.

### Playlists, collections and channels

- **Channels** — rule-based playlists and collections for both movies and series, written to your media server as playlists or Emby Box Sets.
- **Two-phase generation**: preview the list (with an AI note on each pick) and approve it before anything is written.
- **Graph playlists** built by walking the similarity graph out from a seed title.
- **AI text generation** for names and descriptions, with a "build on what I wrote" option on every sparkle button.

### Explore

- **Similarity graph** — an interactive, multi-hop map of how titles relate, with reasons on each edge and optional **cross-media connections** (films to series and back).

### Top Picks

- Global, popularity-driven libraries, collections or playlists across all users, with rank badges on posters and optional automatic requesting of missing entries.

### Ratings

- **1–10 star ratings**, ratable from any poster, with a server-wide default and a per-user override for whether rating badges show on posters.
- **Trakt.tv** two-way sync.
- Library ratings kept fresh from the **IMDb daily dataset** (one file, no API key) rather than frozen on the day a title was first enriched, plus TMDB and OMDb scores, and Rotten Tomatoes / Metacritic where available.

---

## Administration

The admin console lives under **`/admin`**, reached from the app bar. It is generated from a single registry — 8 groups, 40+ sections — with a **⌘⇧K search palette** that finds sections, individual settings and every job by name.

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

### AI configuration

Six independent roles — **embeddings**, **chat**, **text generation**, **exploration**, **web search**, **title analysis** — each with its own provider, model, API key and options:

- Providers: **OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Ollama, LM Studio / OpenAI-compatible, Hugging Face**.
- Live model catalogs with **per-1M-token pricing**, tool-calling and reasoning badges; local servers are probed for what they actually have installed.
- **Reasoning effort** per role, offered in each model's own vocabulary rather than an invented one.
- **Fallback models** and **fallback API keys** for free-tier work, with call pacing and per-key cooldowns.
- **Spend dashboard** measuring what OpenRouter actually charged (unpriced calls are reported as unknown, never as $0), alongside a forward-looking cost estimator.

### Embeddings

- Model **and dimension** are settings — 768 through 4096, including 2560 — each stored in its own table, so switching models starts a new set beside the old one rather than destroying it.
- A **stored sets panel** shows every set, its coverage, its dates, and exactly what switching would cost (re-embed → re-centre → rebuild taste profiles → regenerate).
- **Mean-centred vectors**: subtracting what every title in the library has in common measurably improved retrieval, and centring now runs at the end of each embedding job rather than being a chore to remember.
- **Retrieval mode** offered only for models that document how to carry one, delivered as a parameter or a text prefix depending on the model.
- **Episode-level embeddings** (optional) power episode search in the assistant.

### Algorithm tuning and evaluation

- Per-media-type controls for similarity / novelty / rating weights, diversity, preference strength, candidate pool size, selected count, and the reserved-slot budgets — with the budget enforced in the controls so the slot features cannot over-reserve.
- **Evaluation harness** (`evaluate-recommender`, manual, read-only): ranks a held-out slice of each viewer's history against random and rating-only baselines, dumps the nearest neighbours of chosen seed titles raw and centred side by side, measures every stored embedding set, archives the results and exports them as CSV.
- Seed titles are editable from the admin UI.

### Branding and languages

- **Rename the instance** — the name reaches all 15 locales, and the browser tab from the first byte.
- **Mount your own logo and favicon** (`BRANDING_DIR`), and set the two brand colours from the UI.
- **Edit any UI string** in the app or via CSV round-trip, or drop `overrides.<lng>.json` into `I18N_OVERRIDES_DIR` to customize text without rebuilding the image.
- **Language allowlists** — choose which UI and AI languages users may select, and the default for each.
- 15 locales: ar, de, el, en, es, fr, he, hi, it, ja, ko, nl, pt, ru, zh (ar and he render right-to-left).

### Security and access

- Sessions are bearer tokens with a 30-day absolute lifetime and a 7-day idle timeout; disabling an account revokes them immediately.
- Login protection on two axes: an IP-keyed rate limit plus per-account progressive lockout, so neither a spray nor a distributed attack on one account gets through.
- **API keys** for automation.
- **Admin "view as user"** — see the app exactly as another user sees it, read-only, on a one-hour lease, with a persistent banner and an exit that is always on screen. The admin's own session is never swapped out.
- **Deployment posture panel** that checks configuration _against live traffic_ — an instance behind a tunnel with no trusted proxy looks healthy from config alone, so it watches for forwarded headers it is not trusting.
- **Trusted proxies editable at runtime**, no restart.
- First-run setup restricted to local addresses; CSP, HSTS and referrer policy set by helmet.

### Backups

- Automatic daily database backups with configurable retention.
- Restore during setup (for migrations) or from Admin → Ops → Backup.

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
