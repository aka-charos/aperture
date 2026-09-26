/**
 * Where each managed row's titles come from, who the viewers are, and each
 * viewer's random tag. Shared by the nightly sync and the instant paths, so a
 * row switched on now holds exactly what the next sync would give it.
 */

import { randomBytes } from 'crypto'
import { query } from '../lib/db.js'
import { loadConfiguredLibraries, resolveLibraryScope } from '../lib/libraryScope.js'
import { isEmbyNotFoundError } from '../media/emby/fetchHelpers.js'
import type { MediaServerProvider } from '../media/MediaServerProvider.js'
import { getTopMovies, getTopSeries } from '../topPicks/popularity.js'
import { recsTagName } from './plan.js'
import type { HomePlaylist } from './playlists.js'

export interface ViewerRow {
  id: string
  username: string
  provider_user_id: string
  is_enabled: boolean
  recommendations_enabled: boolean
  provider_disabled: boolean
  /** Whether the viewer can see any movie / series library (lib/libraryScope.ts). */
  has_movies: boolean
  has_series: boolean
}

type ViewerQueryRow = Omit<ViewerRow, 'has_movies' | 'has_series'> & {
  library_access: string[] | null
  max_parental_rating: number | null
}

/** Every account on this media server, or one of them. */
export async function loadViewers(providerType: string, userId?: string): Promise<ViewerRow[]> {
  const [result, libraries] = await Promise.all([
    query<ViewerQueryRow>(
      `SELECT id, username, provider_user_id, is_enabled, recommendations_enabled, provider_disabled,
              library_access, max_parental_rating
       FROM users
       WHERE provider = $1 AND provider_user_id IS NOT NULL ${userId ? 'AND id = $2' : ''}
       ORDER BY username`,
      userId ? [providerType, userId] : [providerType]
    ),
    loadConfiguredLibraries(),
  ])
  return result.rows.map(({ library_access, max_parental_rating, ...viewer }) => {
    const scope = resolveLibraryScope({ libraries, userLibraryIds: library_access, maxParentalRating: max_parental_rating })
    return { ...viewer, has_movies: scope.hasMovies, has_series: scope.hasSeries }
  })
}

/** Library ids for a Top Picks list, in rank order. */
export async function topPicksProviderIds(kind: 'top-picks-movies' | 'top-picks-series'): Promise<string[]> {
  const ids =
    kind === 'top-picks-movies'
      ? (await getTopMovies()).map((pick) => pick.movieId)
      : (await getTopSeries()).map((pick) => pick.seriesId)
  if (ids.length === 0) return []

  const table = kind === 'top-picks-movies' ? 'movies' : 'series'
  const rows = await query<{ id: string; provider_item_id: string }>(
    `SELECT id, provider_item_id FROM ${table} WHERE id = ANY($1)`,
    [ids]
  )
  const byId = new Map(rows.rows.map((row) => [row.id, row.provider_item_id]))
  return ids.map((id) => byId.get(id)).filter((id): id is string => !!id)
}

/**
 * A viewer's selected picks of one media type from their newest COMPLETED run,
 * best rank first. `selected_rank`, never `final_score` — rank is what the page
 * shows, and score would bury reserved-slot picks (F-020). A superseded run
 * still holds its selected rows by design, which is why the run is pinned
 * rather than selecting every `is_selected` row the viewer ever had. Nothing
 * when recommendations are off, or for a media type the viewer cannot see.
 */
export async function recommendedProviderIds(
  viewer: ViewerRow,
  mediaType: 'movie' | 'series',
  limit: number
): Promise<string[]> {
  if (!viewer.recommendations_enabled) return []
  if (mediaType === 'movie' ? !viewer.has_movies : !viewer.has_series) return []

  const [table, column] = mediaType === 'movie' ? ['movies', 'movie_id'] : ['series', 'series_id']
  const rows = await query<{ provider_item_id: string }>(
    `SELECT t.provider_item_id
     FROM recommendation_candidates rc
     JOIN ${table} t ON t.id = rc.${column}
     WHERE rc.run_id = (
             SELECT id FROM recommendation_runs
             WHERE user_id = $1 AND status = 'completed' AND media_type = $2
             ORDER BY created_at DESC
             LIMIT 1
           )
       AND rc.is_selected = true
       AND rc.${column} IS NOT NULL
     ORDER BY rc.selected_rank ASC NULLS LAST
     LIMIT $3`,
    [viewer.id, mediaType, limit]
  )
  return rows.rows.map((row) => row.provider_item_id)
}

/**
 * A playlist's CURRENT items, read back from the media server — never rebuilt.
 * A channel's list is whatever its owner last generated and approved; rebuilding
 * it here would spend model calls and push titles the owner never saw.
 */
export async function playlistProviderIds(
  provider: MediaServerProvider,
  apiKey: string,
  playlist: HomePlaylist
): Promise<string[]> {
  if (!playlist.containerId) return []
  try {
    return playlist.outputType === 'collection'
      ? await provider.getCollectionItems(apiKey, playlist.containerId)
      : (await provider.getPlaylistItems(apiKey, playlist.containerId)).map((item) => item.id)
  } catch (err) {
    // Deleted on the server: nothing left to show, so the row goes.
    if (isEmbyNotFoundError(err)) return []
    throw err
  }
}

/** Whether the media server has no account with this id any more — a 404 for the user itself. */
export async function accountIsGone(
  provider: MediaServerProvider,
  apiKey: string,
  providerUserId: string
): Promise<boolean> {
  try {
    await provider.getUserById(apiKey, providerUserId)
    return false
  } catch (err) {
    return isEmbyNotFoundError(err)
  }
}

/** Each viewer's stored recommendation tag name, by user id. */
export async function loadViewerTags(): Promise<Map<string, string>> {
  const rows = await query<{ user_id: string; tag_name: string }>(
    `SELECT user_id, tag_name FROM home_sections_viewer_tags`
  )
  return new Map(rows.rows.map((row) => [row.user_id, row.tag_name]))
}

/** Mint a viewer's random tag, or return the one a concurrent writer stored. */
export async function mintViewerTag(userId: string): Promise<string> {
  const candidate = recsTagName(randomBytes(5).toString('hex'))
  const row = await query<{ tag_name: string }>(
    `INSERT INTO home_sections_viewer_tags (user_id, tag_name)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING tag_name`,
    [userId, candidate]
  )
  return row.rows[0].tag_name
}
