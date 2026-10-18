/**
 * TMDb genre lists (localized via `language` on the client).
 */

import { tmdbRequest, type ApiLogCallback } from './client.js'
import type { TMDbGenre } from './types.js'
import { pairGenreNames } from './genreNames.js'

export async function getMovieGenresList(options: {
  language?: string
  onLog?: ApiLogCallback
} = {}): Promise<TMDbGenre[]> {
  const data = await tmdbRequest<{ genres: TMDbGenre[] }>(`/genre/movie/list`, options)
  return data?.genres ?? []
}

export async function getTVGenresList(options: {
  language?: string
  onLog?: ApiLogCallback
} = {}): Promise<TMDbGenre[]> {
  const data = await tmdbRequest<{ genres: TMDbGenre[] }>(`/genre/tv/list`, options)
  return data?.genres ?? []
}

const GENRE_NAMES_TTL_MS = 24 * 60 * 60 * 1000
const genreNamesCache = new Map<string, { at: number; names: Record<string, string> }>()

/**
 * English genre name → its name in `language` (a TMDb language code), from
 * TMDb's own movie and TV genre lists, for printing stored genres. Kept for a
 * day per language, since TMDb's genre lists practically never change.
 *
 * NEVER THROWS: TMDb unconfigured or unreachable answers an empty map (and is
 * not remembered, so the next ask tries again), and the caller prints the
 * stored names.
 */
export async function getLocalizedGenreNames(language: string): Promise<Record<string, string>> {
  const cached = genreNamesCache.get(language)
  if (cached && Date.now() - cached.at < GENRE_NAMES_TTL_MS) return cached.names
  try {
    const [movieEn, movieLocal, tvEn, tvLocal] = await Promise.all([
      getMovieGenresList({ language: 'en-US' }),
      getMovieGenresList({ language }),
      getTVGenresList({ language: 'en-US' }),
      getTVGenresList({ language }),
    ])
    const names = pairGenreNames([
      { english: movieEn, localized: movieLocal },
      { english: tvEn, localized: tvLocal },
    ])
    if (Object.keys(names).length > 0) genreNamesCache.set(language, { at: Date.now(), names })
    return names
  } catch {
    return {}
  }
}
