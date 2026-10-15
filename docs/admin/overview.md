# Overview

The landing page of the admin console — how the instance is doing at a glance, and what to do next when it isn't set up yet.

## Where It Lives

Admin console → **Overview** (`/admin`).

## The Cards

**System Status** — polls `/health` every 30 seconds. "All systems operational" or "System issues detected", with server time, **version**, and **database connected/disconnected** as detail rows.

**Quick Stats** — total users, **AI Enabled Users** (accounts with Aperture access, the switch on the [Users](user-management.md#access) page), and **Movies in Library**.

**Setup Status** — a four-point checklist: Media server connected · Database connected · Movies synced · Users enabled (at least one account has access) — with a **Complete** chip when all four pass.

**Getting Started** *(only while the checklist is incomplete)* — the six steps in order: configure the media server → select libraries → run Sync Movies → enable users → generate embeddings → generate recommendations — with a **Go to Jobs** button straight to the jobs console. The card's wording predates the console: the media server is under **Library → Media server**, libraries under **Library → Libraries**, and the jobs are `generate-movie-embeddings` and `generate-movie-recommendations` (and their series counterparts).

## When Something Looks Wrong Here

- **Database disconnected** — check the Postgres container and `DATABASE_URL` (see [External database](external-database.md))
- **Movies synced unchecked** — run `sync-movies` from [Jobs](jobs-overview.md); if it fails, check the media-server connection on [its page](media-server.md) and the [API errors](api-errors.md) panel
- Version shows the **upstream lineage + fork build** (e.g. `0.7.8-mod.<n>`); "dev" means a locally built image without CI version args

---

**Related:** [Setup wizard](setup-wizard.md) · [Post-setup checklist](post-setup-checklist.md) · [Jobs overview](jobs-overview.md)
