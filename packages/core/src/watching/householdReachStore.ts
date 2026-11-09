/**
 * Reads the figures behind household reach, in the viewer's scope: a title is
 * ranked among the titles this viewer can open, so a small library of their own
 * isn't measured against audiences in libraries they will never see.
 *
 * Library copies of one title count as one (same TMDb id, else the row itself).
 * Movies and series are ranked separately: a show's audience is anyone who played
 * one episode, which is not the same kind of number as a film's.
 */
import { AsyncCache } from '../lib/asyncCache.js'
import { queryOne, query } from '../lib/db.js'
import {
  binderFor,
  libraryScopeKey,
  libraryScopeSql,
  type LibraryScope,
} from '../lib/libraryScope.js'
import { createChildLogger } from '../lib/logger.js'
import { WATCH_HISTORY_PLAYED_SQL } from '../recommender/watchedExclusion.js'
import { householdReach, type HouseholdReach, type WatcherCount } from './householdReach.js'

const logger = createChildLogger('household-reach')

type ReachMediaType = 'movie' | 'series'

/** A level moves slowly, and a whole-history aggregate shouldn't run per page view. */
const HISTOGRAM_TTL_MS = 60 * 60 * 1000
/** Two media types for each distinct scope; a histogram is a few dozen numbers. */
const HISTOGRAM_MAX_ENTRIES = 64

const histograms = new AsyncCache<WatcherCount[]>({
  ttlMs: HISTOGRAM_TTL_MS,
  maxEntries: HISTOGRAM_MAX_ENTRIES,
})

/** Watch history joined to the title each row belongs to, aliased `t`. */
const PLAYS_SQL: Record<ReachMediaType, string> = {
  movie: `watch_history wh
          JOIN movies t ON t.id = wh.movie_id`,
  series: `watch_history wh
           JOIN episodes e ON e.id = wh.episode_id
           JOIN series t ON t.id = e.series_id`,
}

const TITLE_TABLE: Record<ReachMediaType, string> = { movie: 'movies', series: 'series' }

async function readHistogram(
  mediaType: ReachMediaType,
  scope: LibraryScope
): Promise<WatcherCount[] | null> {
  const params: unknown[] = []
  const inScope = libraryScopeSql(scope, 't', binderFor(params))
  const result = await query<{ watchers: string; titles: string }>(
    `SELECT audience.watchers, COUNT(*) AS titles
       FROM (
         SELECT COALESCE(t.tmdb_id, t.id::text) AS title_key,
                COUNT(DISTINCT wh.user_id) AS watchers
           FROM ${PLAYS_SQL[mediaType]}
          WHERE ${WATCH_HISTORY_PLAYED_SQL} AND ${inScope}
          GROUP BY 1
       ) audience
      GROUP BY audience.watchers`,
    params
  )
  // Null, not an empty list, so that "nothing played yet" isn't kept for an hour.
  if (result.rows.length === 0) return null
  return result.rows.map((row) => ({
    watchers: Number.parseInt(row.watchers, 10),
    titles: Number.parseInt(row.titles, 10),
  }))
}

/** The title's audience across its copies in this scope, counting each person once. */
async function readAudience(
  mediaType: ReachMediaType,
  titleId: string,
  scope: LibraryScope
): Promise<number> {
  const params: unknown[] = [titleId]
  const inScope = libraryScopeSql(scope, 't', binderFor(params))
  const row = await queryOne<{ watchers: string }>(
    `SELECT COUNT(DISTINCT wh.user_id) AS watchers
       FROM ${PLAYS_SQL[mediaType]}
      WHERE ${WATCH_HISTORY_PLAYED_SQL} AND ${inScope}
        AND (t.id = $1::uuid
             OR t.tmdb_id = (SELECT own.tmdb_id FROM ${TITLE_TABLE[mediaType]} own WHERE own.id = $1::uuid))`,
    params
  )
  return Number.parseInt(row?.watchers ?? '0', 10)
}

/**
 * The level for one title in this viewer's scope. A failed read answers undefined:
 * the counts on the page are still good, so the level is left out, not the page.
 */
export async function getHouseholdReach(
  mediaType: ReachMediaType,
  titleId: string,
  scope: LibraryScope
): Promise<HouseholdReach | undefined> {
  try {
    const watchers = await readAudience(mediaType, titleId, scope)
    if (watchers <= 0) return undefined
    const histogram = await histograms.get(`${mediaType}:${libraryScopeKey(scope)}`, () =>
      readHistogram(mediaType, scope)
    )
    return householdReach(watchers, histogram ?? [])
  } catch (err) {
    logger.warn({ err, mediaType }, 'Could not read household reach')
    return undefined
  }
}
