/**
 * Custom-interest matching and reserved recommendation slots.
 *
 * A custom interest ("Time travel stories") is a taste facet the user states
 * outright rather than one inferred from watch history. It used to reach the
 * pipeline only as a preference multiplier, which cannot surface anything:
 * interest carries weight 0.3 of a 1.3 total in PREFERENCE_DIMENSION_WEIGHTS
 * and that is scaled by the preference strength, so even a perfect interest
 * match closes a small share of a candidate's remaining gap to 1.0 -- never
 * enough to lift something the generic taste score already ranked below the
 * cut. Raising that weight was rejected: it is global, so it would retune
 * franchise/genre for every user, interests or not.
 *
 * So interests earn a small number of *reserved slots* in the final selection
 * instead. Scoring is left exactly as it was; a bounded few of the picks are
 * simply drawn from interest matches rather than from the top of the ranking.
 *
 * WHAT COUNTS AS A MATCH is a fact on the title -- a genre or TMDb keyword that
 * says the interest (interestEvidence.ts) -- and no longer embedding nearness
 * to the typed phrase. That module says why: the cosine bars were dead on the
 * current model and the nearest titles to a tone phrase were the ones sharing
 * its words. Both the slots and the preference affinity read the same
 * evidence, so a title the slots refuse cannot still be nudged as a "strong
 * match" by the scoring loop.
 *
 * Everything here is pure -- no DB access. The facts are loaded by
 * recommender/interestMatches.ts.
 */

import {
  interestAffinityFromEvidence,
  matchPreparedEvidence,
  prepareInterest,
  prepareTitleFacts,
  type InterestEvidence,
  type InterestTitleFacts,
  type PreparedTitleFacts,
} from './interestEvidence.js'

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
 * The single best interest match for one candidate.
 */
export interface InterestMatch {
  interestId: string
  interestText: string
  /**
   * The genres/keywords on the title that say the interest. Null only for the
   * non-Latin fallback (`nearest` in buildInterestMatchIndex): a title near
   * the phrase that nothing confirms, which every reader calls "close to" it.
   */
  evidence: InterestEvidence | null
  /** 0.5 (neutral) | 0.8 | 1.0, scaled by the interest's weight -- feeds PreferenceAffinities.interest. */
  affinity: number
}

export interface InterestCandidateMatch extends InterestMatch {
  candidateId: string
}

export interface InterestMatchIndex {
  /** candidateId -> its strongest match across all of the user's interests. */
  best: Map<string, InterestMatch>
  /**
   * Per-interest match lists, in the user's interest order. Only titles whose
   * metadata backs the interest are listed, `phrase` evidence before `parts`.
   */
  byInterest: Array<{
    interestId: string
    interestText: string
    matches: InterestCandidateMatch[]
  }>
}

/** One of the user's interests, as the pipeline hands it over. */
export interface InterestInput {
  interestId: string
  interestText: string
  /** The user's weight for this interest (1.0 in user_custom_interests unless set). NUMERIC may arrive as text. */
  weight: number | string | null
}

const STRENGTH_ORDER: Record<InterestEvidence['strength'], number> = { phrase: 0, parts: 1 }

/** Rank of a match's evidence, strongest first; an unconfirmed match is last. */
function strengthRank(evidence: InterestEvidence | null): number {
  return evidence ? STRENGTH_ORDER[evidence.strength] : 2
}

/**
 * Check every candidate's metadata against every interest and fold the
 * verified matches into the lookup structures the pipeline needs: one
 * best-match-per-candidate map for the scoring loop, and the per-interest
 * lists reserved slots are drawn from.
 *
 * `facts` is keyed by candidate id; a candidate missing from it simply has
 * nothing to match on.
 *
 * `nearest` is the one exception to "a match is a fact": candidate ids nearest
 * an interest's embedded phrase, offered only for an interest written in a
 * non-Latin script (interestIsNonLatin). TMDb's keywords are English, so such an
 * interest can be confirmed only by a genre the media server stores in that
 * language; when none is, these titles are used instead, with no evidence.
 * They never move the score (affinity stays neutral) and every reader calls
 * them "close to" the interest. Cross-script, the phrase shares no words with
 * the English documents, so the lexical attraction that made this unusable for
 * English phrases has nothing to grip — an argument, not a measurement.
 */
export function buildInterestMatchIndex(
  interests: InterestInput[],
  facts: Map<string, InterestTitleFacts>,
  nearest: Map<string, string[]> = new Map()
): InterestMatchIndex {
  const best = new Map<string, InterestMatch>()
  const byInterest: InterestMatchIndex['byInterest'] = []

  // Each title's facts and each interest are normalised ONCE; matching is
  // then lookups. Doing it inside the loop re-normalised every tag of every
  // candidate once per interest.
  const prepared = new Map<string, PreparedTitleFacts>()
  for (const [candidateId, titleFacts] of facts) prepared.set(candidateId, prepareTitleFacts(titleFacts))

  for (const interest of interests) {
    const matches: InterestCandidateMatch[] = []
    const preparedInterest = prepareInterest(interest.interestText)
    for (const [candidateId, byPhrase] of prepared) {
      const evidence = matchPreparedEvidence(preparedInterest, byPhrase)
      if (!evidence) continue
      matches.push({
        candidateId,
        interestId: interest.interestId,
        interestText: interest.interestText,
        evidence,
        affinity: interestAffinityFromEvidence(evidence, interest.weight),
      })
    }

    // Strongest evidence first, then id so the order is stable.
    matches.sort(
      (a, b) =>
        strengthRank(a.evidence) - strengthRank(b.evidence) ||
        (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0)
    )

    // The non-Latin fallback, only when nothing confirmed this interest.
    if (matches.length === 0) {
      for (const candidateId of nearest.get(interest.interestId) ?? []) {
        matches.push({
          candidateId,
          interestId: interest.interestId,
          interestText: interest.interestText,
          evidence: null,
          affinity: 0.5,
        })
      }
    }

    for (const match of matches) {
      // An unconfirmed match moves no score, so it has no place in `best`.
      if (!match.evidence) continue
      const existing = best.get(match.candidateId)
      if (!existing || match.affinity > existing.affinity) {
        best.set(match.candidateId, {
          interestId: match.interestId,
          interestText: match.interestText,
          evidence: match.evidence,
          affinity: match.affinity,
        })
      }
    }

    byInterest.push({
      interestId: interest.interestId,
      interestText: interest.interestText,
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
 * candidate among its STRONGEST verified matches -- a title tagged with the
 * whole phrase beats one assembled from parts, and among equals the viewer's
 * own score decides: "the best dark comedy you haven't seen", backed by a tag
 * that says it is one.
 *
 * An interest with no verified match fills nothing. That is the point: a
 * missing pick costs nothing, and "this is what you asked for" said of a title
 * that is not costs trust.
 *
 * Fully deterministic: ties on finalScore break to the lower candidate id.
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

  // Round-robin so a single interest with many matches can't take every slot
  // while another interest goes unrepresented.
  while (fillers.length < slots) {
    let pickedThisRound = false

    for (const interest of index.byInterest) {
      if (fillers.length >= slots) break

      let bestCandidate: T | null = null
      let bestMatch: InterestCandidateMatch | null = null

      for (const match of interest.matches) {
        // matches are ordered strongest evidence first; once a pick exists,
        // weaker evidence cannot displace it.
        if (bestMatch && strengthRank(match.evidence) > strengthRank(bestMatch.evidence)) {
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
