/**
 * Who gets recommendations of one kind: the one question both pipelines and
 * both library writers ask before doing per-user work.
 *
 * It used to be a per-type switch (`movies_enabled` / `series_enabled`) written
 * into each job's WHERE clause. Recommendations are now one permission
 * (`recommendations_enabled`), and the KIND follows from the libraries the media
 * server lets the person see (lib/libraryScope.ts) — someone with no movie
 * library gets no movie run, no movie library and no movie home row, without an
 * admin having to remember to switch anything.
 *
 * The four job loops call this; direct single-user paths (the regenerate button,
 * the admin's per-user actions) go through the same guard inside the pipeline,
 * so no entry point can run a kind for someone who cannot see it.
 */

import { query } from '../lib/db.js'
import {
  loadConfiguredLibraries,
  resolveLibraryScope,
  scopeHas,
  type LibraryKind,
  type LibraryScope,
} from '../lib/libraryScope.js'

export interface RecommendationRecipient {
  id: string
  username: string
  provider_user_id: string
  display_name: string | null
  max_parental_rating: number | null
  scope: LibraryScope
}

/** The SQL half: accounts that may have recommendations made for them at all. */
export const RECOMMENDATION_RECIPIENT_SQL =
  'is_enabled = true AND recommendations_enabled = true AND provider_disabled = false'

interface RecipientRow {
  id: string
  username: string
  provider_user_id: string
  display_name: string | null
  max_parental_rating: number | null
  library_access: string[] | null
}

export async function loadRecommendationRecipients(kind: LibraryKind): Promise<RecommendationRecipient[]> {
  const [rows, libraries] = await Promise.all([
    query<RecipientRow>(
      `SELECT id, username, provider_user_id, display_name, max_parental_rating, library_access
         FROM users WHERE ${RECOMMENDATION_RECIPIENT_SQL}`
    ),
    loadConfiguredLibraries(),
  ])

  const recipients: RecommendationRecipient[] = []
  for (const row of rows.rows) {
    const scope = resolveLibraryScope({
      libraries,
      userLibraryIds: row.library_access,
      maxParentalRating: row.max_parental_rating,
    })
    if (!scopeHas(scope, kind)) continue
    recipients.push({
      id: row.id,
      username: row.username,
      provider_user_id: row.provider_user_id,
      display_name: row.display_name,
      max_parental_rating: row.max_parental_rating,
      scope,
    })
  }
  return recipients
}
