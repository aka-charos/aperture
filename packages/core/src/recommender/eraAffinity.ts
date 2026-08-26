/**
 * How much a viewer seeks out or avoids each decade, as a bounded preference.
 *
 * Release year used to sit inside the embedded text ("The Matrix (1999)"), so
 * era was a *semantic* property of every title -- one token competing with a
 * thousand characters of synopsis, cast and crew. Removing it (text_version 3)
 * fixed a measured amplification: one viewer's picks were 80% 2020s against a
 * 40.4% history, and afterwards 32%. But it left era with no representation at
 * all, which is not the same as leaving it alone -- the signal simply became
 * emergent again, swinging +40pp to -8pp as a side effect of a change that was
 * not about era.
 *
 * This is the replacement, and it is deliberately NOT semantic: it never
 * touches an embedding, a canonical text, or a stored vector. It reads
 * `movies.year` / `series.year`, compares what a viewer watched against what
 * the library offered them, and hands the result to applyPreferenceAdjustment
 * as a fourth preference dimension beside franchise, genre and stated
 * interests. Adding it costs no re-embed for exactly that reason.
 *
 * ## Why raw share is the wrong quantity
 *
 * The obvious measure -- what fraction of someone's history is from the 2020s
 * -- is contaminated by what is on the shelf. Measured on a 12,589-film
 * library: one viewer's history is 40.4% 2020s, which reads as a strong
 * preference until you notice the library is 15.6% 2020s. The *lift* is what
 * carries taste; the share carries the catalogue.
 *
 *   expected = watchedTotal x libraryShare(decade)      // if era-blind
 *   lift     = (watched + a) / (expected + a)           // a = ERA_PSEUDO_COUNT
 *
 * ## Why the pseudo-count is load-bearing rather than cosmetic
 *
 * Raw lift misbehaves at both ends, and both ends occur on a real library.
 * Measured, same instance:
 *
 *   - The 1900s hold ONE film. A viewer who has not seen it scores a raw lift
 *     of 0.00 -- reported as total avoidance on the strength of a single title.
 *   - The 1950s hold 497 films and the same viewer has seen none of them. That
 *     is also 0.00, and it is overwhelming evidence: across 198 watched films,
 *     the probability of drawing zero from a 7.3% slice is about 3e-7.
 *
 * Those two zeroes mean opposite things and raw lift cannot tell them apart.
 * Smoothing can, because `expected` scales with BOTH library presence and
 * history size: the 1900s land at 1.00 (neutral -- nothing to go on) while the
 * 1950s land at 0.39 (strong avoidance). The same arithmetic makes a thin
 * history collapse toward neutral everywhere, which is why there is no separate
 * "does this user have enough history" gate -- that would be a second, cruder
 * mechanism doing the same job worse.
 *
 * Note it is asymmetric in the right direction. Ten films, all 2020s, still
 * reads as a real preference (p ~ 1e-8 under the null), while zero films from a
 * decade the library barely holds reads as nothing. Evidence, not counting.
 *
 * ## Why a per-decade vector rather than a recency curve
 *
 * Measured across nine viewers on the live instance, the shapes genuinely
 * differ and no two-parameter curve fits them:
 *
 *   afro   (337)  .27 .21 .22 .54  .80 1.08 1.07 2.30   recency ramp
 *   goca   (198)  .39 .38 .54 .73  .92  .96  .88 2.37   recency ramp
 *   k1a   (1563)  .72 .90 .99 1.11 1.35 1.46 .76  .89   peaks at the 2000s
 *   ecl    (384) 1.04 1.11 1.42 1.11 1.28 1.08 .61 1.17  peaks at the 1970s
 *
 * k1a has five times the median history on that instance -- the least noisy
 * row available -- and sits BELOW neutral on the 2020s. A recency model would
 * have pushed recent films at the two viewers who most clearly avoid them.
 *
 * Everything above the DB helpers is pure, so the arithmetic is unit-testable
 * without a database (same split as watchedExclusion.ts and pending.ts).
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { decadeOf } from './eraDiagnostics.js'
import { WATCH_HISTORY_TASTE_SQL } from './watchedExclusion.js'
import type { MediaType } from '../taste-profile/types.js'

const logger = createChildLogger('recommender-era-affinity')

/** decade (1970, 1980, ...) -> number of titles. */
export type DecadeCounts = Map<number, number>

/**
 * Titles added to both sides of the lift ratio, in units of *titles*.
 *
 * Five is enough to neutralise a decade holding a handful of films while
 * leaving a decade of several hundred to speak for itself: at 198 films watched
 * it pulls the 1900s (expected 0.02) to 1.00 and leaves the 1950s (expected
 * 7.8) at 0.39. Larger would start muting genuine avoidance in mid-sized
 * decades; smaller would let a two-film decade assert a preference.
 */
export const ERA_PSEUDO_COUNT = 5

/**
 * How far down the affinity scale a decade may be pushed, however strong the
 * evidence.
 *
 * Insurance against a closed loop, which this signal is uniquely exposed to:
 * penalise a decade, the viewer sees less of it, watches less of it, and the
 * penalty deepens. The loop is already damped by the shape of the mechanism --
 * applyPreferenceAdjustment moves a fraction of the *remaining* headroom, so it
 * reorders but can never exclude, and an outstanding 1962 film with strong
 * similarity still beats a mediocre 2023 one. The floor makes that guarantee
 * explicit rather than incidental.
 *
 * Rarely binding in practice: smoothing keeps lift above zero by construction
 * (the numerator is at least ERA_PSEUDO_COUNT), so the strongest avoidance
 * measured on a real instance reached 0.17, not 0.
 */
export const ERA_AFFINITY_FLOOR = 0.15

/** Neither seeking nor avoiding -- a true no-op in applyPreferenceAdjustment. */
const NEUTRAL_AFFINITY = 0.5

export interface EraAffinity {
  decade: number
  /** Smoothed watched/expected. 1 = exactly as often as the library offers it. */
  lift: number
  /** 0 (avoid) - 0.5 (neutral) - 1 (sought). What the preference nudge consumes. */
  affinity: number
  /** Titles the viewer watched from this decade. Carried for the insights panel. */
  watched: number
  /** Titles the library holds. Carried so a caller can say why a lift is weak. */
  inLibrary: number
}

export type EraAffinityIndex = Map<number, EraAffinity>

export interface EraAffinityOptions {
  pseudoCount?: number
  floor?: number
}

/**
 * Map a lift onto the 0-0.5-1 affinity scale the preference nudge expects.
 *
 * lift/(1+lift) is the natural choice for a ratio: it fixes 1 at 0.5, is
 * bounded without clamping, and is symmetric in the sense that a lift of L and
 * a lift of 1/L land equidistant from neutral. A linear map would need an
 * arbitrary ceiling and would treat "twice as often" and "half as often" as
 * different sizes of effect, which they are not.
 */
export function liftToAffinity(lift: number, floor = ERA_AFFINITY_FLOOR): number {
  if (!Number.isFinite(lift) || lift < 0) return NEUTRAL_AFFINITY
  return Math.max(floor, lift / (1 + lift))
}

/**
 * Build the per-decade preference index for one viewer.
 *
 * Returns an empty index -- i.e. neutral everywhere -- when there is nothing to
 * compare: no watch history, or no library. Callers treat a missing decade as
 * neutral, so an empty index switches the whole dimension off without any
 * caller needing to know it happened.
 */
export function buildEraAffinities(
  watched: DecadeCounts,
  library: DecadeCounts,
  options: EraAffinityOptions = {}
): EraAffinityIndex {
  const pseudoCount = options.pseudoCount ?? ERA_PSEUDO_COUNT
  const floor = options.floor ?? ERA_AFFINITY_FLOOR

  const index: EraAffinityIndex = new Map()

  let librarySize = 0
  for (const count of library.values()) librarySize += count

  let watchedTotal = 0
  for (const count of watched.values()) watchedTotal += count

  if (librarySize <= 0 || watchedTotal <= 0) return index

  for (const [decade, inLibrary] of library) {
    if (inLibrary <= 0) continue

    // What an era-blind viewer with this much history would have watched.
    const expected = watchedTotal * (inLibrary / librarySize)
    const seen = watched.get(decade) ?? 0

    const lift = (seen + pseudoCount) / (expected + pseudoCount)

    index.set(decade, {
      decade,
      lift,
      affinity: liftToAffinity(lift, floor),
      watched: seen,
      inLibrary,
    })
  }

  return index
}

/**
 * The affinity for one title's year, or neutral when we cannot say.
 *
 * A missing or implausible year is neutral rather than penalised: not knowing
 * when something was made is a gap in our metadata, not a fact about the
 * viewer's taste.
 */
export function eraAffinityFor(index: EraAffinityIndex, year: number | null | undefined): number {
  const decade = decadeOf(year)
  if (decade === null) return NEUTRAL_AFFINITY
  return index.get(decade)?.affinity ?? NEUTRAL_AFFINITY
}

/** The full entry, for callers that want to explain the nudge rather than apply it. */
export function eraAffinityEntry(
  index: EraAffinityIndex,
  year: number | null | undefined
): EraAffinity | null {
  const decade = decadeOf(year)
  if (decade === null) return null
  return index.get(decade) ?? null
}

/**
 * Fold a year histogram into a decade histogram.
 *
 * The queries below group by year rather than by decade so that what counts as
 * a usable year is decided in exactly one place -- decadeOf -- instead of being
 * restated as a BETWEEN in every SQL string. Roughly 120 rows either way.
 */
export function foldYearsToDecades(rows: Array<{ year: number | null; n: number }>): DecadeCounts {
  const counts: DecadeCounts = new Map()
  for (const row of rows) {
    const decade = decadeOf(row.year)
    if (decade === null) continue
    const n = Number(row.n)
    if (!Number.isFinite(n) || n <= 0) continue
    counts.set(decade, (counts.get(decade) ?? 0) + n)
  }
  return counts
}

interface YearCountRow {
  year: number | null
  n: string | number
}

/**
 * Decades of what this viewer watched, on the taste predicate.
 *
 * WATCH_HISTORY_TASTE_SQL rather than the "seen it" predicate: this is a
 * question about taste, so a favourited title counts and a title abandoned
 * after two minutes does not -- the same rule the taste vector and the
 * engagement ladder use.
 *
 * Series are counted DISTINCT: a watch_history row is an *episode*, so a
 * 62-episode show would otherwise outweigh sixty films.
 */
export async function getWatchedDecadeCounts(
  userId: string,
  mediaType: MediaType
): Promise<DecadeCounts> {
  const result =
    mediaType === 'movie'
      ? await query<YearCountRow>(
          `SELECT m.year AS year, COUNT(*) AS n
             FROM watch_history wh
             JOIN movies m ON m.id = wh.movie_id
            WHERE wh.user_id = $1
              AND wh.media_type = 'movie'
              AND ${WATCH_HISTORY_TASTE_SQL}
            GROUP BY m.year`,
          [userId]
        )
      : await query<YearCountRow>(
          `SELECT s.year AS year, COUNT(DISTINCT s.id) AS n
             FROM watch_history wh
             JOIN episodes e ON e.id = wh.episode_id
             JOIN series s ON s.id = e.series_id
            WHERE wh.user_id = $1
              AND wh.media_type = 'episode'
              AND ${WATCH_HISTORY_TASTE_SQL}
            GROUP BY s.year`,
          [userId]
        )

  return foldYearsToDecades(result.rows.map((row) => ({ year: row.year, n: Number(row.n) })))
}

/**
 * Decades of everything in the library.
 *
 * The whole catalogue, not the candidate pool: the question is what the viewer
 * had the opportunity to watch, and retrieval has already been shaped by their
 * taste. Using the pool would compare their history against a set selected to
 * resemble it, which reads every viewer as era-neutral.
 */
export async function getLibraryDecadeCounts(mediaType: MediaType): Promise<DecadeCounts> {
  const table = mediaType === 'movie' ? 'movies' : 'series'
  const result = await query<YearCountRow>(
    `SELECT year AS year, COUNT(*) AS n FROM ${table} GROUP BY year`
  )
  return foldYearsToDecades(result.rows.map((row) => ({ year: row.year, n: Number(row.n) })))
}

/**
 * Load the index for one viewer, or an empty one if anything goes wrong.
 *
 * Never throws. An era preference is a refinement on top of a score that is
 * already correct without it, so a failure here must cost the nudge and
 * nothing else -- an empty index reads as neutral everywhere.
 */
export async function loadEraAffinities(
  userId: string,
  mediaType: MediaType
): Promise<EraAffinityIndex> {
  try {
    const [watched, library] = await Promise.all([
      getWatchedDecadeCounts(userId, mediaType),
      getLibraryDecadeCounts(mediaType),
    ])
    return buildEraAffinities(watched, library)
  } catch (err) {
    logger.warn({ err, userId, mediaType }, 'Failed to build era affinities, using neutral')
    return new Map()
  }
}

/**
 * A compact log line: the decades this viewer most seeks out and most avoids.
 *
 * Reported only over decades the index actually holds, which excludes anything
 * the library does not stock at all.
 */
export function summarizeEraAffinities(index: EraAffinityIndex): {
  decades: number
  sought: { decade: number; lift: number } | null
  avoided: { decade: number; lift: number } | null
} {
  let sought: { decade: number; lift: number } | null = null
  let avoided: { decade: number; lift: number } | null = null
  let soughtLift = -Infinity
  let avoidedLift = Infinity

  for (const entry of index.values()) {
    if (entry.lift > soughtLift) {
      soughtLift = entry.lift
      sought = { decade: entry.decade, lift: Math.round(entry.lift * 100) / 100 }
    }
    if (entry.lift < avoidedLift) {
      avoidedLift = entry.lift
      avoided = { decade: entry.decade, lift: Math.round(entry.lift * 100) / 100 }
    }
  }

  return { decades: index.size, sought, avoided }
}
