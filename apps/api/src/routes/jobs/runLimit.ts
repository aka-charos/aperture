/**
 * The per-run item cap a job may declare (`JobDefinition.runLimit`) and the
 * stored override for it (`job_config.max_items_per_run`).
 *
 * Two decisions live here, and both have a caller that must not restate them:
 * the config route asks whether a submitted value is acceptable, and the
 * executor asks what a stored value means. Pure, so both answers are pinned by
 * `runLimit.test.ts` without a database.
 */

import type { JobRunLimit } from './types.js'

/**
 * Why a submitted cap is unacceptable, or null when it is fine.
 *
 * Null (clear back to the default) is always accepted for a job that declares a
 * limit. A job that declares none refuses any number, because storing one would
 * put a setting on screen that nothing reads. Out-of-range values are refused
 * rather than clamped: a clamped value is a setting the operator did not choose.
 */
export function runLimitError(limit: JobRunLimit | undefined, value: number | null): string | null {
  if (value === null) return null
  if (!limit) return 'This job does not take a per-run limit'
  if (!Number.isInteger(value) || value < limit.min || value > limit.max) {
    return `Items per run must be a whole number between ${limit.min} and ${limit.max}`
  }
  return null
}

/**
 * The cap a run actually uses.
 *
 * Unset reads as the declared default. So does a stored value now outside the
 * declared range (the range can move between builds): it reads as unset, never
 * clamped, the same rule the route applies on the way in.
 */
export function resolveRunLimit(limit: JobRunLimit, stored: number | null | undefined): number {
  if (stored == null) return limit.default
  if (!Number.isInteger(stored) || stored < limit.min || stored > limit.max) return limit.default
  return stored
}
