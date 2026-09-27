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

**This README is written as a delta against upstream v0.7.8**, in three layers:

- [At a glance](#at-a-glance) — what the fork **added**, what it **enhanced** and what it **fixed**, one line per area.
- [What this fork changes](#what-this-fork-changes) — the same ground area by area. Each section is marked **new** or **reworked**, and a reworked one opens with what upstream already had.
- [What this fork fixes](#what-this-fork-fixes) — defects in code inherited from upstream, grouped by area.

What arrived unchanged is under [Inherited from upstream](#inherited-from-upstream). Every commit behind all of this is classified in [docs/fork-divergence.md](docs/fork-divergence.md). Of 511 commits:

- **46** add something upstream had no form of.
- **225** enhance something upstream already had.
- **81** fix a defect in inherited code, and **45** more fixes ride inside other commits.
- **100** fix the fork's own work.
- The rest are docs, chores and measurement.

### At a glance

**Added** — capabilities upstream had no form of.

| Area                  | What the fork added                                                                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title analysis**    | An optional critic-informed article per title, written from self-hosted search (fastCRW) or Google grounding, plus a bench that runs several models and prompt versions on byte-identical sources.                                |
| **Emby home screen**  | Top Picks, each viewer's own picks and playlists they choose, as rows on every viewer's Emby home screen — placed per row type by the admin, with viewer overrides. No duplicate items and no STRM files.                         |
| **Sharing**           | Admin-paired connections: see who you know watched a title, browse each other's history, recommend a title to someone, and a "Shared with me" inbox.                                                                              |
| **Watch state**       | Watched ticks and `8/24` episode progress on posters; rating a film the server never saw play asks roughly when you watched it and marks it played.                                                                               |
| **Requests & issues** | Problem reports filed in Seerr under the reporter's own account, with threaded replies; search-and-request inside the app; a franchise page listing what is owned, missing and announced.                                         |
| **AI**                | Web Search and Title Analysis roles; LM Studio and Z.AI providers; reasoning-effort and sampling controls in each model's own vocabulary; fallback models and keys; a spend dashboard that measures what calls cost.              |
| **Recommender**       | Taste twins, reserved slots for stated interests and acclaimed titles, taste clustering, era affinity, an activity gate that skips pointless regenerations, and a job to rebuild every taste profile.                             |
| **Evaluation**        | An offline retrieval harness — held-out ranking against baselines, nearest-neighbour dumps, every stored embedding set measured — archived and exported as CSV.                                                                   |
| **Branding & text**   | Rename the instance, mount your own logo and favicon, set brand colours, edit any UI string in-app or via CSV, restrict which languages users may pick, and a Greek locale.                                                       |
| **Admin & security**  | Read-only "view as user", a deployment-posture panel that checks against live traffic, runtime-editable trusted proxies, a record of every permission change, LLDAP email import, n8n, Tavily and a nightly IMDb ratings refresh. |

**Enhanced** — things upstream had, reworked.

| Area                       | What changed                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI roles & providers**   | Model picker with prices, tool-calling and reasoning badges from live catalogs; real capability detection for OpenRouter and local servers; one provider key shared across roles; provider errors logged in the provider's own words. |
| **Embeddings**             | A 2560-wide table, a stored-sets panel showing what switching would cost, mean-centred vectors, retrieval modes where a model supports one, and a canonical text that stopped embedding nationality six times.                        |
| **Recommender**            | MMR diversity, availability-adjusted genre preference, completion-weighted series, match insights on every scored title, explanations written from real data, and an explanations-only rerun.                                         |
| **Assistant**              | Intent routing with a grounded web search, a taste-profile section on every discovery answer, dock and full page, live status, turns saved by the server, episode search and stored analyses.                                         |
| **Discovery & requests**   | Candidates embedded and ranked by taste, a tuning panel with measured influence, requests filed as the person who made them, and in-app approve/decline.                                                                              |
| **Watch stats & history**  | Every figure opens the titles behind it; heatmap and taste-vs-crowd sections; whole-history search; a Watcher Identity written from played titles by each recommendation run.                                                         |
| **Browse, search, detail** | A searchable country filter, search that ignores accents and punctuation and matches original titles, detail pages that state each fact once, and collections written to Emby as Box Sets.                                            |
| **Admin console**          | A two-level nav generated from one registry — 8 groups, 45 sections — with a ⌘⇧K palette over sections, individual settings and every job.                                                                                            |
| **Access**                 | Access as its own switch, library access that follows the media server, permissions decided on the server, scoped API keys, and an assistant permission.                                                                              |
| **Jobs**                   | Weekly schedules on several weekdays, biweekly runs, cancellation that holds a slot until the work stops, a stall guard on streamed model calls, per-run caps and logs that keep their head.                                          |

**Fixed** — defects in code inherited from upstream. The worst of them:

| Area                        | What was broken                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Security**                | Any request carrying `x-internal-request: true` passed admin checks on about 163 endpoints, including the one returning the media-server API key. Session tokens were stored verbatim, API keys carried full admin authority, and an image proxy answered without a session. |
| **Library access**          | Every viewer saw every enabled library whatever their media-server account could open, and a pick from a hidden library was playable through their own generated library.                                                                                                    |
| **Lost data**               | Pressing Regenerate deleted the viewer's Watcher Identities, excluded libraries and algorithm settings. A run with no picks could delete generated libraries from disk, and restoring an uploaded backup always failed.                                                      |
| **Watched vs favourited**   | Favouriting a title counted as watching it in about fifteen places, from Home's tiles and Watch Stats to the assistant.                                                                                                                                                      |
| **Recommender**             | Disliked titles still pulled the taste profile toward them, "% Match" could pass 100%, a 20% diversity setting acted as a hard sort by genre, and favourites were recommended back.                                                                                          |
| **Discovery & requests**    | Discover's taste term never ran, so popularity decided half the ranking, and every request was filed as the admin and auto-approved.                                                                                                                                         |
| **Enrichment & embeddings** | Adding an OMDb key later did nothing, OMDb's quota errors retired titles as "not found", and enriched keywords never reached the embeddings.                                                                                                                                 |
| **Assistant & search**      | Leaving a chat mid-turn lost the exchange, a resumed conversation never saved new turns, and searching a title with a colon returned an error shown as "No results".                                                                                                         |

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

Everything in this section is fork work on top of upstream v0.7.8. Each heading says whether the area is **new** or **reworked**; a reworked section opens with what upstream already had, so the bullets read as the difference. Defects repaired along the way are listed separately under [What this fork fixes](#what-this-fork-fixes).

### AI providers and models — reworked

Upstream had four AI roles — embeddings, chat, text generation and exploration — across nine providers, with a static model catalog and a cost estimator.

- **Two more roles**, web search and title analysis, each with its own provider, model, key and options.
- **Two more providers**, LM Studio and Z.AI (GLM), making eleven: OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Z.AI, Hugging Face, Ollama, LM Studio and any OpenAI-compatible endpoint.
  - Embeddings run on OpenAI, Google, OpenRouter, Ollama, LM Studio or an OpenAI-compatible server; the others supply the text roles.
  - LM Studio is asked what it has installed and offers only the models that can hold the role being configured.
  - Z.AI takes either its international or its mainland endpoint.
- **The model picker shows price, tool-calling and reasoning support**, read from OpenRouter's live catalog where the static one has nothing. Capabilities are detected rather than assumed, including on Ollama and LM Studio, and a custom model is refused until it passes a connection test.
- **Reasoning effort** per role, offered in each model's own vocabulary rather than an invented one, because a reasoning model bills its scratchpad from the same output allowance as the answer.
- **Sampling controls** — temperature and top-p on the Title Analysis role, offered only for models that declare them. Unset sends nothing, so the provider default stands.
- **Fallback models and fallback API keys** for free-tier work — extra Google keys for grounded web search, and a chain of fallback models (on any provider, local ones included) for title analysis — with call pacing and per-key cooldowns. A spare key answers "this account is out of quota", a spare model answers "this model is gone".
- **Spend dashboard** beside the cost estimator, measuring what calls actually cost: OpenRouter's billed figure, and Z.AI's computed from its published prices and labelled as an estimate. Unpriced calls are reported as unknown, never as $0.
- **Readable provider failures** — errors are logged with status, model and the provider's own words instead of the whole prompt, and a Z.AI address missing its API path is named as such rather than reading as a dead key.
- Sibling key resolution: configure a provider once and every role on that provider reuses it.

### Embeddings — reworked

Upstream already stored embeddings per model in one table per width (256 to 4096), so switching models left the old set in place.

- **A 2560-wide table**, for models such as pplx-embed whose native width had nowhere to live.
- **Stored-sets panel** showing every set, its coverage, its dates and exactly what switching would cost — re-embed → re-centre → rebuild taste profiles → regenerate.
- **Mean-centred vectors**: subtracting what every title in the library has in common measurably improved retrieval, and centring runs at the end of each embedding job rather than being a chore to remember.
- **Retrieval mode** offered only for models that document how to carry one, delivered as a request parameter or a text prefix depending on the model.
- **Canonical text reworked** — six of fifteen fields were nationality-coded, so the vector partly worked as a nationality detector; content rating, awards and composers came out, and OMDb's longer plot came in. A change to the text now re-embeds the rows it affects.
- **Episode embeddings get a reader** — the assistant's episode search — and a setting that decides whether they are made at all.
- **Offline evaluation harness** (`evaluate-recommender`) so a retrieval change can be measured instead of argued about: held-out ranking against random and rating-only baselines, nearest-neighbour dumps raw and centred side by side, every stored set measured, results archived and exported as CSV.

### Recommender — reworked

Upstream built one taste vector per viewer, scored candidates on similarity, novelty and rating, applied a genre-coverage sort for variety and wrote an AI explanation for each pick.

- **MMR diversity** replaces the genre-coverage sort, which let one Drama close Drama for the rest of the list.
- **Reserved slots** for things the ranking will never reach on its own: **stated interests**, **taste twins** (the viewer whose history overlaps yours far more than chance), and **acclaimed titles**. Every slot count is admin-visible; there are no hidden shares underneath.
- **Taste clustering** — a profile splits into up to three clusters, so a viewer with two distinct tastes is not averaged into one vector that matches neither.
- **Era affinity** — decade preference measured against the viewer's own shelf (movies).
- **Genre preference is availability-adjusted**, not volume-based: someone who hides the horror library no longer reads as horror-averse.
- **Engagement weighting** by how much of a series was actually finished, so forty abandoned shows stop outvoting five finished ones.
- **Activity gate** — a scheduled run skips users whose library and history have not changed enough to move a pick; a manual run always runs. A `rebuild-taste-profiles` job applies a change in how taste is computed to everyone at once.
- **One Recommendations switch per account.** Whether someone gets film picks, series picks or both follows from which libraries their media-server account can open, and picks are drawn only from those libraries.
- **Match insights on every scored title**, not just the twenty that were picked: blended score, preference adjustment, per-term weight shares, variety, and the titles in your own history that support the pick — with a different, honest heading when the pick came from a reserved slot and the ranking is not the reason.
- **Explanations** are written from real data (plot, keywords, directors, neighbours in your history, and the title's stored analysis where one exists) under a no-invention rule, and can be re-run on their own without re-scoring.
- **Admin controls** for preference strength, gate thresholds, slot budgets and candidate pool size, with the pool bounded by the number of items that actually exist.

### AI assistant — reworked

Upstream had the chat assistant: a dialog with library tools for search, history, ratings, people and recommendations.

- Chat that **routes each turn**: library questions search your shelf, discovery questions run a grounded web search and resolve the results back against your library by IMDb ID → TMDB ID → title + year.
- A discovery answer comes from **three directions in one step** — web picks, neighbours of any title you named, and a **From your taste profile** section that searches the titles the recommender already scored for you using your own words. The third runs in parallel with the web search, so it adds no wait.
- Available as a **dockable side panel** and a full **`/assistant`** page as well as the dialog. The server saves each turn itself, and a conversation renders in the order it was written.
- **Live phase status** ("searching the web", "checking your library") in place of a static spinner, and cards that stream in rather than waiting for the slow part.
- New tools for episode search, stored title analyses, franchises and a library-scoped personalized search over the pool the recommender already scored.
- **National cinema is searchable** (country, not language — languages are populated for under 1% of a real library), with ~120 demonyms mapped to the stored country names.
- Rich cards with synopsis, grounded reason, director, favourite and watched state; open a title in place without leaving the conversation.
- **Build a playlist or collection from chat picks**, carrying the request that produced them.
- Optional **unwatched-only** mode, and suggestion chips drawn from your newest completed run.
- Every result is limited to the libraries you can open, and the assistant can be switched on or off per account.

### Discovery, requests and issues — reworked

Upstream had the discovery engine for content you do not own, requests through **Jellyseerr / Overseerr**, the My Requests page and gap analysis.

- **Discover ranks by taste now.** Candidates are embedded as they arrive, since a title you do not own has no stored vector, and popularity is compared within each source rather than across three units.
  - The detail card states the taste match as a rank — "#12 of 245" — rather than a percentage that always spans 0–100.
  - Fetch sizes, filters and weights are admin-tunable under **Discovery tuning**, with each term's measured influence shown beside its configured share.
- **Search and request from inside the app** on My Requests, with films and TV shows in separate sections and "already in your library" decided by Aperture's own tables rather than Seerr's.
- **Requests are filed as the person who made them** — under their own Seerr account, so quotas and auto-approval follow their Seerr permissions rather than the admin's. Admins can approve or decline from the app and choose the server, quality profile and root folder; viewers get their Seerr defaults and never see server paths.
- **Report a problem** (new) with a title — video, audio, subtitles or something else, for the whole title, a season or an episode — from its detail page. Reports are real Seerr issues under the reporter's own account, so Seerr's notifications name the right person, and replies thread under each report on the **Issues** tab of My Requests.
- **Grounded web search** as its own AI role, with Google grounding plus **Tavily** as a second source; sources compose and fall back for one another, and free-tier grounding quota is metered per key with automatic rotation.
- The taste brief personalises **which candidates win, never which searches run** — the profile is structurally unable to reach a search call.
- **Franchise page** (new) for every TMDB collection — what you own, what is missing and what is announced — with a request button only where a request would actually do something.
- **Gap analysis** lists the missing films inline, closest to complete first, each row linking to its franchise page.
- **Missing episodes and seasons** surfaced on series pages and Shows You Watch, with per-season requests.

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

### Watch state and ratings — new

- **Watched state on posters** across browse, detail pages, Top Picks, recommendations and chat cards — a tick on a finished film or show, and a watched/total fraction such as `8/24` on a show you are part-way through. Counted against the episodes your library holds, specials excluded, so owning one season of five and finishing it counts as finished.
- **Rating a film the server never saw play asks roughly when you watched it** — this month, last month, earlier this year, last year, or longer ago — and marks it played on the media server with that date. Estimated dates count as watches but stay off the time-based charts, and a real play later clears the estimate.
- **Mark Watched** and a media-server favourite toggle on movie pages.

### Sharing between users — new

- An admin **connects** two accounts from the Users page. Connections are mutual, and the other person is visible only while their account has access.
- Connected viewers see **who they know watched a title** on its detail page, can **browse each other's watch history**, get a **row of each other's recent watches** on the dashboard, and can **recommend a title** to one another.
- **Shared with me** collects the recommendations sent to you, with a count in the sidebar; a title leaves on its own once you finish it.
- Everything shown from someone else's activity is filtered to the libraries _you_ can open. Admins see every watcher's name; everyone else sees names only for their connections.

### Watch statistics — reworked

Upstream had the Watch Stats page — genres, decades, ratings, people, studios and networks — and a Watcher Identity written from a genre-to-adjective table.

- **New sections**: a time-of-day heatmap, a rewatch breakdown, TV vs film time, a busiest day and a "your taste vs the crowd" comparison.
- **Every figure on the page opens the titles behind it**, counted with the same SQL that produced the number, so a "7 films" chip cannot open five.
- **Watcher identity** — an analysis of what your viewing says about you, written from the films and shows you actually played compared against what your library holds, naming real titles and people. The recommendation run rewrites it whenever your taste profile moves, so it no longer waits for someone to find a button.

### Browse, detail pages and the rest of the UI — reworked

- **Production-country filter** with search, multi-select and AND/OR matching, plus a searchable network filter and reordered content ratings.
- **Library search** ignores accents and punctuation, matches original titles as well as localized ones, and ranks by how much of your query a title contains.
- **Detail pages say each thing once** — ratings and awards on the hero line, director and writer beside them, one info card below; the duplicate genre, critic-rating and awards panels are gone.
- **Series detail** with per-season and per-episode progress and inline episode descriptions.
- **Person pages** gain a biography and birth/death data from the media server.
- **Shows You Watch** includes series from watch history, with a segmented bar combining progress, availability and what is missing, and Airing/Ended tabs driven by TMDB status.
- **Watch history** searches the whole history rather than the loaded page, with status filters and real resume bars.
- **Collections** (new) — channels written to Emby as Box Sets, with a per-user permission to create them. Channels also build from TV series now, with a preview-and-approve step and an AI note on each pick before anything is written.
- **Cross-media connections** in the Explore graph — films to series and back.
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

### Branding, languages and text — new

- **Rename the instance** — the name reaches all 15 locales and the browser tab from the first byte.
- **Mount your own logo and favicon** (`BRANDING_DIR`) and set the two brand colours from the UI.
- **Edit any UI string** in the app or via CSV round-trip, or drop `overrides.<lng>.json` into `I18N_OVERRIDES_DIR` to customize text without rebuilding the image.
- **Language allowlists** — choose which UI and AI languages users may pick, and the default for each.
- **Greek (el) added**, bringing the locale count to 15; ar and he render right-to-left.
- **Configurable media-server display name** used throughout the UI, and a separate public URL for user-facing media-server links.

### Security, access and deployment — reworked

Upstream had sessions, API keys and per-user feature switches.

- **Access is its own switch.** Turning it off ends sign-in, sessions and API keys at once and stops every piece of per-user work, while leaving each feature switch as it was — so letting someone back in restores their setup. Features can be set up before access is granted, and an admin cannot switch off their own access.
- **Library access follows the media server.** Each viewer sees only the libraries their Emby/Jellyfin account can open (and that are enabled here), within their parental-rating limit — in browse, search, similar titles, the Explore graph, detail pages, the assistant and their generated libraries. A title outside that scope answers exactly like one that does not exist.
- **Feature permissions** — Discover, requests, Collections, the assistant, email notifications, watch-history management — are decided on the server from the session, and the sidebar shows only what the server says the viewer can use.
- **Scoped API keys** — `read`, `write` and `admin`. New keys are read-only; a scope can narrow what the account behind a key may do, never widen it.
- **Every permission change is recorded** — who changed what, including switches that moved because another one did.
- **Every route declares who may call it**, enforced by a test.
- **Admin "view as user"** — see the app exactly as another user sees it, read-only, on a one-hour lease, with a persistent banner and an exit that is always on screen. The admin's own session is never swapped out.
- **Deployment posture panel** that checks configuration _against live traffic_: an instance behind a tunnel with no trusted proxy looks perfectly healthy from config alone, so it watches for forwarded headers it is not trusting.
- **Trusted proxies editable at runtime**, applied without a restart.
- Session hardening (hashed tokens, 30-day absolute lifetime, 7-day idle timeout, immediate revocation on disable), per-account login lockout alongside the IP rate limit, and a cleanup job for both.
- **Optional LLDAP email import**, with email, login and activity shown on Admin → Users.
- Search engines told to stay away from the instance.

### Jobs and operations — reworked

Upstream had the jobs console with editable daily, weekly and interval schedules.

- **Weekly schedules on as many weekdays as you like, and biweekly**, with the next run date shown from the same resolver the scheduler uses.
- **Cancellation that works**: a cancelled job holds its slot until it actually stops, and a refused start says why instead of silently doing nothing.
- **Stuck model calls end** — a streamed call that goes silent for ten minutes is abandoned, and Stop reaches into a call that is still in flight rather than waiting for it.
- **Per-run item caps** where a job declares one — title analysis takes a titles-per-run limit, applied to manual and scheduled runs alike.
- **Log windowing** that keeps the head as well as the tail, and says how many entries were actually lost.
- A boot check that names schedule rows for jobs this build no longer has.
- Poll-log quieting, URL masking, and credentials redacted from settings logs.
- **n8n integration** (new) — webhook client with timeout and auth, a provider-agnostic `search_web` tool, and an optional pre-processing hook on the chat pipeline that fails open if n8n is unreachable.

---

## What this fork fixes

Defects in code inherited from upstream, grouped by area. Each line is something a user or an admin could hit. The full list, with the commit behind each fix, is in [docs/fork-divergence.md](docs/fork-divergence.md).

### Security and access

- Any request carrying `x-internal-request: true` passed every admin check — about 163 endpoints, including the one that returns the media-server API key. Session ids were stored verbatim as bearer tokens, disabled accounts could still sign in, the `Secure` cookie flag was dropped behind a TLS proxy, and login was an unmetered relay to the media server.
- An API key carried its account's full admin authority, and five routes answered without a session — among them a proxy for any media-server image path, using the admin key.
- The request dialog showed every viewer the server's library paths and let them file into any of them.
- Request rights could be granted to an account with Discover switched off, because the rule lived only in the browser.
- Accounts switched off one switch at a time stayed enabled — still signing in, API keys still working — and an account disabled on the media server kept its sessions and keys.
- Every viewer saw every enabled library — in browse, search, similar titles, the Explore graph, detail pages and the assistant — whatever their media-server account could open.
  - Recommendations and generated libraries ignored that too, so a pick from a hidden library was playable through the viewer's own generated library.
  - The parental rating applied on only three surfaces, and the series pipeline compared ages against rating values.
- The public info endpoint handed the internal media-server address to non-admins, and `/robots.txt` answered with the app shell, which crawlers read as permission to index everything.

### Data that was lost or never saved

- Pressing Regenerate deleted the viewer's whole preferences row — both Watcher Identities, excluded libraries and algorithm settings — and a movie full reset deleted every series run as well.
- A recommendation run that could produce no picks was recorded as completed, which blanked the page and let the library writer delete generated libraries from disk.
- Restoring a database from an uploaded backup always failed.
- Leaving a chat mid-turn lost both the question and the answer, and a resumed conversation never saved new turns.
- A playlist's description never reached the media server, and a channel's free-text preferences were stored but never used.
- Adding a custom interest had never worked: every add was rejected and the page hid the failure.

### Watched, favourited and rated

- Favouriting an unwatched title counted as watching it in about fifteen places: Home's watched tile, Browse's watched filter, the community counters and names, Watch Stats, watch history, assistant ticks, Explore, channels and Top Picks. Discover drew its personalised seeds from bookmarks.
- The detail page decided "watched" by scanning the first 100 titles of the history alphabetically, so anyone past 100 films was offered Mark Watched on films they had finished.
- Watch Time — on Watch Stats and on the dashboard — counted movie runtime only.
- Watch-history search only filtered the page already loaded, so older titles seemed not to exist.
- Long-ended shows sat under Airing because the media server's series status goes stale.

### Recommendations

- A title rated 1–3 still pulled the taste profile toward itself, and the rating curve peaked at 5/10. Two preference scorers guessed the rating scale the same way, so a genre rated 3/10 nudged picks up.
- "% Match" could exceed 100%, and the diversity blend overwrote the score behind it, so raising diversity dragged every badge down.
- A 20% diversity setting acted as a hard sort by genre coverage, which also made picks overlap heavily between users.
- Similarity bought about a tenth of its configured influence, novelty was measured against 50 favourites rather than the watch history, and a clamped dispersion score cut everyone's diversity weight by 0.7.
- Genre preference measured volume rather than preference, so a comedy-heavy library made comedy read as beloved.
- Titles already favourited were recommended back, and a recommendation cited itself as its own evidence at 100%.
- Explanations went generic whenever one malformed JSON byte replaced a batch of ten with a template, and were generated and paid for with AI explanations switched off.
- The insights panel's numbers could not add up, and it captioned distant titles as the reason for a pick.
- Nothing ever wrote the Watcher Identity except a button, although five features — explanations, the assistant, discovery, channels and suggestion chips — read it and silently lost their personalisation without it.

### Discovery and requests

- Discover's taste term never ran: candidate vectors were looked up in the library they had just been excluded from, so half the blend was a constant. Ratings were discarded, the job could not be cancelled and the pool grew without bound.
- Every request the app submitted was filed as the admin and auto-approved, whatever the requester's own Seerr permissions said, and Emby users were matched to Seerr by username alone.
- Discovery kept running for viewers the media server had disabled.
- Clicking a Discovery poster fired a request instead of opening its details. Gap analysis froze the browser on large libraries and opened owned films as if they were missing.

### Metadata, embeddings and AI providers

- A library enriched before OMDb was configured was stamped complete forever, and OMDb's quota and bad-key errors (HTTP 401) were recorded as "not found".
- Enriched keywords, awards and crew never reached the embeddings, and changing the embedded text never re-embedded anything.
- Ratings froze on the day a title was first enriched, so recent films were systematically overrated.
- Production countries were stored in three vocabularies at once, so country filters missed titles.
- The embeddings job reported "API key is missing" while settings showed the key, OpenAI-compatible embeddings failed on their first batch, and Hugging Face was offered for embeddings it cannot produce.
- AI playlist naming failed without a role-specific key, and asked for so few tokens that reasoning models came back empty.
- OpenRouter and OpenAI-compatible providers could not be chosen for Chat, deleting a custom model always failed, and the cost estimator showed $0.00 for every OpenRouter setup.
- Local model calls were cut off at five minutes, and a cancelled Ollama generation kept running.

### Assistant and search

- Library search returned an error — shown as "No results" — for any title containing a colon or ampersand, and ranked "Terminal" above "Terminator 2".
- Library semantic search was silently off unless the embeddings ran on OpenAI.
- Assistant lookups compared English titles only, hiding about 30% of films, and its writer, director and tag filters matched nothing.
- A turn could end with no answer at all, or stop mid-sentence; play links were detected by the English word "play", which broke them in 13 of 14 locales.

### Jobs and admin

- A cancelled job freed its slot while still running, so a second run started beside it. The Schedule tab's enable switch reset a job to "daily at midnight", and a refused start showed nothing.
- Orphaned schedule rows from old job renames failed every night with "Unknown job".
- The database purge could not run on any instance created after migration 0078.
- One failing MDBList job wrote an alert per request, and resolved alerts could never be cleared.
- The welcome guide reopened on every refresh of every page.

---

## Inherited from upstream

These arrived with upstream v0.7.8. Several have been reworked since — the reworked sections above say how — but the base came from upstream:

- **Per-user recommendation libraries** written into your media server as STRM files or symlinks, with NFOs, artwork and subtitles preserved.
- **The recommender's core**: embeddings stored per model in one table per width (256 to 4096), a taste profile per viewer, scoring on similarity, novelty and rating, and an AI explanation per pick.
- **The AI assistant** with its library tools, and **four AI roles** — embeddings, chat, text generation, exploration — across nine providers, with a cost estimator.
- **Discovery** of content you do not own, with **Jellyseerr / Overseerr** requests, the **My Requests** page and **gap analysis** of TMDB collections.
- **Top Picks** — global, popularity-driven libraries, collections or playlists, with rank badges on posters and optional automatic requesting of missing entries.
- **Watch history, Watch Stats and Shows You Watch**, **1–10 star ratings** from any poster, and **Trakt.tv** sync.
- **Browse, global search**, the similarity graph and graph playlists, channels and playlists, the franchises list, person and studio pages, and the dashboard.
- **API keys** and per-user feature switches, **the 11-step setup wizard**, the jobs console (25 jobs at the fork point), and automatic daily database backups with restore from setup or the admin console.
- **TMDB, OMDb, MDBList, JustWatch and Seerr** integrations, and the interface in 14 languages.

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
- [`docs/fork-divergence.md`](docs/fork-divergence.md) — every commit this fork carries over upstream, classified as added, enhanced, fixed (upstream code or fork code), docs and chores, or experiments, with a one-line account of each. A machine-readable copy sits beside it as `docs/fork-divergence.tsv`.

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

The fork-divergence record is kept current with `scripts/fork-commit-bundle.mjs`. Bundle the commits into readable evidence files under the gitignored `.zcode/fork-classify/`:

```bash
node scripts/fork-commit-bundle.mjs --diff-cap 0
```

Then classify the new commits into a `verdicts-NN.tsv` there, and rebuild the docs:

```bash
node scripts/fork-commit-bundle.mjs --assemble
```

Existing verdicts are read back from `docs/fork-divergence.tsv`, so only the new commits need classifying.

---

## Tech stack

- **Backend** — Node 20, Fastify 5, TypeScript, PostgreSQL + pgvector, raw SQL (no ORM), pino, node-cron
- **Frontend** — React 18, Vite 6, MUI 6, react-router 7, i18next, assistant-ui, d3, recharts
- **AI** — Vercel AI SDK 5 with providers for OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Ollama and Hugging Face; LM Studio, Z.AI and any other OpenAI-compatible endpoint through the OpenAI-compatible provider
- **Infrastructure** — Docker, pnpm workspaces, GitHub Actions. `:dev` images are amd64; arm64 is built for `main`, release tags and manual workflow runs

---

## License

[GNU Affero General Public License v3.0](LICENSE)
