import { concurrencyLimit } from '../lib/asyncCache.js'
import { getTMDbConfig } from '../settings/systemSettings.js'
import { tmdbLookup } from '../tmdb/client.js'
import type { JustWatchStreamingRow } from './types.js'
import {
  getCachedTmdbPostersBatch,
  normalizePosterCacheLanguage,
  tmdbPosterCacheTtlMs,
  upsertTmdbPosterCache,
} from './tmdbPosterCache.js'

/**
 * Replace JustWatch poster URLs with TMDb `poster_path` values (path only, e.g. `/abc.jpg`)
 * so the web client can build `image.tmdb.org` URLs consistently with Discovery cards.
 *
 * Uses DB-backed cache + in-flight dedupe to limit TMDb API usage (see tmdb_poster_cache migration).
 *
 * Answers from what is saved and never waits for TMDb: a saved poster past its time
 * still answers, a title with none keeps JustWatch's own, and anything due is
 * looked up behind the answer for the next visit.
 */
export async function attachTmdbPosterPaths(
  rows: JustWatchStreamingRow[],
  options: { language?: string } = {}
): Promise<JustWatchStreamingRow[]> {
  const cfg = await getTMDbConfig()
  if (!cfg.enabled || !cfg.hasApiKey) {
    return rows
  }

  const { language } = options
  const lang = language || 'en'
  const ttl = tmdbPosterCacheTtlMs()

  const movieIds = new Set<number>()
  const tvIds = new Set<number>()

  for (const r of rows) {
    if (r.tmdbId == null) continue
    const ot = (r.objectType || '').toUpperCase()
    if (ot === 'MOVIE') movieIds.add(r.tmdbId)
    else if (ot === 'SHOW') tvIds.add(r.tmdbId)
  }

  const [movieCached, tvCached] = await Promise.all([
    getCachedTmdbPostersBatch('movie', [...movieIds], lang),
    getCachedTmdbPostersBatch('tv', [...tvIds], lang),
  ])

  const moviePoster = new Map<number, string | null>()
  const tvPoster = new Map<number, string | null>()
  const now = Date.now()

  const savedAndDue = (
    ids: Set<number>,
    saved: typeof movieCached,
    posters: Map<number, string | null>
  ): number[] => {
    const due: number[] = []
    for (const id of ids) {
      const row = saved.get(id)
      if (row) posters.set(id, row.posterPath)
      if (!row || now - row.fetchedAtMs > ttl) due.push(id)
    }
    return due
  }
  const dueMovies = savedAndDue(movieIds, movieCached, moviePoster)
  const dueShows = savedAndDue(tvIds, tvCached, tvPoster)

  void Promise.allSettled([
    ...dueMovies.map((id) => limitBackgroundFill(() => fetchPoster('movie', id, lang))),
    ...dueShows.map((id) => limitBackgroundFill(() => fetchPoster('tv', id, lang))),
  ])

  return rows.map((r) => {
    if (r.tmdbId == null) return r
    const ot = (r.objectType || '').toUpperCase()
    let path: string | null | undefined
    if (ot === 'MOVIE') path = moviePoster.get(r.tmdbId)
    else if (ot === 'SHOW') path = tvPoster.get(r.tmdbId)
    else return r
    if (path == null || path === '') return r
    return { ...r, posterPath: path }
  })
}

const inflight = new Map<string, Promise<string | null>>()

function inflightKey(media: 'movie' | 'tv', id: number, lang: string): string {
  return `${media}:${id}:${normalizePosterCacheLanguage(lang)}`
}

const limitBackgroundFill = concurrencyLimit(4)

/**
 * TMDb saying it has no such title is kept; a failed lookup keeps nothing, so a
 * TMDb outage cannot fill the cache with titles marked as having no poster.
 */
async function fetchPoster(media: 'movie' | 'tv', id: number, lang: string): Promise<void> {
  const key = inflightKey(media, id, lang)
  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      const answer = await tmdbLookup<{ poster_path?: string | null }>(`/${media}/${id}`, {
        language: lang,
      })
      if (answer.status === 'failed') return null
      const path = answer.status === 'ok' ? (answer.data.poster_path ?? null) : null
      await upsertTmdbPosterCache(media, id, lang, path)
      return path
    })()
    inflight.set(key, p)
  }
  try {
    await p
  } finally {
    inflight.delete(key)
  }
}
