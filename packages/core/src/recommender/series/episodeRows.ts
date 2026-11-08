/**
 * How the series sync turns listed episodes into rows. Pure, pinned by
 * `episodeRows.test.ts`; the writes are in `episodeBatch.ts`.
 *
 * The columns and their parameters come from one table, so the UPDATE, the INSERT
 * and the rebind cannot put a value in another column's place.
 */

import { clampRating } from '../shared/syncHelpers.js'
import type { PreparedEpisode } from './syncTypes.js'

type EpisodeField = readonly [column: string, sqlType: string, value: (pe: PreparedEpisode) => unknown]

/** Array columns travel as JSONB, so `unnest` cannot flatten them into one array. */
export const EPISODE_FIELDS: readonly EpisodeField[] = [
  ['provider_item_id', 'text', (pe) => pe.episode.id],
  ['series_id', 'uuid', (pe) => pe.seriesDbId],
  ['season_number', 'int', (pe) => pe.episode.seasonNumber],
  ['episode_number', 'int', (pe) => pe.episode.episodeNumber],
  ['title', 'text', (pe) => pe.episode.name],
  ['overview', 'text', (pe) => pe.episode.overview || null],
  ['premiere_date', 'date', (pe) => (pe.episode.premiereDate ? pe.episode.premiereDate.split('T')[0] : null)],
  ['year', 'int', (pe) => pe.episode.year || null],
  ['runtime_minutes', 'int', (pe) => pe.runtimeMinutes],
  ['community_rating', 'real', (pe) => clampRating(pe.episode.communityRating)],
  ['directors', 'jsonb', (pe) => JSON.stringify(pe.episode.directors || [])],
  ['writers', 'jsonb', (pe) => JSON.stringify(pe.episode.writers || [])],
  ['guest_stars', 'jsonb', (pe) => JSON.stringify(pe.episode.guestStars || [])],
  ['path', 'text', (pe) => pe.episode.path || null],
  ['media_sources', 'jsonb', (pe) => JSON.stringify(pe.episode.mediaSources || [])],
  ['poster_url', 'text', (pe) => pe.posterUrl],
  ['episode_number_end', 'int', (pe) => pe.episode.episodeNumberEnd ?? null],
]

/** `unnest(...) AS <alias>(<columns>)`, its parameters numbered from `$1`. */
export function episodeRowsSource(alias: string): string {
  const arrays = EPISODE_FIELDS.map(([, type], i) => `$${i + 1}::${type}[]`).join(', ')
  const columns = EPISODE_FIELDS.map(([column]) => column).join(', ')
  return `unnest(${arrays}) AS ${alias}(${columns})`
}

/** One array per column, in `EPISODE_FIELDS` order. */
export function episodeRowParams(episodes: readonly PreparedEpisode[]): unknown[][] {
  return EPISODE_FIELDS.map(([, , value]) => episodes.map(value))
}

export function episodeKey(pe: PreparedEpisode): string {
  return `${pe.seriesDbId}:${pe.episode.seasonNumber}:${pe.episode.episodeNumber}`
}

function lastCovered(pe: PreparedEpisode): number {
  return pe.episode.episodeNumberEnd ?? pe.episode.episodeNumber
}

/** The version covering the most numbers; on a tie the later one. */
export function widerVersion(current: PreparedEpisode | undefined, next: PreparedEpisode): PreparedEpisode {
  return !current || lastCovered(next) >= lastCovered(current) ? next : current
}

export interface EpisodeBatchPlan {
  /** Rows the library holds under this media-server id. */
  update: PreparedEpisode[]
  /** Numbers the library holds nothing at; one item per number. */
  insert: PreparedEpisode[]
  /** Further versions of a number already being inserted. */
  duplicates: number
  /**
   * A new media-server id at a number the library already holds. Either the server
   * re-keyed the item (a replaced file) or this is a second version of the episode;
   * only the library's whole listing can tell which (`settleRekeyedEpisodes`).
   */
  rekeyed: PreparedEpisode[]
}

/**
 * Sort one batch. Versions of one episode in the same batch all carry the widest
 * range any of them has, so the row ends up covering it whichever version is written.
 */
export function planEpisodeBatch(
  episodes: readonly PreparedEpisode[],
  knownIds: ReadonlySet<string>,
  knownKeys: ReadonlySet<string>
): EpisodeBatchPlan {
  const widest = new Map<string, number | undefined>()
  for (const pe of episodes) {
    const key = episodeKey(pe)
    const end = pe.episode.episodeNumberEnd
    const current = widest.get(key)
    if (end != null && (current == null || end > current)) widest.set(key, end)
    else if (!widest.has(key)) widest.set(key, undefined)
  }

  const update: PreparedEpisode[] = []
  const rekeyed: PreparedEpisode[] = []
  const inserts = new Map<string, PreparedEpisode>()
  let candidates = 0
  for (const original of episodes) {
    const key = episodeKey(original)
    const end = widest.get(key)
    const pe =
      end === original.episode.episodeNumberEnd
        ? original
        : { ...original, episode: { ...original.episode, episodeNumberEnd: end } }
    if (knownIds.has(pe.episode.id)) update.push(pe)
    else if (knownKeys.has(key)) rekeyed.push(pe)
    else {
      candidates++
      inserts.set(key, pe)
    }
  }
  return { update, insert: [...inserts.values()], duplicates: candidates - inserts.size, rekeyed }
}

/** One item per number, the widest version, for the settle step. */
export function widestPerNumber(episodes: readonly PreparedEpisode[]): PreparedEpisode[] {
  const chosen = new Map<string, PreparedEpisode>()
  for (const pe of episodes) chosen.set(episodeKey(pe), widerVersion(chosen.get(episodeKey(pe)), pe))
  return [...chosen.values()]
}
