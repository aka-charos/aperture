/**
 * Load the metadata interest matching reads, and build the match index both
 * recommendation pipelines use for interest affinity and reserved slots.
 *
 * One query per run: the genres and TMDb keywords of every candidate the
 * pipeline is about to score. It replaces one nearest-neighbour query per
 * interest against the embedded phrase, whose ordering was set by the
 * phrase's words rather than its meaning (shared/interestEvidence.ts has the
 * measurement). The embedding of each interest is still stored; nothing here
 * reads it.
 *
 * Fails open like the code it replaces: any problem leaves every affinity
 * neutral and every interest slot unfilled, exactly as for a user with no
 * interests.
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import {
  buildInterestMatchIndex,
  type InterestInput,
  type InterestMatchIndex,
} from './shared/interestSlots.js'
import type { InterestTitleFacts } from './shared/interestEvidence.js'

const logger = createChildLogger('interest-matches')

/**
 * Upper bound on how many interests are checked, so a user with a long
 * interest list cannot multiply a run's work without limit. Interests arrive
 * newest-first (user_custom_interests is ordered by created_at DESC), so the
 * cap drops the oldest.
 */
export const MAX_QUERIED_INTERESTS = 10

/**
 * The verified interest matches among `candidateIds`.
 *
 * `table` is chosen from a literal union, never request data.
 */
export async function loadInterestMatchIndex(
  mediaType: 'movie' | 'series',
  interests: InterestInput[],
  candidateIds: string[]
): Promise<InterestMatchIndex> {
  if (interests.length === 0 || candidateIds.length === 0) return buildInterestMatchIndex([], new Map())

  const queried = interests.slice(0, MAX_QUERIED_INTERESTS)
  if (queried.length < interests.length) {
    logger.info(
      { total: interests.length, queried: queried.length },
      `Limiting interest matching to the ${MAX_QUERIED_INTERESTS} most recent interests`
    )
  }

  const table = mediaType === 'movie' ? 'movies' : 'series'
  const result = await query<{ id: string; genres: string[] | null; keywords: string[] | null }>(
    `SELECT id, genres, keywords FROM ${table} WHERE id = ANY($1::uuid[])`,
    [candidateIds]
  )

  const facts = new Map<string, InterestTitleFacts>()
  for (const row of result.rows) facts.set(row.id, { genres: row.genres, keywords: row.keywords })

  const index = buildInterestMatchIndex(queried, facts)

  for (const interest of index.byInterest) {
    if (interest.matches.length === 0) {
      // Not an error: the phrase names something no candidate's metadata says.
      // Its slot stays empty rather than going to the nearest-sounding title.
      logger.info(
        { interestText: interest.interestText, mediaType, candidates: facts.size },
        'No candidate is tagged with this interest; its reserved slot stays unused'
      )
    } else {
      logger.debug(
        { interestText: interest.interestText, mediaType, matches: interest.matches.length },
        'Interest matched by metadata'
      )
    }
  }

  return index
}
