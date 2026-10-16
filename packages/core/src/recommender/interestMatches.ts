/**
 * Load the metadata interest matching reads, and build the match index both
 * recommendation pipelines use for interest affinity and reserved slots.
 *
 * One query per run: the genres and TMDb keywords of every candidate the
 * pipeline is about to score. It replaces one nearest-neighbour query per
 * interest against the embedded phrase, whose ordering was set by the
 * phrase's words rather than its meaning (shared/interestEvidence.ts has the
 * measurement).
 *
 * The one place the embedding is still read: an interest written in a
 * non-Latin script, which English TMDb keywords cannot confirm. Its nearest
 * titles among the candidates are offered as an UNCONFIRMED fallback
 * (shared/interestSlots.ts buildInterestMatchIndex), used only if no localised
 * genre confirms it.
 *
 * Fails open like the code it replaces: any problem leaves every affinity
 * neutral and every interest slot unfilled, exactly as for a user with no
 * interests.
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../lib/ai-provider.js'
import {
  buildInterestMatchIndex,
  type InterestInput,
  type InterestMatchIndex,
} from './shared/interestSlots.js'
import { interestIsNonLatin, type InterestTitleFacts } from './shared/interestEvidence.js'

const logger = createChildLogger('interest-matches')

/**
 * Upper bound on how many interests are checked, so a user with a long
 * interest list cannot multiply a run's work without limit. Interests arrive
 * newest-first (user_custom_interests is ordered by created_at DESC), so the
 * cap drops the oldest.
 */
export const MAX_QUERIED_INTERESTS = 10

/** How many nearest titles a non-Latin interest's fallback offers the slot picker. */
export const NON_LATIN_FALLBACK_POOL = 25

/** An interest as the loader needs it: the matching fields plus its stored embedding. */
export interface InterestLoaderInput extends InterestInput {
  embedding: number[] | null
  embeddingModel: string | null
}

/**
 * The candidate ids nearest one interest's embedding, best first.
 *
 * An exact scan over the candidates' raw vectors, ordered by a computed
 * similarity rather than by `embedding <=> $1`, so the planner cannot pick the
 * HNSW index and post-filter the explicit id list down to almost nothing (the
 * ef_search invariant). Raw, like every interest vector: the phrase was never
 * centred.
 */
async function nearestCandidates(
  mediaType: 'movie' | 'series',
  vector: number[],
  candidateIds: string[],
  modelId: string
): Promise<string[]> {
  const table = await getActiveEmbeddingTableName(mediaType === 'movie' ? 'embeddings' : 'series_embeddings')
  const column = mediaType === 'movie' ? 'movie_id' : 'series_id'
  const result = await query<{ id: string }>(
    `SELECT id FROM (
       SELECT e.${column} AS id, 1 - (e.embedding <=> $1::halfvec) AS similarity
         FROM ${table} e
        WHERE e.model = $2 AND e.${column} = ANY($3::uuid[])
     ) scored
     ORDER BY similarity DESC, id
     LIMIT $4`,
    [`[${vector.join(',')}]`, modelId, candidateIds, NON_LATIN_FALLBACK_POOL]
  )
  return result.rows.map((row) => row.id)
}

/**
 * The verified interest matches among `candidateIds`.
 *
 * `table` is chosen from a literal union, never request data.
 */
export async function loadInterestMatchIndex(
  mediaType: 'movie' | 'series',
  interests: InterestLoaderInput[],
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

  // Nearest titles for non-Latin interests only; the index uses them solely
  // when no localised genre confirms the interest. A failure here costs the
  // fallback, never the verified matches.
  const nearest = new Map<string, string[]>()
  const nonLatin = queried.filter((interest) => interestIsNonLatin(interest.interestText))
  if (nonLatin.length > 0) {
    try {
      const modelId = await getActiveEmbeddingModelId()
      for (const interest of nonLatin) {
        if (!modelId || !interest.embedding?.length || interest.embeddingModel !== modelId) continue
        nearest.set(
          interest.interestId,
          await nearestCandidates(mediaType, interest.embedding, candidateIds, modelId)
        )
      }
    } catch (err) {
      logger.warn({ err, mediaType }, 'Could not look up nearest titles for non-Latin interests')
    }
  }

  const index = buildInterestMatchIndex(queried, facts, nearest)

  for (const interest of index.byInterest) {
    if (interest.matches.length === 0) {
      // Not an error: the phrase names something no candidate's metadata says.
      // Its slot stays empty rather than going to the nearest-sounding title.
      logger.info(
        { interestText: interest.interestText, mediaType, candidates: facts.size },
        'No candidate is tagged with this interest; its reserved slot stays unused'
      )
    } else if (interest.matches.every((match) => !match.evidence)) {
      logger.info(
        { interestText: interest.interestText, mediaType },
        'Non-Latin interest confirmed by no genre; offering its nearest titles as unconfirmed'
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
