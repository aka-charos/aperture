# Admin Guide

This guide covers initial setup, ongoing operations, and administrative configuration for Aperture.

---

## Getting Started

Start here if you're new to Aperture:

1. [Setup Wizard](admin/setup-wizard.md) — 11-step initial configuration
2. [Post-Setup Checklist](admin/post-setup-checklist.md) — Get recommendations running

### Platform-Specific Guides

| Platform | Guide |
|----------|-------|
| **Windows Docker Desktop** | [Windows Setup Guide](admin/windows-docker-desktop.md) — Docker Desktop + native Emby/Jellyfin |

### Advanced Deployment

| Topic | Guide |
|-------|-------|
| **External Database** | [External PostgreSQL](admin/external-database.md) — Use your own PostgreSQL server |

---

## Setup Configuration

### Media Server

| Topic | Description |
|-------|-------------|
| [Media Server Connection](admin/media-server.md) | Connect to Emby or Jellyfin |
| [Library Configuration](admin/libraries.md) | Select source libraries |
| [File Locations](admin/file-locations.md) | Path mappings for symlinks |

### External Integrations

| Integration | Description |
|-------------|-------------|
| [Integrations Overview](admin/integrations-overview.md) | Summary of all integrations |
| [Trakt](admin/trakt.md) | Rating sync, Discovery source |
| [TMDb](admin/tmdb.md) | Metadata enrichment |
| [OMDb](admin/omdb.md) | Rotten Tomatoes, Metacritic |
| [MDBList](admin/mdblist.md) | Curated lists, Top Picks source |
| [Seerr](admin/seerr.md) | Discovery requests |

---

## AI Configuration

### Provider & Models

| Topic | Description |
|-------|-------------|
| [AI Providers](admin/ai-providers.md) | OpenAI, Ollama, Groq, etc. |
| [Embedding Models](admin/embedding-models.md) | Model selection for vectors |
| [Text Generation Models](admin/text-models.md) | Model for explanations |
| [Chat Models](admin/chat-models.md) | Model for Encore assistant |

---

## AI Recommendations

### Output Configuration

| Topic | Description |
|-------|-------------|
| [Output Format](admin/output-format.md) | STRM vs Symlinks |
| [Library Title Templates](admin/library-titles.md) | Name patterns for libraries |

### AI Features

| Topic | Description |
|-------|-------------|
| [AI Explanations](admin/ai-explanations.md) | Generated "Why *Aperture* picked this for you" text |
| [Algorithm Tuning](admin/algorithm-tuning.md) | Weights and parameters |

---

## Feature Configuration

| Feature | Description |
|---------|-------------|
| [Top Picks](admin/top-picks.md) | Global trending libraries |
| [Shows You Watch](admin/shows-you-watch.md) | Track ongoing series |

### Language defaults (admin)

Under **Admin console → Appearance → Language defaults**, the instance-wide default **UI language** and default **AI output language** (taste synopses, recommendation explanations, assistant replies, etc.) are set. Users can override both under **User Settings → Preferences → Language** (`uiLanguage` / `aiLanguage` in stored preferences; `null` means "use server default"). Supported locale codes match `APP_LOCALE_OPTIONS` in core: `en`, `es`, `de`, `fr`, `it`, `pt`, `nl`, `ru`, `ja`, `zh`, `ko`, `hi`, `ar`, `he`, `el`.

### Gap Analysis (admin)

**Gap Analysis** (**Admin console → Library → Gap analysis**, `/admin/library/gaps`) compares TMDB movie collection membership to your synced `movies` table so you can see which franchise entries are missing. It is **not** the same as user [Discovery](features/discovery.md) (per-user suggestions).

**Prerequisites**

- **TMDb API key** — Admin console → Integrations → TMDB.
- **Collection metadata** — Run the **Enrich metadata** job so movies get `collection_id` from TMDb.
- **Seerr** (optional) — Only needed if you want to request missing titles; requests are always explicit (bulk or single).

**Operations**

- Use **Run analysis** on the page (or run the **`refresh-library-gaps`** job under Operations → Jobs). The job only calls TMDb and your database — it **never** requests content from Seerr automatically.
- Gap-initiated requests are stored with `source: gap_analysis` and appear on **My Requests** with a **Gap Analysis** badge; they can be filtered with the Source dropdown.
- Re-run analysis after large library syncs so counts stay accurate.

**API** — See [Gap analysis (Admin)](api-reference.md#gap-analysis-admin) in the API reference.

---

## Background Jobs

### Job System

| Topic | Description |
|-------|-------------|
| [Jobs Overview](admin/jobs-overview.md) | How jobs work |
| [Job Scheduling](admin/job-scheduling.md) | Configure schedules |

### Job Reference

| Category | Description |
|----------|-------------|
| [Movie Jobs](admin/movie-jobs.md) | Sync, embeddings, recommendations |
| [Series Jobs](admin/series-jobs.md) | Sync, embeddings, recommendations |
| [Global Jobs](admin/global-jobs.md) | Enrichment, Top Picks, backups |

---

## User Management

| Topic | Description |
|-------|-------------|
| [User Management](admin/user-management.md) | Manage users and recommendations |
| [User Permissions](admin/user-permissions.md) | Per-user settings and overrides |

---

## System Administration

### Maintenance

| Topic | Description |
|-------|-------------|
| [Maintenance](admin/maintenance.md) | Poster repair, legacy cleanup |
| [Backup & Restore](admin/backup-restore.md) | Protect your data |
| [Database Management](admin/database-management.md) | Stats and purge |

### Troubleshooting

| Topic | Description |
|-------|-------------|
| [API Errors](admin/api-errors.md) | Error alerts and resolution |
| [Recommended Workflow](admin/recommended-workflow.md) | Best practices |

---

## Quick Reference

### Admin Console Map

Groups in the admin nav (one page per route): **Overview**, **Library** (Media server, Libraries, File locations, Gap analysis), **Integrations** (11 pages), **AI models** (Providers & roles, Embeddings, AI Spend, Cost estimate, Analysis bench), **Recommendations** (Algorithm, Evaluation, Explanations, Output format, Library naming, Top Picks, Shows You Watch, Discovery tuning, Genre strips, Channels web expand), **Appearance** (Branding, Theme colours, Poster display, Language defaults, Translations), **Access** (Users, API keys), **Operations** (Jobs, Backup & restore, Database, Poster repair).

### Default Job Schedule (seeds)

| Schedule | Jobs |
|----------|------|
| Every 30 min | `sync-users` |
| Hourly | `sync-series-watch-history` (movies every 2 h) |
| Every 3 h | `sync-movies` / `sync-series`, staggered library builds |
| Every 6 h | `enrich-metadata`, movie/series embeddings (staggered) |
| Daily 02:00–03:30 | `backup-database` 02:00, `refresh-ratings` 02:30, `reconcile-discovery-requests` 04:30, `sync-lldap-emails` 03:15, `cleanup-auth-state` 03:30 |
| Daily 02:00–03:30 | `backup-database` 02:00, `refresh-ratings` 02:30, `sync-lldap-emails` 03:15, `cleanup-auth-state` 03:30, `reconcile-discovery-requests` 04:30 |
| Daily 05:00–07:00 | `refresh-top-picks` 05:00, `enrich-studio-logos` 05:30, `generate-discovery-suggestions` 06:00, `enrich-mdblist` 07:00 |
| Weekly (Sunday) | `generate-movie/series-recommendations` 04:00, `auto-request-top-picks` 00:00, `refresh-assistant-suggestions` 00:00, `refresh-ai-pricing` 00:00 |

All 34 jobs, seeded — edit per job in **Operations → Jobs** (see [Job scheduling](admin/job-scheduling.md)). The scheduler reads the `job_config` table seeded from these defaults (the definitions file's cron fields are not what it reads). Times follow `TZ` (default `America/New_York`). Missed runs do not catch up.

### Algorithm Defaults

| Weight | Movies | Series |
|--------|--------|--------|
| Similarity | 0.4 | 0.4 |
| Novelty (Genre Discovery) | 0.2 | 0.2 |
| Rating | 0.2 | 0.2 |
| Diversity | 0.2 | 0.2 |

Per-user picks default to **20** from a candidate pool of up to 50,000; reserved slots cover interest, taste-twin, and acclaimed picks. See [Algorithm tuning](admin/algorithm-tuning.md).

### Embedding Models

| Model | Dimensions | Cost |
|-------|------------|------|
| text-embedding-3-small | 1536 | $0.02/1M tokens |
| text-embedding-3-large | 3072 | $0.13/1M tokens |
| nomic-embed-text (Ollama) | 768 | Free (local) |

---

## Support

- [User Guide](user-guide.md) — End-user documentation
- [API Reference](api-reference.md) — Developer API docs
- [Release Notes](release-notes/) — Version history

---

## Document Index

All admin documentation files:

### Setup
- [admin/setup-wizard.md](admin/setup-wizard.md)
- [admin/post-setup-checklist.md](admin/post-setup-checklist.md)
- [admin/windows-docker-desktop.md](admin/windows-docker-desktop.md)
- [admin/media-server.md](admin/media-server.md)
- [admin/libraries.md](admin/libraries.md)
- [admin/file-locations.md](admin/file-locations.md)

### Integrations
- [admin/integrations-overview.md](admin/integrations-overview.md)
- [admin/tmdb.md](admin/tmdb.md)
- [admin/omdb.md](admin/omdb.md)
- [admin/mdblist.md](admin/mdblist.md)
- [admin/trakt.md](admin/trakt.md)
- [admin/seerr.md](admin/seerr.md)
- [admin/lldap.md](admin/lldap.md)
- [admin/n8n.md](admin/n8n.md)
- [admin/tavily.md](admin/tavily.md)
- [admin/crw.md](admin/crw.md)
- [admin/streaming.md](admin/streaming.md)
- [admin/ratings-refresh.md](admin/ratings-refresh.md)

### AI Configuration
- [admin/ai-providers.md](admin/ai-providers.md)
- [admin/embedding-models.md](admin/embedding-models.md)
- [admin/text-models.md](admin/text-models.md)
- [admin/chat-models.md](admin/chat-models.md)
- [admin/ai-spend.md](admin/ai-spend.md)
- [admin/cost-estimate.md](admin/cost-estimate.md)
- [admin/analysis-bench.md](admin/analysis-bench.md)

### Appearance
- [admin/branding.md](admin/branding.md)
- [admin/theme-colors.md](admin/theme-colors.md)
- [admin/poster-display.md](admin/poster-display.md)
- [admin/language-defaults.md](admin/language-defaults.md)
- [admin/translations.md](admin/translations.md)

### AI Recommendations
- [admin/algorithm-tuning.md](admin/algorithm-tuning.md)
- [admin/ai-explanations.md](admin/ai-explanations.md)
- [admin/output-format.md](admin/output-format.md)
- [admin/library-titles.md](admin/library-titles.md)
- [admin/evaluation.md](admin/evaluation.md)
- [admin/discovery-tuning.md](admin/discovery-tuning.md)
- [admin/genre-strips.md](admin/genre-strips.md)
- [admin/channels-web-expand.md](admin/channels-web-expand.md)

### Features & Library
- [admin/top-picks.md](admin/top-picks.md)
- [admin/shows-you-watch.md](admin/shows-you-watch.md)
- [admin/gap-analysis.md](admin/gap-analysis.md)
- [admin/overview.md](admin/overview.md)

### Jobs
- [admin/jobs-overview.md](admin/jobs-overview.md)
- [admin/job-scheduling.md](admin/job-scheduling.md)
- [admin/movie-jobs.md](admin/movie-jobs.md)
- [admin/series-jobs.md](admin/series-jobs.md)
- [admin/global-jobs.md](admin/global-jobs.md)

### Users & Access
- [admin/user-management.md](admin/user-management.md)
- [admin/user-permissions.md](admin/user-permissions.md)
- [admin/api-keys.md](admin/api-keys.md)
- [admin/deployment.md](admin/deployment.md)

### Operations
- [admin/jobs-overview.md](admin/jobs-overview.md)
- [admin/job-scheduling.md](admin/job-scheduling.md)
- [admin/movie-jobs.md](admin/movie-jobs.md)
- [admin/series-jobs.md](admin/series-jobs.md)
- [admin/global-jobs.md](admin/global-jobs.md)
- [admin/maintenance.md](admin/maintenance.md)
- [admin/backup-restore.md](admin/backup-restore.md)
- [admin/database-management.md](admin/database-management.md)
- [admin/logs.md](admin/logs.md)
- [admin/api-errors.md](admin/api-errors.md)
- [admin/recommended-workflow.md](admin/recommended-workflow.md)
- [admin/external-database.md](admin/external-database.md)
- [admin/windows-docker-desktop.md](admin/windows-docker-desktop.md)
