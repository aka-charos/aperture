# Maintenance

The old "Maintenance" settings tab is gone — its two real features moved to dedicated pages:

![Admin Settings - Maintenance](../images/admin/admin-settings-maintenance.png)

## Poster Repair

**Operations → Poster repair** (`/admin/ops/poster-repair`).

Fixes artwork by pushing **from TMDb to your media server** (not the other way):

1. **Scan** — Aperture asks the media server for items with missing or failed posters
2. **Review** — a table of what was found
3. **Repair selected** — TMDb artwork is fetched and pushed to the media server; the repair runs as a job with progress, and you can cancel it

## Legacy Embeddings

**AI models → Embeddings** (`/admin/ai/embeddings`) — the bottom section appears only when pre-multi-dimension legacy tables exist, with a single **"Drop Legacy Tables"** action to reclaim their space. See [Embedding models](embedding-models.md).

## What No Longer Has a Page

- **Cache management** — caches are database tables with TTLs; there is no flush button
- **Metadata refresh** — that's the [enrichment jobs](global-jobs.md)
- **Health checks** — the Overview page plus job history cover it

---

**Related:** [Jobs overview](jobs-overview.md) · [Embedding models](embedding-models.md) · [Database](database-management.md)
