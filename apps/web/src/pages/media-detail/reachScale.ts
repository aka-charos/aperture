/**
 * The household reach scale as the title page draws it. The level is decided by
 * the server (core `watching/householdReach.ts`, whose test pins this list to its
 * own); this file only knows the order, for the filled steps, and the strings.
 */

export const REACH_LEVELS = ['niche', 'familiar', 'popular', 'mostWatched'] as const

export interface ReachStep {
  /** 1-based position on the scale. */
  step: number
  nameKey: string
  hintKey: string
}

/** Null for no level or one this build doesn't know: the strip then draws no scale. */
export function reachStep(level: string | null | undefined): ReachStep | null {
  const index = REACH_LEVELS.findIndex((known) => known === level)
  if (index < 0) return null
  return {
    step: index + 1,
    nameKey: `mediaDetail.infoCard.reachLevel.${REACH_LEVELS[index]}`,
    hintKey: `mediaDetail.infoCard.reachHint.${REACH_LEVELS[index]}`,
  }
}
