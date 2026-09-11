# Setup Wizard

The Setup Wizard guides initial Aperture configuration in 11 steps. It appears automatically on first access (from local-network addresses only) and can be re-run at any time via the **Re-run Setup Wizard** button pinned to the bottom of the admin nav column.

![Admin Overview](../images/admin/admin-overview.png)

## Before You Start

Have ready: your media server's URL and **API key** (Emby: Dashboard → Advanced → API Keys; Jellyfin: Dashboard → API Keys), a place on disk Aperture can write to that your media server can also read, and an **AI provider API key** (the wizard requires one — OpenAI is the default suggestion, but every provider catalog is offered).

First-run access is **restricted to local-network addresses** until setup completes, so connecting from the server's own machine or LAN is expected. Admins re-running the wizard get an **exit button** so they can back out without changes; nothing is overwritten until you pass through a step, and returning to a re-run shows your current settings pre-filled.

## The 11 Steps

### 1. Restore

Optionally restore a [backup](backup-restore.md) from a previous instance instead of starting fresh — the fastest migration path. Skip to configure from scratch.

### 2. Connect

Media server **type** (Emby/Jellyfin), **URL**, and **API key**, plus:

- **Discover Servers on Network** — UDP auto-discovery of Emby/Jellyfin instances on the LAN
- **Allow passwordless login** — only for media servers that permit passwordless accounts; carries an exposure warning (see [Media server](media-server.md))

**Test** verifies the credentials and shows the resolved server name.

### 3. Libraries

Per-library **enable switches** fetched from your server, grouped **Movies / TV**. Bulk controls — **Refresh**, **Enable All**, **Disable All** — live right here in the wizard. Everything disabled is invisible to Aperture (see [Libraries](libraries.md)).

### 4. Paths

Where Aperture writes its output (`/aperture-libraries` inside the container) and the path **your media server** uses for the same folder. **Auto-Detect Paths** compares a sample file's path on both sides and computes the mapping — see [File locations](file-locations.md) for the manual version.

### 5. AI Recommendations

Output format per media type — **symlink vs STRM** switches (symlinks recommended; see [Output format](output-format.md)) — and the **library cover image** upload. Library *names* are not set here; they're templates under **Recommendations → Library naming**.

### 6. Validate

Automatic checks, all required before Continue unlocks: **write access** (can Aperture create files?), **media access** (can the media server path see them?), **symlink support** (when symlinks are enabled), and **media-server reachability**. A failure here states which check and why — fix it before proceeding, or switch to STRM in step 5.

### 7. Users

Import and enable users, toggling **Movies / Series** per user. The wizard **refuses to disable the last enabled admin**. Users can also be managed later (see [User management](user-management.md)).

### 8. Top Picks

Enable [Top Picks](top-picks.md) and choose the per-media-type output — **library / collection / playlist** — with symlink toggles. Sources, windows, and auto-request are configured on the Top Picks admin page afterwards.

### 9. AI / LLM

**Mandatory** — the wizard will not finish without it. Four roles must each have a provider, model, and key configured: **Embeddings**, **Chat**, **Text Generation**, and **Exploration**. The step renders as per-role cards (the same ones as [Providers & roles](ai-providers.md)); Continue stays disabled until all four are valid.

### 10. Initial Jobs

The wizard queues the kickoff pipeline — **11 jobs**: library syncs (movies, series), **watch-history syncs** (deliberately before embeddings), movie/series **embeddings**, movie/series **recommendations**, movie/series **library builds**, and optionally Top Picks. This means **recommendations already exist when the wizard finishes** — there is no separate "generate recommendations" step afterwards. Watch the jobs console if you want to see it work ([Jobs overview](jobs-overview.md)).

### 11. Done

A completion summary: created libraries, per-user recommendation counts, **skipped users ("no watch history")**, the schedules that were set, and which features just unlocked. From here, the [Post-setup checklist](post-setup-checklist.md) takes over.

---

**Related:** [Media server](media-server.md) · [AI providers](ai-providers.md) · [Post-setup checklist](post-setup-checklist.md)
