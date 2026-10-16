/**
 * What the insights panel says about a pick a stated interest placed.
 *
 * The panel used to say nothing at all: an interest pick only switched the
 * evidence heading to "not why it was picked", so the reason — the interest —
 * existed only inside the AI prose, which a viewer with AI explanations off
 * never sees. The banner states it, and states what backs it: the title's own
 * genres/keywords (core recommender/shared/interestEvidence.ts) when they say
 * the interest, or that nothing does for an older pick chosen by embedding
 * nearness.
 *
 * Reads score_breakdown as it arrives (JSONB, no schema, older runs carry a
 * `weightedSimilarity` and no `evidence`). Pure, so the shape rules are pinned
 * without rendering anything; the bundle never imports core, so this mirrors
 * core's `readInterestEvidence` by hand.
 */

export interface InterestPick {
  /** What the viewer said they like, in their words. */
  interest: string
  /** The genres/keywords that say it; null when nothing confirmed the match. */
  tags: string[] | null
}

export function readInterestPick(scoreBreakdown: unknown): InterestPick | null {
  if (typeof scoreBreakdown !== 'object' || scoreBreakdown === null) return null
  const match = (scoreBreakdown as Record<string, unknown>).interestMatch
  if (typeof match !== 'object' || match === null) return null

  const { interestText, evidence } = match as Record<string, unknown>
  if (typeof interestText !== 'string' || !interestText.trim()) return null

  let tags: string[] | null = null
  if (typeof evidence === 'object' && evidence !== null) {
    const matched = (evidence as Record<string, unknown>).matched
    if (Array.isArray(matched)) {
      const found = matched.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      if (found.length > 0) tags = found
    }
  }

  return { interest: interestText.trim(), tags }
}
