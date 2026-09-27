# Aperture

[![Based on upstream](https://img.shields.io/badge/based_on_upstream-v0.7.8-blue.svg)](https://github.com/dgruhin-hrizn/aperture/releases/tag/v0.7.8)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Faka--charos%2Faperture%3Adev-blue?logo=docker)](https://github.com/aka-charos/aperture/pkgs/container/aperture)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

**Aperture** — self-hosted AI recommendations, discovery and watch tracking for **Emby** and **Jellyfin**.

Aperture syncs your library and everyone's watch history, embeds every title as a vector, builds a taste profile per user, and writes personalized recommendation libraries back into your media server — and, on Emby, rows onto each viewer's home screen. Around that core it has grown into a full companion app: an AI chat assistant that can search the web _and_ your shelf, a discovery engine that files requests and problem reports in Jellyseerr/Overseerr, critic-informed title analyses, a similarity graph, playlists and collections, watch statistics, recommendations shared between connected users, and an admin console for every knob involved.

Works for **movies** and **TV series**, in **15 languages**, and shows each viewer only the libraries their media-server account is allowed to open.

---

## About this fork

This repository ([aka-charos/aperture](https://github.com/aka-charos/aperture)) is a fork of [dgruhin-hrizn/aperture](https://github.com/dgruhin-hrizn/aperture). It is based on upstream **v0.7.8** and carries more than five hundred commits of features and fixes on top. Upstream has since released v0.7.9 and v0.7.10; those releases are **not** merged here.

- Active development happens on **`dev`**. That is the branch to deploy from.
- `main` is a stale mirror of upstream v0.7.8 and exists only to make rebases easy.
- Images are published to **`ghcr.io/aka-charos/aperture:dev`** whenever a push to `dev` changes the application (`apps/`, `packages/`, `db/`, `docker/` or the lockfile) and passes lint and typecheck. That tag is built for **amd64 only** — see [ARM hosts](#arm-hosts).
- Version identity is two fields, not one string: `APP_VERSION` is the upstream lineage (`0.7.8`), `APP_BUILD` is the fork build (`mod.<commits>.g<sha>`). Both appear in the admin console and in `/api/health`.

**This README is written as a delta.** Upstream's own documentation still describes the base application; what follows concentrates on what is different here — [what the fork changes](#what-this-fork-changes), section by section, with the parts that arrived unchanged gathered under [Inherited from upstream](#inherited-from-upstream). If you are comparing the two projects, the next table and that section are the whole answer.

### At a glance

| Area                     | What the fork adds                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI providers**         | Six AI roles (embeddings, chat, text generation, exploration, web search, title analysis), each independently configurable across eleven providers — OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Z.AI, Hugging Face, Ollama, LM Studio and any OpenAI-compatible endpoint. Live model catalogs and pricing, reasoning-effort and sampling controls in each model's own vocabulary, fallback models, fallback API keys and a spend dashboard. |
| **Embeddings**           | Model and dimension are a setting, not a constant (768–4096, including 2560). Mean-centred vectors, retrieval-mode selection where the model supports one, a stored-sets panel showing what is embedded and what switching would cost, and an offline evaluation harness with CSV export.                                                                                                                                                               |
| **Recommender**          | MMR diversity, taste twins, reserved slots for stated interests and acclaimed titles, era affinity, availability-adjusted genre preference, taste clustering, an activity gate that skips pointless regenerations, and an insights panel showing the actual arithmetic behind every match score.                                                                                                                                                        |
| **Assistant**            | Intent-routed chat: library questions query your shelf, discovery questions run a grounded web search and resolve results against it, with a taste-profile section alongside. Dockable panel, dedicated page, streaming phase status, conversation history, rich cards, stored title analyses on request, and "build a playlist from these picks".                                                                                                      |
| **Discovery & requests** | Missing-content engine that ranks candidates against your taste; search and request from inside the app, filed under each viewer's own Seerr account; in-app approve/decline; problem reports with threaded replies; a franchise page showing what is owned, missing and announced.                                                                                                                                                                     |
| **Title analysis**       | An optional critic-informed article per title, written from self-hosted search (fastCRW) or Google grounding, plus a bench that runs several models on byte-identical sources and prints their answers side by side.                                                                                                                                                                                                                                    |
| **Emby home screen**     | Top Picks, each viewer's own picks and playlists they choose, as rows on every viewer's Emby home screen — placed where the admin, or the viewer, puts them. No duplicate items and no STRM files involved.                                                                                                                                                                                                                                             |
| **Sharing**              | Admin-paired connections: see who you know watched a title, browse each other's history, recommend a title to someone, and a "Shared with me" inbox.                                                                                                                                                                                                                                                                                                    |
| **Watch state**          | Watched ticks and `8/24` episode progress on posters throughout the app; rating a film the server never saw play asks roughly when you watched it and marks it played.                                                                                                                                                                                                                                                                                  |
| **Admin console**        | Rebuilt as a two-level nav generated from one registry — 8 groups, 45 sections, a ⌘⇧K search palette that indexes sections, individual settings _and_ every job, plus per-section preconditions.                                                                                                                                                                                                                                                        |
| **Branding & i18n**      | Rename the instance, mount your own logo and favicon, set brand colours, edit any UI string in-app or via CSV, restrict which languages users may pick — all without rebuilding the image.                                                                                                                                                                                                                                                              |
| **Security & access**    | Access as its own per-account switch, library access that follows the media server, feature permissions decided on the server, scoped API keys, a record of every permission change, a deployment-posture panel with live evidence, runtime-editable trusted proxies, session hardening, per-account login lockout, and admin "view as user" (read-only).                                                                                               |
| **Jobs & ops**           | A job system with cancellation that reaches into running model calls, editable multi-day schedules, per-run item caps and log windowing.                                                                                                                                                                                                                                                                                                                |

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

### 2. Check the image line

The compose files already point at this fork's image — no edit needed on an amd64 host:

```yaml
services:
  app:
    image: ghcr.io/aka-charos/aperture:dev
```

**Use `:dev`, not `:latest`.** This fork publishes `:dev` from the `dev` branch, which is where all work happens. `:latest` is only built from `main`, a stale upstream mirror — it is months behind. On an ARM machine, read [ARM hosts](#arm-hosts) first.

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
7. **Users** — choose who gets access and recommendations
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

### ARM hosts

`:dev` is built for **amd64 only**. An arm64 image is produced only by a manual run of the build workflow, and the next push to `dev` replaces the tag with an amd64-only image again — so on an ARM machine (Apple Silicon, an ARM-based NAS, a Raspberry Pi) build the image yourself:

```bash
git clone -b dev https://github.com/aka-charos/aperture.git
cd aperture
docker build -f docker/Dockerfile -t aperture:local .
```

Then set `image: aperture:local` in your compose file. A locally built image reports its build as `dev`, since the version fields are supplied by CI.

---

## What this fork changes

Everything in this section is fork work on top of upstream v0.7.8. Where a heading names something upstream already had, the text describes what is now different about it; the parts that arrived unchanged are listed separately under [Inherited from upstream](#inherited-from-upstream).

### AI providers and models — rebuilt

Upstream took one OpenAI key and used one model for everything.

- **Six independent roles** — embeddings, chat, text generation, exploration, web search, title analysis — each with its own provider, model, key and options.
- **Eleven providers**: OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Z.AI (GLM), Hugging Face, Ollama, LM Studio, and any OpenAI-compatible endpoint. Embeddings run on OpenAI, Google, OpenRouter, Ollama, LM Studio or an OpenAI-compatible server; the others supply the text roles. LM Studio is asked what it has installed and offers only the models that can hold the role being configured; Z.AI takes either its international or its mainland endpoint.
- **Live model catalogs** with per-1M-token pricing, tool-calling and reasoning badges; retired models drop out on their own. Custom models are refused until they pass a connection test.
- **Reasoning effort** per role, offered in each model's own vocabulary rather than an invented one, because a reasoning model bills its scratchpad from the same output allowance as the answer.
- **Sampling controls** — temperature and top-p on the Title Analysis role, offered only for models that declare them. Unset sends nothing, so the provider default stands.
- **Fallback models and fallback API keys** for free-tier work — extra Google keys for grounded web search, and a chain of fallback models (on any provider, local ones included) for title analysis — with call pacing and per-key cooldowns. A spare key answers "this account is out of quota", a spare model answers "this model is gone".
- **Spend dashboard** measuring what calls actually cost: OpenRouter's billed figure, and Z.AI's computed from its published prices and labelled as an estimate. Unpriced calls are reported as unknown, never as $0.
- **Readable provider failures** — errors are logged with status, model and the provider's own words instead of the whole prompt, and a Z.AI address missing its API path is named as such rather than reading as a dead key.
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
- **One Recommendations switch per account.** Whether someone gets film picks, series picks or both follows from which libraries their media-server account can open, and picks are drawn only from those libraries.
- **Match insights on every scored title**, not just the twenty that were picked: blended score, preference adjustment, per-term weight shares, variety, and the titles in your own history that support the pick — with a different, honest heading when the pick came from a reserved slot and the ranking is not the reason.
- **Explanations** are written from real data (plot, keywords, directors, neighbours in your history, and the title's stored analysis where one exists) under a no-invention rule, survive a truncated response instead of replacing all ten with a template, and can be re-run on their own without re-scoring.
- **Admin controls** for preference strength, gate thresholds, slot budgets and candidate pool size, with the pool bounded by the number of items that actually exist.

### AI assistant — new

- Chat that **routes each turn**: library questions search your shelf, discovery questions run a grounded web search and resolve the results back against your library by IMDb ID → TMDB ID → title + year.
- A discovery answer comes from **three directions in one step** — web picks, neighbours of any title you named, and a **From your taste profile** section that searches the titles the recommender already scored for you using your own words. The third runs in parallel with the web search, so it adds no wait.
- Available as a **dockable side panel**, a **dialog**, or the full **`/assistant`** page, with conversation history that survives a reload and renders in the order it was written.
- **Live phase status** ("searching the web", "checking your library") in place of a static spinner, and cards that stream in rather than waiting for the slow part.
- Tools for semantic search, filtered search, watch history, ratings, similar titles, person lookups, franchises, episode search, stored title analyses, and your own recommendation run — including a library-scoped personalized search over the pool the recommender already scored.
- **National cinema is searchable** (country, not language — languages are populated for under 1% of a real library), with ~120 demonyms mapped to the stored country names.
- Rich cards with synopsis, grounded reason, director, favourite and watched state; open a title in place without leaving the conversation.
- **Build a playlist or collection from chat picks**, carrying the request that produced them.
- Optional **unwatched-only** mode, and suggestion chips drawn from your newest completed run.
- Every result is limited to the libraries you can open, and the assistant can be switched on or off per account.

### Discovery, requests and issues

- **Discovery engine** — finds content you do _not_ own, ranks it against your taste clusters, and files requests through **Jellyseerr / Overseerr**. Candidates are embedded as they arrive (a title you do not own has no stored vector), and the detail card states the taste match as a rank — "#12 of 245" — rather than a percentage that always spans 0–100. Fetch sizes, filters and weights are admin-tunable under **Discovery tuning**, with each term's measured influence shown beside its configured share.
- **Search and request from inside the app** on My Requests, with films and TV shows in separate sections and "already in your library" decided by Aperture's own tables rather than Seerr's.
- **Requests are filed as the person who made them** — under their own Seerr account, so quotas and auto-approval follow their Seerr permissions rather than the admin's. Admins can approve or decline from the app and choose the server, quality profile and root folder; viewers get their Seerr defaults and never see server paths.
- **Report a problem** with a title — video, audio, subtitles or something else, for the whole title, a season or an episode — from its detail page. Reports are real Seerr issues under the reporter's own account, so Seerr's notifications name the right person, and replies thread under each report on the **Issues** tab of My Requests.
- **Grounded web search** as its own AI role, with Google grounding plus **Tavily** as a second source; sources compose and fall back for one another, and free-tier grounding quota is metered per key with automatic rotation.
- The taste brief personalises **which candidates win, never which searches run** — the profile is structurally unable to reach a search call.
- **Franchise page** for every TMDB collection — what you own, what is missing and what is announced — with a request button only where a request would actually do something.
- **Gap analysis** — incomplete TMDB collections in your library, with what is missing, each row linking to its franchise page.
- **Missing episodes and seasons** surfaced on series pages with per-season requests.

### Title analysis — new

- An optional **critic-informed article** about a film or show — its context, its form and style, how it was made and how it was received — written from the open web, cached per title and shared by every user.
- Sources come from self-hosted **fastCRW** (a general search plus a second search restricted to publications that print criticism) or from Google grounding. Pages are cleaned before the model sees them: bot walls, empty scrapes, link walls, pages about some other film and repeat hosts are dropped, and menus and plot sections are cut so the character budget goes on the writing.
- A thin record is **declined** rather than padded, and a malformed answer is retried or rotated to a fallback model — never stored.
- Generated on demand from a title's detail page (admins can re-run one), or by the `generate-title-analysis` job, which works through the library with a titles-per-run cap and takes an optional schedule.
- **Analysis bench** — run one title through several models, and several prompt versions, on byte-identical retrieved sources; read the answers side by side with counts of known habits; replay a stored run against a new prompt without retrieving again.
- The assistant reads stored analyses on request, and recommendation reasons draw on them.

### Emby home screen rows — new

- **Top Picks, each viewer's own recommendations (a films row and a series row) and playlists they choose** appear as rows on their Emby home screen. Needs Emby **4.10.0.40** or later; Jellyfin is not supported yet.
- Rows are backed by tags on the **original library items** through Emby's API — no STRM files, no duplicate entries, nothing to rescan. The tag behind a viewer's row is a random token, never derived from who they are.
- **Placement** per row type — top, bottom, a position, or before/after a named row — with an admin default and a per-viewer override in user settings. Rows move only when they are created or their placement changes, so a viewer's own rearranging in Emby is kept.
- A playlist or collection joins its owner's home screen from its card, or from the chat's "create a playlist from these" dialog.
- Personal rows go to accounts with access; Top Picks rows go to every account, or optionally only to accounts with access. Anyone who stops qualifying has the rows removed.
- The `sync-home-sections` job runs daily after Top Picks refresh; a viewer's own changes apply immediately.

### Watch state and ratings

- **Watched state on posters** across browse, detail pages, Top Picks, recommendations and chat cards — a tick on a finished film or show, and a watched/total fraction such as `8/24` on a show you are part-way through. Counted against the episodes your library holds, specials excluded, so owning one season of five and finishing it counts as finished.
- **Rating a film the server never saw play asks roughly when you watched it** — this month, last month, earlier this year, last year, or longer ago — and marks it played on the media server with that date. Estimated dates count as watches but stay off the time-based charts, and a real play later clears the estimate.
- **Favouriting is not watching** — a bookmarked title no longer counts as watched in tiles, filters, counters, badges or the assistant.

### Sharing between users — new

- An admin **connects** two accounts from the Users page. Connections are mutual, and the other person is visible only while their account has access.
- Connected viewers see **who they know watched a title** on its detail page, can **browse each other's watch history**, get a **row of each other's recent watches** on the dashboard, and can **recommend a title** to one another.
- **Shared with me** collects the recommendations sent to you, with a count in the sidebar; a title leaves on its own once you finish it.
- Everything shown from someone else's activity is filtered to the libraries _you_ can open. Admins see every watcher's name; everyone else sees names only for their connections.

### Watch statistics — every number opens

- Genres (film and TV), decades, ratings, people, studios, networks, a time-of-day heatmap, a rewatch breakdown, TV vs film time, and a "your taste vs the crowd" comparison.
- **Every figure on the page opens the titles behind it**, counted with the same SQL that produced the number, so a "7 films" chip cannot open five.
- **Watcher identity** — an analysis of what your viewing says about you, written from the films and shows you actually played compared against what your library holds, naming real titles and people. The recommendation run rewrites it whenever your taste profile moves, so it no longer waits for someone to find a button.

### Browse, detail pages and the rest of the UI

- **Production-country filter** with search, multi-select and AND/OR matching, plus a searchable network filter and reordered content ratings.
- **Library search** ignores accents and punctuation, matches original titles as well as localized ones, and ranks by how much of your query a title contains — a title with a colon in it no longer breaks the search.
- **Detail pages say each thing once** — ratings and awards on the hero line, director and writer beside them, one info card below; the duplicate genre, critic-rating and awards panels are gone.
- **Series detail** with per-season and per-episode progress and inline episode descriptions.
- **Person and studio pages** with biography and birth/death data.
- **Shows You Watch** — a segmented bar combining progress, availability and what is missing, plus Airing/Ended tabs driven by TMDB status rather than a stale server field.
- **Watch history** searches the whole history rather than the loaded page, with status filters and real resume bars.
- **Channels build collections and playlists from TV series too**, with a preview-and-approve step and an AI note on each pick before anything is written.
- **Cross-media connections** in the Explore graph — films to series and back — which was previously a toggle that could never match anything.
- **Collapsible sidebar** with a hover flyout, page titles in the app bar instead of 80px of repeated heading, a welcome guide that snoozes instead of nagging, and a resizable assistant dock.

### Admin console — rebuilt

- Generated from **one registry**: 8 groups, 45 sections, with the route table, the nav and the search index all derived from the same data, so a section cannot exist in one and not the others.
- **⌘⇧K search palette** indexing sections, 43 individual settings _and_ all 35 jobs, scored per word so "novelty weight" finds the slider even though neither word is its label.
- **Per-section preconditions** shown as a dimmed row with a reason, rather than an unclickable tab.
- An error boundary per section, so one broken panel cannot take the console down with it.

It lives at **`/admin`**, reached from the app bar:

| Group               | Covers                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**        | Version, build, health, quick status                                                                                                                                              |
| **Library**         | Media server, source libraries, file locations, gap analysis                                                                                                                      |
| **Integrations**    | TMDB, OMDb, MDBList, Trakt, Seerr, LLDAP, n8n, Tavily, fastCRW, JustWatch streaming, ratings refresh                                                                              |
| **AI**              | Providers and roles, spend dashboard, cost estimate, embeddings, analysis bench                                                                                                   |
| **Recommendations** | Algorithm and weights, evaluation, explanations, output format, library naming, Top Picks, Emby home rows, Shows You Watch, discovery tuning, genre strips, channel web expansion |
| **Appearance**      | Instance branding, theme colours, poster display, language defaults, translations editor                                                                                          |
| **Access**          | Users (access, feature switches, connections, "view as"), API keys, deployment posture                                                                                            |
| **Ops**             | Jobs, backup, poster repair, logs, database                                                                                                                                       |

### Branding, languages and text

- **Rename the instance** — the name reaches all 15 locales and the browser tab from the first byte.
- **Mount your own logo and favicon** (`BRANDING_DIR`) and set the two brand colours from the UI.
- **Edit any UI string** in the app or via CSV round-trip, or drop `overrides.<lng>.json` into `I18N_OVERRIDES_DIR` to customize text without rebuilding the image.
- **Language allowlists** — choose which UI and AI languages users may pick, and the default for each.
- **Greek (el) added**, bringing the locale count to 15; ar and he render right-to-left.
- **Configurable media-server display name** used throughout the UI, and a separate public URL for user-facing media-server links.

### Security, access and deployment

- **An HTTP header no longer grants admin access.**
- **Access is its own switch.** Turning it off ends sign-in, sessions and API keys at once and stops every piece of per-user work, while leaving each feature switch as it was — so letting someone back in restores their setup. Features can be set up before access is granted, and an admin cannot switch off their own access.
- **Library access follows the media server.** Each viewer sees only the libraries their Emby/Jellyfin account can open (and that are enabled here), within their parental-rating limit — in browse, search, similar titles, the Explore graph, detail pages, the assistant and their generated libraries. A title outside that scope answers exactly like one that does not exist.
- **Feature permissions** — Discover, requests, Collections, the assistant, email notifications, watch-history management — are decided on the server from the session, and the sidebar shows only what the server says the viewer can use. Request rights genuinely require Discover now.
- **Scoped API keys** — `read`, `write` and `admin`. New keys are read-only; a scope can narrow what the account behind a key may do, never widen it.
- **Every permission change is recorded** — who changed what, including switches that moved because another one did.
- **Every route declares who may call it**, enforced by a test. Five that answered without a session — among them an image proxy for any media-server path — now require one.
- **An account disabled on the media server** can no longer use its open sessions or API keys, which used to keep working (sessions for up to 30 days, keys indefinitely); signing in again clears the flag, since the media server has just vouched for the account.
- **Admin "view as user"** — see the app exactly as another user sees it, read-only, on a one-hour lease, with a persistent banner and an exit that is always on screen. The admin's own session is never swapped out.
- **Deployment posture panel** that checks configuration _against live traffic_: an instance behind a tunnel with no trusted proxy looks perfectly healthy from config alone, so it watches for forwarded headers it is not trusting.
- **Trusted proxies editable at runtime**, applied without a restart.
- Session hardening (30-day absolute lifetime, 7-day idle timeout, immediate revocation on disable), per-account login lockout alongside the IP rate limit, and a cleanup job for both.
- **Optional LLDAP email import**, with email, login and activity shown on Admin → Users.
- Search engines told to stay away from the instance.

### Jobs and operations

- **Editable schedules** — daily, weekly on as many weekdays as you like, biweekly, every N hours or minutes, or manual — with the next run date shown from the same resolver the scheduler uses.
- **Cancellation that works**: a cancelled job holds its slot until it actually stops, and a refused start says why instead of silently doing nothing.
- **Stuck model calls end** — a streamed call that goes silent for ten minutes is abandoned, and Stop reaches into a call that is still in flight rather than waiting for it.
- **Per-run item caps** where a job declares one — title analysis takes a titles-per-run limit, applied to manual and scheduled runs alike.
- **Log windowing** that keeps the head as well as the tail, and says how many entries were actually lost.
- **API error tracking**, poll-log quieting, URL masking, and credentials redacted from settings logs.
- **n8n integration** — webhook client with timeout and auth, a provider-agnostic `search_web` tool, and an optional pre-processing hook on the chat pipeline that fails open if n8n is unreachable.

---

## Inherited from upstream

These arrived with upstream v0.7.8 and work as they always did, apart from the changes listed above:

- **Per-user recommendation libraries** written into your media server as STRM files or symlinks, with NFOs, artwork and subtitles preserved.
- **Top Picks** — global, popularity-driven libraries, collections or playlists, with rank badges on posters and optional automatic requesting of missing entries.
- **1–10 star ratings** from any poster, and **Trakt.tv** two-way sync.
- **Global search**, the similarity graph and graph playlists, the franchises list, the dashboard.
- **The 11-step setup wizard**, automatic daily database backups with configurable retention, and restore from either setup or the admin console.
- **TMDB, OMDb, MDBList, JustWatch and Seerr** integrations.

---

## Jobs

Everything runs as a named job with live progress, a log, cancellation and run history. Schedules are editable in **Admin → Ops → Jobs** — daily, weekly (on as many weekdays as you like), biweekly, every N hours or minutes, or manual. There are 35 in all.

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
| `reconcile-discovery-requests`   | 04:30   |
| `refresh-top-picks`              | 05:00   |
| `enrich-studio-logos`            | 05:30   |
| `sync-home-sections`             | 05:45   |
| `generate-discovery-suggestions` | 06:00   |
| `enrich-mdblist`                 | 07:00   |

**Weekly (Sunday)**

| Job                                                                             | Default |
| ------------------------------------------------------------------------------- | ------- |
| `generate-movie-recommendations`, `generate-series-recommendations`             | 04:00   |
| `refresh-assistant-suggestions`, `refresh-ai-pricing`, `auto-request-top-picks` | 00:00   |

**Manual by default** (`generate-title-analysis` and `refresh-library-gaps` can be given a schedule; the rest are manual only)

`full-reset-movie-recommendations` · `full-reset-series-recommendations` · `rebuild-taste-profiles` · `refresh-recommendation-explanations` · `refresh-embedding-centering` · `evaluate-recommender` · `generate-title-analysis` · `refresh-library-gaps`

> Jobs at the same cadence are staggered by minute offset to avoid contention. `reconcile-discovery-requests` runs ahead of the discovery run so a title declined in Seerr can return the same night, and `sync-home-sections` runs after Top Picks refresh so the home row reads that morning's list. Anything that spends money on model calls polls for cancellation between calls, not just between users.

---

## Configuration

Almost everything is configured in the UI and stored in the database — media server, API keys, AI providers, output paths, schedules. Environment variables cover only deployment shape.

| Variable                   | Default                 | Purpose                                                                           |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`             | —                       | **Required.** Postgres connection string (pgvector)                               |
| `SESSION_SECRET`           | insecure placeholder    | **Set this.** 32+ random characters; the placeholder logs a warning in production |
| `APP_BASE_URL`             | `http://localhost:3456` | How users reach the app                                                           |
| `PORT`                     | `3456`                  | HTTP port                                                                         |
| `TZ`                       | —                       | IANA timezone for job schedules                                                   |
| `RUN_MIGRATIONS_ON_START`  | `true`                  | Apply pending migrations at boot                                                  |
| `DEPLOYMENT_MODE`          | `direct`                | `direct`, `proxy`, `tunnel` or `cloudflared`                                      |
| `TRUST_PROXY`              | —                       | Trusted proxy address or CIDR. Pin the proxy; never use `true`                    |
| `HOST`                     | —                       | Bind address                                                                      |
| `COOKIE_SECURE`            | on in production        | Force the `Secure` cookie flag                                                    |
| `API_DOCS`                 | `admin` in production   | `public`, `admin` or `off` for `/openapi`                                         |
| `ALLOW_PASSWORDLESS_LOGIN` | off                     | Production gate over the admin toggle                                             |
| `SETUP_ALLOW_REMOTE`       | off                     | Allow first-run setup from non-local addresses                                    |
| `CSP_REPORT_ONLY`          | off                     | Report-only content security policy                                               |
| `I18N_OVERRIDES_DIR`       | `/config/i18n`          | Runtime UI string overrides                                                       |
| `BRANDING_DIR`             | `/config/branding`      | Custom logo and favicon                                                           |
| `MEDIA_SERVER_PUBLIC_URL`  | —                       | Separate public URL for user-facing media-server links                            |
| `QUIET_POLL_LOGS`          | off                     | Silence high-frequency poll-route access logs (also a UI toggle)                  |
| `MASK_LOG_URLS`            | off                     | Redact URLs in logs (also a UI toggle)                                            |

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
[My Requests](docs/features/my-requests.md) ·
[Title analysis](docs/features/title-analysis.md) ·
[Explore](docs/features/explore.md) ·
[Related-content graphs](docs/features/similarity-graphs.md) ·
[Browse](docs/features/browse.md) ·
[Grid & list views](docs/features/grid-list-views.md) ·
[Dashboard](docs/features/dashboard.md) ·
[Global search](docs/features/global-search.md) ·
[Movie detail](docs/features/movie-detail.md) ·
[Series detail](docs/features/series-detail.md) ·
[Shows You Watch](docs/features/shows-you-watch.md) ·
[Watch history](docs/features/watch-history.md) ·
[Watch stats](docs/features/watch-stats.md) ·
[Playlists](docs/features/playlists.md) ·
[Collections](docs/features/collections.md) ·
[Top Picks](docs/features/top-picks.md) ·
[Franchises](docs/features/franchises.md) ·
[Person pages](docs/features/person-pages.md) ·
[Studio pages](docs/features/studio-pages.md) ·
[Ratings](docs/features/ratings.md) ·
[Trakt](docs/features/trakt-integration.md) ·
[Virtual libraries](docs/features/virtual-libraries.md) ·
[Collapsible sidebar](docs/features/collapsible-sidebar.md) ·
[Logging in](docs/features/logging-in.md) ·
[User settings](docs/features/user-settings/)

### Admin pages

**Getting started** —
[Setup wizard](docs/admin/setup-wizard.md) ·
[Recommended workflow](docs/admin/recommended-workflow.md) ·
[Post-setup checklist](docs/admin/post-setup-checklist.md) ·
[Overview](docs/admin/overview.md) ·
[Windows / Docker Desktop](docs/admin/windows-docker-desktop.md) ·
[External database](docs/admin/external-database.md)

**Library** —
[Media server](docs/admin/media-server.md) ·
[Libraries](docs/admin/libraries.md) ·
[File locations](docs/admin/file-locations.md) ·
[Gap analysis](docs/admin/gap-analysis.md)

**Integrations** —
[Overview](docs/admin/integrations-overview.md) ·
[TMDB](docs/admin/tmdb.md) ·
[OMDb](docs/admin/omdb.md) ·
[MDBList](docs/admin/mdblist.md) ·
[Trakt](docs/admin/trakt.md) ·
[Seerr](docs/admin/seerr.md) ·
[LLDAP](docs/admin/lldap.md) ·
[n8n](docs/admin/n8n.md) ·
[Tavily](docs/admin/tavily.md) ·
[fastCRW](docs/admin/crw.md) ·
[Streaming (JustWatch)](docs/admin/streaming.md) ·
[Ratings refresh](docs/admin/ratings-refresh.md)

**AI** —
[AI providers](docs/admin/ai-providers.md) ·
[Embedding models](docs/admin/embedding-models.md) ·
[Chat models](docs/admin/chat-models.md) ·
[Text models](docs/admin/text-models.md) ·
[AI spend](docs/admin/ai-spend.md) ·
[Cost estimate](docs/admin/cost-estimate.md) ·
[Analysis bench](docs/admin/analysis-bench.md)

**Recommendations** —
[Algorithm tuning](docs/admin/algorithm-tuning.md) ·
[Evaluation](docs/admin/evaluation.md) ·
[AI explanations](docs/admin/ai-explanations.md) ·
[Output format](docs/admin/output-format.md) ·
[Library titles](docs/admin/library-titles.md) ·
[Top Picks](docs/admin/top-picks.md) ·
[Shows You Watch](docs/admin/shows-you-watch.md) ·
[Discovery tuning](docs/admin/discovery-tuning.md) ·
[Genre strips](docs/admin/genre-strips.md) ·
[Channel web expansion](docs/admin/channels-web-expand.md)

**Appearance** —
[Instance name & logo](docs/admin/branding.md) ·
[Theme colours](docs/admin/theme-colors.md) ·
[Poster display](docs/admin/poster-display.md) ·
[Language defaults](docs/admin/language-defaults.md) ·
[Translations](docs/admin/translations.md)

**Access** —
[Users](docs/admin/user-management.md) ·
[Permissions](docs/admin/user-permissions.md) ·
[API keys](docs/admin/api-keys.md) ·
[Deployment & security](docs/admin/deployment.md)

**Ops** —
[Jobs overview](docs/admin/jobs-overview.md) ·
[Job scheduling](docs/admin/job-scheduling.md) ·
[Movie jobs](docs/admin/movie-jobs.md) ·
[Series jobs](docs/admin/series-jobs.md) ·
[Global jobs](docs/admin/global-jobs.md) ·
[Backup & restore](docs/admin/backup-restore.md) ·
[Database management](docs/admin/database-management.md) ·
[Maintenance](docs/admin/maintenance.md) ·
[Logs](docs/admin/logs.md) ·
[API errors](docs/admin/api-errors.md)

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

Tests run per package on Node's built-in runner — `pnpm --filter @aperture/core test:<area>` and `pnpm --filter @aperture/api test:<area>` (the areas are listed in each `package.json`), and `pnpm --filter @aperture/web test` for the admin registry and the web helpers.

Layout:

- `packages/core` (`@aperture/core`) — all domain logic; the apps consume its compiled `dist/`
- `packages/ui` (`@aperture/ui`) — shared React components
- `apps/api` (`@aperture/api`) — thin Fastify HTTP layer
- `apps/web` (`@aperture/web`) — Vite + React SPA
- `db/migrations` — numbered SQL, applied at startup

After changing an export in `packages/core` or `packages/ui`, rebuild the packages before typechecking the apps.

---

## Tech stack

- **Backend** — Node 20, Fastify 5, TypeScript, PostgreSQL + pgvector, raw SQL (no ORM), pino, node-cron
- **Frontend** — React 18, Vite 6, MUI 6, react-router 7, i18next, assistant-ui, d3, recharts
- **AI** — Vercel AI SDK 5 with providers for OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Ollama and Hugging Face; LM Studio, Z.AI and any other OpenAI-compatible endpoint through the OpenAI-compatible provider
- **Infrastructure** — Docker, pnpm workspaces, GitHub Actions. `:dev` images are amd64; arm64 is built for `main`, release tags and manual workflow runs

---

## License

[GNU Affero General Public License v3.0](LICENSE)
