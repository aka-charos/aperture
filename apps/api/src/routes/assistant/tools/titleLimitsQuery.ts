/**
 * The reads behind titleLimits.ts: what a limit means in this library, and the
 * check on cards that already exist.
 */
import { binderFor, libraryScopeSql, type LibraryScope } from '@aperture/core'
import { query } from '../../../lib/db.js'
import {
  hasTitleLimits,
  mediaTypesOf,
  resolveGenreLimit,
  SERIES_WITHIN_RUNTIME_SQL,
  titleLimitsSql,
  type LimitMedia,
  type ResolvedLimits,
  type TitleLimits,
} from './titleLimits.js'
import type { ContentItem } from '../schemas/index.js'

const tableFor = (media: LimitMedia) => (media === 'movie' ? 'movies' : 'series')

/**
 * Every genre name on this media type in the libraries the viewer may open. A
 * genre only a closed library holds answers as one this library does not have.
 */
async function storedGenreNames(scope: LibraryScope, media: LimitMedia): Promise<string[]> {
  const params: unknown[] = []
  const inScope = libraryScopeSql(scope, 't', binderFor(params))
  const result = await query<{ genre: string }>(
    `SELECT DISTINCT genre FROM ${tableFor(media)} t, unnest(t.genres) AS genre WHERE ${inScope}`,
    params
  )
  return result.rows.map((row) => row.genre)
}

/**
 * Read what the limits need, once per tool call. A discovery turn searches three
 * ways, and asking for each would repeat a scan of the titles and an aggregate
 * over every episode with the same answer each time.
 */
export async function resolveTitleLimits(
  scope: LibraryScope,
  limits: TitleLimits,
  type: 'movies' | 'series' | 'both'
): Promise<ResolvedLimits> {
  const media = mediaTypesOf(type)
  const [genres, withinRuntime] = await Promise.all([
    limits.genre != null
      ? Promise.all(media.map((m) => storedGenreNames(scope, m)))
      : Promise.resolve([]),
    limits.maxRuntime != null && media.includes('series')
      ? query<{ series_id: string }>(SERIES_WITHIN_RUNTIME_SQL, [limits.maxRuntime])
      : Promise.resolve(null),
  ])
  const storedByMedia = Object.fromEntries(media.map((m, i) => [m, genres[i] ?? []]))
  const genre = resolveGenreLimit(limits, storedByMedia)
  const seriesWithinRuntime = withinRuntime?.rows.map((row) => row.series_id) ?? []
  return {
    limits: genre.limits,
    ignoredGenreNote: genre.ignoredGenreNote,
    facts: {
      movie: { genreNames: genre.genreNames.movie, seriesWithinRuntime },
      series: { genreNames: genre.genreNames.series, seriesWithinRuntime },
    },
  }
}

/**
 * The cards among `items` that fit, in their order. For titles that reached the
 * answer by name (web picks resolved to library rows), which no ANN filter saw.
 *
 * A failed read throws rather than passing everything: these cards would claim a
 * limit nobody checked. On the discovery tool that surfaces as the error result.
 */
export async function itemsWithinLimits(
  items: ContentItem[],
  resolved: ResolvedLimits
): Promise<ContentItem[]> {
  if (!hasTitleLimits(resolved.limits) || items.length === 0) return items
  const fits = new Set<string>()
  for (const media of mediaTypesOf('both')) {
    const ids = items.filter((item) => item.type === media).map((item) => item.id)
    if (ids.length === 0) continue
    const params: unknown[] = [ids]
    const limitSql = titleLimitsSql(resolved, media, 't', binderFor(params))
    const result = await query<{ id: string }>(
      `SELECT t.id FROM ${tableFor(media)} t WHERE t.id = ANY($1::uuid[]) ${limitSql}`,
      params
    )
    for (const row of result.rows) fits.add(row.id)
  }
  return items.filter((item) => fits.has(item.id))
}
