/**
 * How many suggestions a title's own page asks Next from here for: an admin
 * setting, with limits the engine imposes. Pure, pinned by
 * nextFromHere.test.ts.
 *
 * The ceiling is the neighbour pool. A suggestion is ranked first by how close
 * it feels (rules.ts `SCORE_WEIGHTS`), and only `NEIGHBOUR_POOL` titles are
 * asked of the embedding; past them the list could only go on with titles
 * linked by credits alone, ordered by another signal, so a longer list would
 * stop being "closest first" without saying so. The pool is fixed rather than
 * raised with the setting because closeness is a rank scaled by how many
 * neighbours came back (taste.ts `closenessFromRank`): a bigger pool would
 * move every closeness score against the credit and taste terms, on the
 * Next from here page and in the walk as well as here.
 *
 * The floor is one: no setting turns the panel off, since an empty panel on
 * every title page would only read as broken.
 *
 * The page draws whole rows (`wholeRowCount` on the web side), so the number
 * is a ceiling there too: 12 on a five-column grid shows 10.
 */

import { NEIGHBOUR_POOL } from './rules.js'

export const SUMMARY_SIZE_DEFAULT = 12
export const SUMMARY_SIZE_MIN = 1
export const SUMMARY_SIZE_MAX = NEIGHBOUR_POOL

/** The limits, as the settings route sends them (the bundle holds no copy). */
export interface SummarySizeLimits {
  value: number
  default: number
  min: number
  max: number
}

/** Why a value cannot be saved; null when it can. Refused, never clamped. */
export function summarySizeProblem(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'must be a whole number'
  if (value < SUMMARY_SIZE_MIN || value > SUMMARY_SIZE_MAX) {
    return `must be between ${SUMMARY_SIZE_MIN} and ${SUMMARY_SIZE_MAX}`
  }
  return null
}

/**
 * The size a stored value means: unset, unreadable or out of range reads as
 * the default (a row written by hand, or before a limit moved, must not break
 * every title page).
 */
export function readSummarySize(stored: string | null | undefined): number {
  if (stored == null || stored.trim() === '') return SUMMARY_SIZE_DEFAULT
  const value = Number(stored)
  return summarySizeProblem(value) == null ? value : SUMMARY_SIZE_DEFAULT
}
