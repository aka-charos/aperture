# Database Management

View database statistics and purge stored data — the destructive controls.

![Admin Settings - System](../images/admin/admin-settings-system.png)

## Where It Lives

Admin console → **Operations** → **Database** (`/admin/ops/database`).

## Statistics

Live counts, grouped:

| Group | What's counted |
|-------|----------------|
| **Content Library** | Movies, series, episodes, total titles |
| **AI Embeddings** | Movie / series / episode vectors |
| **User Data** | Watch history, ratings, recommendations, taste profiles |
| **AI Assistant** | Conversations and messages |

## Purge Content Database

The one destructive action on the page: **"Purge Content Database"** deletes everything **except user accounts and library config**:

- All content: movies, series, episodes
- All embedding tables (every vector set)
- Watch history, user ratings, preferences
- Recommendations, candidates, evidence
- AI assistant conversations, messages, and suggestions

To run it you must type **`yes I am sure`** (case-insensitive) — the button stays disabled until the phrase matches.

## After a Purge

Users, permissions, library configuration, and integrations survive. To rebuild:

1. `sync-movies` / `sync-series`
2. `sync-movie-watch-history` / `sync-series-watch-history`
3. `generate-movie-embeddings` / `generate-series-embeddings`
4. `generate-movie-recommendations` / `generate-series-recommendations`

For a full reset *including* users, drop the database and let migrations recreate it (see [External database](external-database.md)) — or restore a [backup](backup-restore.md).

---

**Related:** [Backup & restore](backup-restore.md) · [Jobs overview](jobs-overview.md) · [External database](external-database.md)
