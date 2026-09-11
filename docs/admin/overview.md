# Overview

The landing page of the admin console — how the instance is doing at a glance, and what to do next when it isn't set up yet.

## Where It Lives

Admin console → **Overview** (`/admin`).

## The Cards

**System Status** — polls `/health` every 30 seconds. "All systems operational" or "System issues detected", with server time, **version**, and **database connected/disconnected** as detail rows.

**Quick Stats** — total users, **AI Enabled Users** (how many accounts have media access), and **Movies in Library**.

**Setup Status** — a four-point checklist: Media server connected · Database connected · Movies synced · Users enabled — with a **Complete** chip when all four pass.

**Getting Started** *(only while the checklist is incomplete)* — the six steps in order: configure the media server → select libraries → run Sync Movies → enable users → run Generate Embeddings → run Generate Recommendations — with a **Go to Jobs** button straight to the jobs console.

## When Something Looks Wrong Here

- **Database disconnected** — check the Postgres container and `DATABASE_URL` (see [External database](external-database.md))
- **Movies synced unchecked** — run `sync-movies` from [Jobs](jobs-overview.md); if it fails, check the media-server connection on [its page](media-server.md) and the [API errors](api-errors.md) panel
- Version shows the **upstream lineage + fork build** (e.g. `0.7.8-mod.<n>`); "dev" means a locally built image without CI version args

---

**Related:** [Setup wizard](setup-wizard.md) · [Post-setup checklist](post-setup-checklist.md) · [Jobs overview](jobs-overview.md)
