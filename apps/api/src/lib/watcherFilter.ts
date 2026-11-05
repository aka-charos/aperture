/**
 * Browse's "seen by at least / at most N people" filter, for both media types.
 *
 * A watcher is someone who PLAYED it, which is what the filter's help text
 * promises, and "distinct" because a show's rows are per episode.
 *
 * The counts are grouped once and joined, rather than counted per title in a
 * correlated subquery: the whole history is read once, not looked up per title.
 * LEFT JOIN + COALESCE because a title nobody played has no row in the group, and
 * `maxWatchers=0` must still match it.
 */

import { WATCH_HISTORY_PLAYED_SQL } from '@aperture/core'

const WATCHER_COUNTS: Record<'movies' | 'series', string> = {
  movies: `SELECT wh.movie_id AS item_id, COUNT(DISTINCT wh.user_id)::int AS watcher_count
      FROM watch_history wh
      WHERE wh.movie_id IS NOT NULL AND ${WATCH_HISTORY_PLAYED_SQL}
      GROUP BY wh.movie_id`,
  series: `SELECT e.series_id AS item_id, COUNT(DISTINCT wh.user_id)::int AS watcher_count
      FROM watch_history wh
      INNER JOIN episodes e ON e.id = wh.episode_id
      WHERE ${WATCH_HISTORY_PLAYED_SQL}
      GROUP BY e.series_id`,
}

export interface WatcherCountFilter {
  /** Goes straight after `FROM <table>`, with its leading space; '' when unfiltered. */
  join: string
  /** One more WHERE condition (no keyword); '' when unfiltered. */
  where: string
}

/**
 * Pure. Binds its bounds into `params`. A bound that does not parse is ignored; a
 * minimum only means something above 0, and a maximum of 0 is a real request.
 */
export function watcherCountFilter(
  table: 'movies' | 'series',
  minWatchers: string | undefined,
  maxWatchers: string | undefined,
  params: unknown[]
): WatcherCountFilter {
  const min = Number.parseInt(minWatchers ?? '', 10)
  const max = Number.parseInt(maxWatchers ?? '', 10)
  const hasMin = !Number.isNaN(min) && min > 0
  const hasMax = !Number.isNaN(max) && max >= 0
  if (!hasMin && !hasMax) return { join: '', where: '' }

  const conditions: string[] = []
  if (hasMin) {
    params.push(min)
    conditions.push(`COALESCE(watchers.watcher_count, 0) >= $${params.length}`)
  }
  if (hasMax) {
    params.push(max)
    conditions.push(`COALESCE(watchers.watcher_count, 0) <= $${params.length}`)
  }

  return {
    join: ` LEFT JOIN (
      ${WATCHER_COUNTS[table]}
    ) watchers ON watchers.item_id = ${table}.id`,
    where: conditions.join(' AND '),
  }
}
