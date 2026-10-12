/**
 * The two weight lists on the Recommendations tab, and the rules both cards
 * read them by. Pure, so the numbers each card shows as "more of" or "less of"
 * are decided once and pinned by `weights.test.ts`.
 */

export type WeightTone = 'up' | 'neutral' | 'down'

export interface WeightScale {
  min: number
  max: number
  step: number
  /** The stored value that means "no preference". */
  neutral: number
  /** How far from neutral a value must be before it counts as a lean either way. */
  band: number
}

/** Genre weights multiply a genre's influence: 1 is unchanged, 0 is none, 2 is double. */
export const GENRE_SCALE: WeightScale = { min: 0, max: 2, step: 0.1, neutral: 1, band: 0.3 }

/** Franchise preferences are signed: -1 avoid, 0 no view, 1 boost. */
export const FRANCHISE_SCALE: WeightScale = { min: -1, max: 1, step: 0.1, neutral: 0, band: 0.3 }

/**
 * Where a value sits. The dead band means a slider nudged a notch off neutral
 * still reads as neutral, exactly as the lists always labelled it — the
 * thresholds are the ones each card used before they were shared.
 */
export function weightTone(value: number, scale: WeightScale): WeightTone {
  if (value > scale.neutral + scale.band) return 'up'
  if (value < scale.neutral - scale.band) return 'down'
  return 'neutral'
}

/** The names leaning each way, strongest first, so a summary that has to cut a list cuts the weakest. */
export function summarizeWeights<T>(
  items: readonly T[],
  scale: WeightScale,
  nameOf: (item: T) => string,
  valueOf: (item: T) => number
): { up: string[]; down: string[] } {
  const distance = (item: T) => Math.abs(valueOf(item) - scale.neutral)
  const byStrength = [...items].sort((a, b) => distance(b) - distance(a) || nameOf(a).localeCompare(nameOf(b)))
  return {
    up: byStrength.filter((item) => weightTone(valueOf(item), scale) === 'up').map(nameOf),
    down: byStrength.filter((item) => weightTone(valueOf(item), scale) === 'down').map(nameOf),
  }
}

/**
 * Newly detected entries first, then alphabetical. A scan's finds go to the
 * top of the list rather than wherever the alphabet puts them, which is what
 * lets the list do without a separate "jump to the new ones" panel.
 */
export function orderWithNewFirst<T>(items: readonly T[], newNames: readonly string[], nameOf: (item: T) => string): T[] {
  const fresh = new Set(newNames)
  return [...items].sort((a, b) => {
    const aNew = fresh.has(nameOf(a)) ? 0 : 1
    const bNew = fresh.has(nameOf(b)) ? 0 : 1
    return aNew - bNew || nameOf(a).localeCompare(nameOf(b))
  })
}
