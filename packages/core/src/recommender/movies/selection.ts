import type { Candidate } from '../types.js'
import {
  mmrPoolSize,
  selectWithMmr,
  shortlistIds,
  similarityFromEmbeddings,
} from '../shared/index.js'
import { getMovieEmbeddings } from './embeddings.js'
import { createChildLogger } from '../../lib/logger.js'

const logger = createChildLogger('recommender-selection')

export interface MovieSelectionResult {
  selected: Candidate[]
  selectedRanks: Map<string, number>
}

/**
 * Choose the final list, trading match quality against redundancy.
 *
 * Async now, because diversity is measured in embedding space rather than by
 * counting genre labels — see shared/mmr.ts for what that replaced and why a
 * configured "20% diversity weight" was behaving as a hard sort on genre
 * coverage.
 *
 * Only the shortlist's vectors are fetched. The old selector considered every
 * scored title at every step, which is both how a rank-3000 film could take a
 * slot outright and why fetching embeddings for it would have meant pulling the
 * whole library into memory once per user.
 */
export async function applyDiversityAndSelect(
  candidates: Candidate[],
  count: number,
  diversityWeight: number
): Promise<MovieSelectionResult> {
  if (count <= 0 || candidates.length === 0) {
    return { selected: [], selectedRanks: new Map() }
  }

  const ids = shortlistIds(candidates, count)
  const embeddings = await getMovieEmbeddings(ids)

  if (embeddings.size < ids.length) {
    // Not fatal: a title with no vector answers 0 redundancy and competes on
    // relevance alone. Worth saying out loud, because a large gap here means
    // the diversity weight is quietly doing less than it claims.
    logger.debug(
      { shortlist: ids.length, withEmbeddings: embeddings.size },
      'Some shortlisted candidates have no embedding; they contribute no redundancy signal'
    )
  }

  const result = selectWithMmr(
    candidates,
    count,
    diversityWeight,
    similarityFromEmbeddings(embeddings)
  )

  for (const candidate of result.selected) {
    // selectionScore is the marker storage reads to tell a measured variety
    // from a never-measured one, so it must be set for every pick the selector
    // ranked — and never for a reserved-slot filler, which is appended
    // afterwards and was never considered here.
    candidate.selectionScore = result.selectionScores.get(candidate.id)
    const variety = result.variety.get(candidate.id) ?? 0
    candidate.diversityBoost = variety
    candidate.diversityScore = variety
  }

  logger.debug(
    {
      pool: candidates.length,
      shortlist: mmrPoolSize(count),
      selected: result.selected.length,
      diversityWeight,
    },
    'Diversity selection complete'
  )

  return { selected: result.selected, selectedRanks: result.selectedRanks }
}
