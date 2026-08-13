/**
 * Custom-interest matching and reserved recommendation slots.
 *
 * A custom interest ("Time travel stories") is a taste facet the user states
 * outright rather than one inferred from watch history. It used to reach the
 * pipeline only as a preference multiplier, which cannot surface anything:
 * interest carries weight 0.3 of a 1.3 total in PREFERENCE_DIMENSION_WEIGHTS
 * and that is scaled by MAX_PREFERENCE_HEADROOM (0.5), so even a perfect
 * interest match closes just 11.5% of a candidate's remaining gap to 1.0 --
 * never enough to lift something the generic taste score already ranked below
 * the cut. Raising that weight was rejected: it is global, so it would retune
 * franchise/genre for every user, interests or not.
 *
 * So interests earn a small number of *reserved slots* in the final selection
 * instead. Scoring is left exactly as it was; a bounded few of the picks are
 * simply drawn from interest matches rather than from the top of the ranking.
 *
 * Everything here is pure -- no DB access -- so it can be unit-tested without
 * a database. The per-media-type ANN queries that produce the raw rows live in
 * recommender/movies/candidates.ts and recommender/series/pipeline.ts.
 */

/**
 * The shipped ceiling, now `recommendation_config.{movie,series}_interest_max_slots`
 * and admin-editable. Kept here only as the value used when a config read
 * fails; the number in the database is what governs a real run.
 *
 * There used to be a second, invisible bound alongside it -- an
 * INTEREST_SLOT_SHARE of 0.2, so the count could never exceed a fifth of the
 * list however it was configured. It is gone. Two knobs answering the same
 * question, one of them hidden and winning, is how a setting comes to mean
 * something other than what it says.
 */
export const DEFAULT_INTEREST_MAX_SLOTS = 3

/**
 * A reserved slot is only filled by a match that clears the same "moderate
 * match" bar the affinity tiers already use (0.5 weighted cosine -> 0.8
 * affinity). An interest that matches nothing in the library leaves its slot
 * unused rather than padding the list with a weak pick.
 */
export const MIN_INTEREST_SLOT_SIMILARITY = 0.5

/**
 * How many of an interest's strongest matches a reserved slot may be drawn
 * from. This window is what keeps the slot recognizably *about* the interest.
 *
 * Picking purely by match strength would hand slots to whatever obscure thing
 * happens to sit closest to the phrase; picking purely by recommendation score
 * across every match would hand them to high-scoring titles that only
 * marginally relate to it, which is indistinguishable from doing nothing. So
 * the slot is filled by the best-scoring member of the interest's top matches:
 * unambiguously on-topic first, then the best of those.
 */
export const INTEREST_SLOT_MATCH_POOL = 25

/**
 * The single best interest match for one candidate.
 */
export interface InterestMatch {
  interestId: string
  interestText: string
  /** Cosine similarity to the interest embedding, scaled by the interest's own weight. */
  weightedSimilarity: number
  /** 0.5 (neutral) | 0.65 | 0.8 | 1.0 -- feeds PreferenceAffinities.interest. */
  affinity: number
}

export interface InterestCandidateMatch extends InterestMatch {
  candidateId: string
}

export interface InterestMatchIndex {
  /** candidateId -> its strongest match across all of the user's interests. */
  best: Map<string, InterestMatch>
  /** Per-interest match lists, in the user's interest order, each sorted by descending similarity. */
  byInterest: Array<{
    interestId: string
    interestText: string
    matches: InterestCandidateMatch[]
  }>
}

/**
 * One interest's raw ANN result, as returned by the per-media-type query.
 */
export interface InterestQueryResult {
  interestId: string
  interestText: string
  /** The user's weight for this interest (defaults to 1.0 in user_custom_interests). */
  weight: number
  /** Rows from the pgvector query: raw cosine similarity, descending. */
  rows: Array<{ candidateId: string; similarity: number }>
}

/**
 * Map a weighted cosine similarity onto a preference affinity.
 *
 * These cut points are lifted verbatim from getCustomInterestAffinity
 * (taste-profile/index.ts), which now calls this function, so the two cannot
 * drift. Never returns below 0.5: custom interests are opt-in extra signal,
 * not an aversion list.
 */
export function interestAffinityFromSimilarity(weightedSimilarity: number): number {
  if (weightedSimilarity >= 0.7) return 1.0
  if (weightedSimilarity >= 0.5) return 0.8
  if (weightedSimilarity >= 0.3) return 0.65
  return 0.5
}

/**
 * Fold per-interest ANN results into the lookup structures the pipeline needs:
 * one best-match-per-candidate map for the scoring loop, and the per-interest
 * lists that reserved slots are drawn from.
 */
export function buildInterestMatchIndex(results: InterestQueryResult[]): InterestMatchIndex {
  const best = new Map<string, InterestMatch>()
  const byInterest: InterestMatchIndex['byInterest'] = []

  for (const result of results) {
    const matches: InterestCandidateMatch[] = result.rows.map((row) => {
      const weightedSimilarity = row.similarity * result.weight
      return {
        candidateId: row.candidateId,
        interestId: result.interestId,
        interestText: result.interestText,
        weightedSimilarity,
        affinity: interestAffinityFromSimilarity(weightedSimilarity),
      }
    })

    // The query already returns descending similarity and the weight is
    // constant within an interest, but sorting here keeps the contract true
    // regardless of what the caller hands over.
    matches.sort((a, b) => b.weightedSimilarity - a.weightedSimilarity)

    for (const match of matches) {
      const existing = best.get(match.candidateId)
      if (!existing || match.weightedSimilarity > existing.weightedSimilarity) {
        best.set(match.candidateId, {
          interestId: match.interestId,
          interestText: match.interestText,
          weightedSimilarity: match.weightedSimilarity,
          affinity: match.affinity,
        })
      }
    }

    byInterest.push({
      interestId: result.interestId,
      interestText: result.interestText,
      matches,
    })
  }

  return { best, byInterest }
}

/**
 * How many of the final picks to hand over to custom interests.
 *
 * Bounded by three things the admin can see: the number of interests the user
 * actually wrote, the configured ceiling, and the length of the list. Zero
 * interests (the overwhelmingly common case) means zero slots and a pipeline
 * that behaves exactly as it did before.
 *
 * The configured ceiling is authoritative. Nothing here silently reduces it,
 * because a slot budget the admin cannot see is a slot budget they will
 * eventually be surprised by -- the UI caps the two sliders against each other
 * so the sum can never overdraw the list in the first place.
 */
export function computeReservedInterestSlots(
  selectedCount: number,
  interestCount: number,
  maxSlots: number
): number {
  if (!Number.isFinite(selectedCount) || !Number.isFinite(interestCount)) return 0
  if (!Number.isFinite(maxSlots) || maxSlots <= 0) return 0
  if (selectedCount <= 0 || interestCount <= 0) return 0

  return Math.max(0, Math.min(interestCount, Math.floor(maxSlots), selectedCount))
}

/**
 * Choose which candidates fill the reserved slots.
 *
 * Walks the interests in order (their existing created_at DESC order, so the
 * newest interests get represented first) and gives each one slot before any
 * interest gets a second. For each, the filler is the highest-scoring
 * qualifying member of that interest's top INTEREST_SLOT_MATCH_POOL matches --
 * "the best time travel film you haven't seen", not an arbitrary one, and not
 * a high-scoring title that merely brushes against the phrase.
 *
 * Fully deterministic: ties on finalScore break to the lower candidate id, so
 * the same inputs always produce the same picks even though ANN tie order is
 * not guaranteed.
 */
export function pickInterestSlotFillers<T extends { id: string; finalScore: number }>(
  alreadySelected: T[],
  scored: T[],
  index: InterestMatchIndex,
  slots: number
): Array<{ candidate: T; match: InterestCandidateMatch }> {
  if (slots <= 0 || index.byInterest.length === 0) return []

  const scoredById = new Map<string, T>()
  for (const candidate of scored) {
    if (!scoredById.has(candidate.id)) scoredById.set(candidate.id, candidate)
  }

  const taken = new Set(alreadySelected.map((candidate) => candidate.id))
  const fillers: Array<{ candidate: T; match: InterestCandidateMatch }> = []

  // Round-robin so a single interest with many strong matches can't take every
  // slot while another interest goes unrepresented.
  while (fillers.length < slots) {
    let pickedThisRound = false

    for (const interest of index.byInterest) {
      if (fillers.length >= slots) break

      let bestCandidate: T | null = null
      let bestMatch: InterestCandidateMatch | null = null

      // Only the interest's strongest matches are eligible -- see
      // INTEREST_SLOT_MATCH_POOL. matches are similarity-sorted.
      for (const match of interest.matches.slice(0, INTEREST_SLOT_MATCH_POOL)) {
        if (match.weightedSimilarity < MIN_INTEREST_SLOT_SIMILARITY) {
          // everything after this is weaker still
          break
        }
        if (taken.has(match.candidateId)) continue

        const candidate = scoredById.get(match.candidateId)
        if (!candidate) continue

        if (
          !bestCandidate ||
          candidate.finalScore > bestCandidate.finalScore ||
          (candidate.finalScore === bestCandidate.finalScore && candidate.id < bestCandidate.id)
        ) {
          bestCandidate = candidate
          bestMatch = match
        }
      }

      if (bestCandidate && bestMatch) {
        taken.add(bestCandidate.id)
        fillers.push({ candidate: bestCandidate, match: bestMatch })
        pickedThisRound = true
      }
    }

    // No interest could supply anything -- leave the remaining slots unused
    // rather than looping forever or padding with weak picks.
    if (!pickedThisRound) break
  }

  return fillers
}
