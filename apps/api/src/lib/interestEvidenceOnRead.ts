/**
 * An interest pick's evidence, filled in on read when its run stored none.
 *
 * Evidence is stored by the pipeline and by the explanation refresh
 * (core recommender/shared/interestEvidence.ts). Every interest pick on a run
 * made before that carries a `weightedSimilarity` and no evidence, so the
 * insights banner told The Drama — tagged "dark comedy" by TMDb — that
 * "nothing in its genres or keywords confirms it is one" until someone
 * regenerated or rewrote it. The fact is cheap to check, so the route checks
 * it against the title's current tags instead of waiting.
 *
 * Only ever ADDS evidence the title's tags prove, on a copy; the stored row
 * is untouched, and a pick whose tags do not say the interest is left as it
 * is (the banner then says nothing confirms it, which is true).
 */

import { matchInterestEvidence, readInterestEvidence, type InterestTitleFacts } from '@aperture/core'

export function withInterestEvidenceOnRead<T>(scoreBreakdown: T, facts: InterestTitleFacts | null): T {
  if (!facts || typeof scoreBreakdown !== 'object' || scoreBreakdown === null) return scoreBreakdown
  const breakdown = scoreBreakdown as Record<string, unknown>
  const match = breakdown.interestMatch
  if (typeof match !== 'object' || match === null) return scoreBreakdown

  const interest = match as Record<string, unknown>
  if (readInterestEvidence(interest.evidence)) return scoreBreakdown
  if (typeof interest.interestText !== 'string' || !interest.interestText.trim()) return scoreBreakdown

  const evidence = matchInterestEvidence(interest.interestText, facts)
  if (!evidence) return scoreBreakdown
  return { ...breakdown, interestMatch: { ...interest, evidence } } as T
}
