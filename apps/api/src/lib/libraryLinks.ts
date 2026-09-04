/**
 * Resolve Aperture library rows for TMDb ids.
 *
 * Two surfaces need this and want slightly different halves of it: a request
 * or search result needs the UUID so an available title can link to
 * `/movies/:id`, and an issue needs the TITLE, because Seerr's issue payload
 * carries `media.tmdbId` and no name at all. One lookup answers both, and
 * keeping it in one place is what stops the second caller inventing a second
 * fallback for a title that is not in the library.
 */
import { query } from './db.js'

export interface LibraryLink {
  libraryMediaId: string | null
  /** Null when the title is known to Seerr but absent from this library. */
  libraryTitle: string | null
}

export async function attachLibraryMediaIds<
  T extends { mediaType: 'movie' | 'series'; tmdbId: number },
>(rows: T[]): Promise<(T & LibraryLink)[]> {
  if (rows.length === 0) return []

  const movieTmdbIds = [
    ...new Set(rows.filter((r) => r.mediaType === 'movie').map((r) => String(r.tmdbId))),
  ]
  const seriesTmdbIds = [
    ...new Set(rows.filter((r) => r.mediaType === 'series').map((r) => String(r.tmdbId))),
  ]

  const movieMap = new Map<string, { id: string; title: string }>()
  const seriesMap = new Map<string, { id: string; title: string }>()

  if (movieTmdbIds.length > 0) {
    const res = await query<{ id: string; tmdb_id: string; title: string }>(
      `SELECT id, tmdb_id, title FROM movies WHERE tmdb_id = ANY($1::text[])`,
      [movieTmdbIds]
    )
    for (const row of res.rows) {
      movieMap.set(row.tmdb_id, { id: row.id, title: row.title })
    }
  }
  if (seriesTmdbIds.length > 0) {
    const res = await query<{ id: string; tmdb_id: string; title: string }>(
      `SELECT id, tmdb_id, title FROM series WHERE tmdb_id = ANY($1::text[])`,
      [seriesTmdbIds]
    )
    for (const row of res.rows) {
      seriesMap.set(row.tmdb_id, { id: row.id, title: row.title })
    }
  }

  return rows.map((r) => {
    const key = String(r.tmdbId)
    const hit = r.mediaType === 'movie' ? movieMap.get(key) : seriesMap.get(key)
    return { ...r, libraryMediaId: hit?.id ?? null, libraryTitle: hit?.title ?? null }
  })
}
