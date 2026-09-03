/**
 * Periodic cleanup of expired authentication state.
 *
 * Sessions were previously only removed when someone presented an expired
 * cookie, so rows for abandoned sessions accumulated forever. Failed-login
 * counters have the same problem once an attack stops.
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'

const logger = createChildLogger('auth-cleanup')

/**
 * Idle cutoff, mirroring SESSION_IDLE_DAYS in apps/api/src/plugins/auth.ts.
 *
 * The margin below is what makes the duplication safe: this job is janitorial,
 * and the auth plugin stays the sole authority on whether a session is still
 * alive. Deleting on exactly the same boundary would mean that if the two
 * constants ever drift apart — they live in different packages — this job could
 * start signing active users out, with nothing to show for it but a session
 * that vanished.
 */
const SESSION_IDLE_DAYS = 7
const IDLE_GRACE_DAYS = 1

export interface AuthCleanupResult {
  expiredSessions: number
  idleSessions: number
  staleLoginAttempts: number
  expiredImpersonations: number
}

/**
 * Delete sessions past their absolute or idle deadline, plus login-attempt
 * counters that are no longer holding a lock.
 */
export async function cleanupExpiredAuthState(): Promise<AuthCleanupResult> {
  const expired = await query('DELETE FROM sessions WHERE expires_at < NOW()')

  const idle = await query(
    `DELETE FROM sessions WHERE last_seen_at < NOW() - make_interval(days => $1::int)`,
    [SESSION_IDLE_DAYS + IDLE_GRACE_DAYS]
  )

  const attempts = await query(
    `DELETE FROM login_attempts
      WHERE (locked_until IS NULL OR locked_until < NOW())
        AND last_failed_at < NOW() - INTERVAL '1 day'`
  )

  // Assumption grants ("view as user"). Deleting on the exact deadline is safe
  // here, unlike sessions above: the auth plugin already refuses a lapsed grant
  // before this job ever sees it, so the row is dead either way and there is no
  // live state for a boundary disagreement to cost.
  const impersonations = await query(
    'DELETE FROM impersonation_sessions WHERE expires_at < NOW()'
  )

  const result: AuthCleanupResult = {
    expiredSessions: expired.rowCount ?? 0,
    idleSessions: idle.rowCount ?? 0,
    staleLoginAttempts: attempts.rowCount ?? 0,
    expiredImpersonations: impersonations.rowCount ?? 0,
  }

  logger.info(result, 'Auth cleanup complete')

  return result
}
