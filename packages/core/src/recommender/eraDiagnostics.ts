/**
 * Does a run's era mix follow the user's, and if so, why?
 *
 * Nothing in the recommender scores, filters, or diversifies on release year.
 * The year reaches exactly three places: one token inside the embedded text
 * (`"The Matrix (1999)"`, alongside up to 1000 characters of overview plus
 * cast, director, studio, genres and themes), a dedup key in selection, and the
 * taste-profile synopsis, which is prose and never feeds scoring.
 *
 * So any era consistency a user sees is emergent -- a 2015 film's cast, studio,
 * content rating and synopsis vocabulary all differ from a 1978 one's, and the
 * embedding picks that up without ever reading the number. That is a plausible
 * mechanism, not a measured one, and it is precisely the kind of incidental
 * signal that holds until the interesting case: a 1970s film whose themes match
 * a 2010s habit has nothing stopping it.
 *
 * This module reports rather than acts, because "should era be a real term"
 * should not be answered by guessing. The comparison that settles it is
 * `unfamiliarShare` against `poolUnfamiliarShare`: the candidate pool is
 * effectively the library's own era mix, so if the selected picks carry a much
 * smaller share of unfamiliar decades than the pool they were drawn from, the
 * emergent signal is doing real work and an era term would be solving a problem
 * nobody has. If the two are close, there is no era signal at all.
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { WATCH_HISTORY_TASTE_SQL } from './watchedExclusion.js'

const logger = createChildLogger('recommender-era-diagnostics')

/**
 * A decade holding less than this share of a user's watch history counts as one
 * they don't really watch. 5% of a 3,500-title history is still ~175 titles, so
 * this is deliberately generous -- it flags decades that are genuinely marginal
 * to someone's taste, not merely less common than their favourite.
 */
export const UNFAMILIAR_DECADE_SHARE = 0.05

/** 1978 -> 1970. Null for missing or implausible years. */
export function decadeOf(year: number | null | undefined): number | null {
  if (year == null || !Number.isFinite(year)) return null
  // Cinema's first decade through a generous allowance for announced titles.
  if (year < 1880 || year > 2100) return null
  return Math.floor(year / 10) * 10
}

export interface DecadeDistribution {
  /** Items that carried a usable year. Items without one are excluded entirely. */
  counted: number
  medianYear: number | null
  /** decade (as a string key, for log readability) -> share of `counted`, 0-1. */
  shares: Record<string, number>
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function buildDecadeDistribution(
  years: Array<number | null | undefined>
): DecadeDistribution {
  const usable: number[] = []
  const counts = new Map<number, number>()

  for (const year of years) {
    const decade = decadeOf(year)
    if (decade === null) continue
    usable.push(year as number)
    counts.set(decade, (counts.get(decade) ?? 0) + 1)
  }

  if (usable.length === 0) return { counted: 0, medianYear: null, shares: {} }

  const shares: Record<string, number> = {}
  for (const [decade, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    // Rounded because this is read by a human in a log line, not consumed.
    shares[String(decade)] = Math.round((count / usable.length) * 1000) / 1000
  }

  return {
    counted: usable.length,
    medianYear: median(usable.sort((a, b) => a - b)),
    shares,
  }
}

export interface EraFitReport {
  watched: DecadeDistribution
  candidates: DecadeDistribution
  selected: DecadeDistribution
  /** Selected median year minus watched median. Negative means the picks skew older. */
  yearDrift: number | null
  /** Same for the candidate pool, i.e. how far the library itself sits from the user. */
  poolDrift: number | null
  /** Share of selected picks from decades that are marginal in the user's history. */
  unfamiliarShare: number
  /** The control: the same share across the pool those picks were drawn from. */
  poolUnfamiliarShare: number
}

function shareFromUnfamiliarDecades(
  years: Array<number | null | undefined>,
  watched: DecadeDistribution
): number {
  if (watched.counted === 0) return 0

  let counted = 0
  let unfamiliar = 0
  for (const year of years) {
    const decade = decadeOf(year)
    if (decade === null) continue
    counted++
    if ((watched.shares[String(decade)] ?? 0) < UNFAMILIAR_DECADE_SHARE) unfamiliar++
  }

  if (counted === 0) return 0
  return Math.round((unfamiliar / counted) * 1000) / 1000
}

export function summarizeEraFit(
  watchedYears: Array<number | null | undefined>,
  candidateYears: Array<number | null | undefined>,
  selectedYears: Array<number | null | undefined>
): EraFitReport {
  const watched = buildDecadeDistribution(watchedYears)
  const candidates = buildDecadeDistribution(candidateYears)
  const selected = buildDecadeDistribution(selectedYears)

  const drift = (from: DecadeDistribution) =>
    watched.medianYear === null || from.medianYear === null
      ? null
      : Math.round((from.medianYear - watched.medianYear) * 10) / 10

  return {
    watched,
    candidates,
    selected,
    yearDrift: drift(selected),
    poolDrift: drift(candidates),
    unfamiliarShare: shareFromUnfamiliarDecades(selectedYears, watched),
    poolUnfamiliarShare: shareFromUnfamiliarDecades(candidateYears, watched),
  }
}

/**
 * Release years of everything the user has watched, over their whole history.
 *
 * Same WATCH_HISTORY_TASTE_SQL gate as getWatchedGenreCounts, so "what counts as
 * taste evidence" stays one decision. Series report the year of the show rather
 * than of each episode, since a show's era is a property of the show.
 *
 * Fails soft to an empty array: this is diagnostic, and no recommendation run
 * should fall over because a log line could not be assembled.
 */
export async function getWatchedYears(
  userId: string,
  mediaType: 'movie' | 'series'
): Promise<number[]> {
  try {
    const result =
      mediaType === 'movie'
        ? await query<{ year: number | null }>(
            `SELECT m.year
               FROM watch_history wh
               JOIN movies m ON m.id = wh.movie_id
              WHERE wh.user_id = $1
                AND wh.media_type = 'movie'
                AND ${WATCH_HISTORY_TASTE_SQL}`,
            [userId]
          )
        : await query<{ year: number | null }>(
            `SELECT DISTINCT ON (s.id) s.year
               FROM watch_history wh
               JOIN episodes e ON e.id = wh.episode_id
               JOIN series s ON s.id = e.series_id
              WHERE wh.user_id = $1
                AND wh.media_type = 'episode'
                AND ${WATCH_HISTORY_TASTE_SQL}`,
            [userId]
          )

    return result.rows
      .map((row) => row.year)
      .filter((year): year is number => year != null && Number.isFinite(year))
  } catch (err) {
    logger.warn({ err, userId, mediaType }, 'Failed to load watched years, skipping ERA-DIAG')
    return []
  }
}
