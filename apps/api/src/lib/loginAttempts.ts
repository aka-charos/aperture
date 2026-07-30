/**
 * Per-account failed-login tracking.
 *
 * Complements the per-IP HTTP rate limit on POST /api/auth/login: that caps how
 * fast one source can guess, this caps how many times a single account can be
 * guessed at from anywhere. Both are needed — the login route proxies straight
 * to Emby/Jellyfin, so without them Aperture is an unmetered brute-force relay
 * against the media server, and every attempt reaches it from a single host IP
 * where the media server's own lockout cannot tell attacker from user.
 *
 * KNOWN TRADE-OFF: any account-lockout scheme lets someone who knows a username
 * deny that user service by failing on purpose. It is accepted here rather than
 * solved, because the alternatives are worse for a publicly reachable instance:
 * keying the lock to (account, IP) would leave a distributed attempt unmetered,
 * and dropping the lock entirely would leave the per-IP limit as the only
 * control, which a botnet walks straight past. The damage is bounded by the
 * 60-minute cap and by the decay below — an attacker must keep spending
 * failures to hold a lock, and each one is 5 minutes at a time until they build
 * the backoff back up. Sustained guessing against one account settles at ~15
 * attempts/hour, which is useless for guessing a real password.
 */

import { query, queryOne } from './db.js'
import { createChildLogger } from './logger.js'

const logger = createChildLogger('login-attempts')

/** Failures below this never lock the account. */
const LOCKOUT_THRESHOLD = 5
/** A quiet spell this long clears the counter. */
const FAILURE_WINDOW_MINUTES = 15
/** First lockout duration; doubles per additional failure. */
const BASE_LOCKOUT_MINUTES = 5
const MAX_LOCKOUT_MINUTES = 60

export interface LockoutStatus {
  locked: boolean
  /** Seconds until the lock expires. Only meaningful when locked. */
  retryAfterSeconds: number
}

const NOT_LOCKED: LockoutStatus = { locked: false, retryAfterSeconds: 0 }

interface AttemptRow {
  failed_count: number
  last_failed_at: Date
  locked_until: Date | null
}

/**
 * Normalize a submitted username into a lockout key.
 *
 * Lowercased so that casing variants share one counter — both Emby and
 * Jellyfin treat usernames case-insensitively at login.
 */
function usernameKey(username: string): string {
  return username.trim().toLowerCase()
}

function lockoutMinutes(failedCount: number): number {
  const overage = Math.max(0, failedCount - LOCKOUT_THRESHOLD)
  return Math.min(BASE_LOCKOUT_MINUTES * 2 ** overage, MAX_LOCKOUT_MINUTES)
}

/**
 * Check whether logins for this username are currently locked out.
 *
 * Fails open: a database problem must not make the app unloggable-into.
 */
export async function checkLoginLockout(username: string): Promise<LockoutStatus> {
  const key = usernameKey(username)
  if (!key) return NOT_LOCKED

  try {
    const row = await queryOne<AttemptRow>(
      'SELECT failed_count, last_failed_at, locked_until FROM login_attempts WHERE username_key = $1',
      [key]
    )

    if (!row?.locked_until) return NOT_LOCKED

    const remainingMs = new Date(row.locked_until).getTime() - Date.now()
    if (remainingMs <= 0) return NOT_LOCKED

    return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
  } catch (err) {
    logger.warn({ err }, 'Could not read login lockout state; allowing attempt')
    return NOT_LOCKED
  }
}

/**
 * Record a failed login and apply progressive lockout once the threshold is hit.
 *
 * The counter resets itself when the previous failure is older than the failure
 * window and no lock is active, so an occasional typo never accumulates into a
 * lockout.
 */
export async function recordFailedLogin(username: string): Promise<LockoutStatus> {
  const key = usernameKey(username)
  if (!key) return NOT_LOCKED

  try {
    // The counter decays: a quiet spell longer than the failure window resets
    // it to 1, provided no lock is currently in force. Testing `locked_until <
    // NOW()` rather than `IS NULL` is what makes the escalation non-sticky —
    // otherwise the first lockout would raise the backoff permanently, so an
    // attacker could hold an account at the 60-minute cap with one request an
    // hour, and a user who mistyped twice in a day would pay for the first one.
    const row = await queryOne<AttemptRow>(
      `INSERT INTO login_attempts (username_key, failed_count, first_failed_at, last_failed_at)
       VALUES ($1, 1, NOW(), NOW())
       ON CONFLICT (username_key) DO UPDATE SET
         failed_count = CASE
           WHEN login_attempts.last_failed_at < NOW() - make_interval(mins => $2::int)
            AND (login_attempts.locked_until IS NULL OR login_attempts.locked_until < NOW())
           THEN 1
           ELSE login_attempts.failed_count + 1
         END,
         first_failed_at = CASE
           WHEN login_attempts.last_failed_at < NOW() - make_interval(mins => $2::int)
            AND (login_attempts.locked_until IS NULL OR login_attempts.locked_until < NOW())
           THEN NOW()
           ELSE login_attempts.first_failed_at
         END,
         locked_until = CASE
           WHEN login_attempts.last_failed_at < NOW() - make_interval(mins => $2::int)
            AND (login_attempts.locked_until IS NULL OR login_attempts.locked_until < NOW())
           THEN NULL
           ELSE login_attempts.locked_until
         END,
         last_failed_at = NOW()
       RETURNING failed_count, last_failed_at, locked_until`,
      [key, FAILURE_WINDOW_MINUTES]
    )

    if (!row) return NOT_LOCKED

    if (row.failed_count < LOCKOUT_THRESHOLD) return NOT_LOCKED

    const minutes = lockoutMinutes(row.failed_count)
    await query(
      `UPDATE login_attempts
         SET locked_until = NOW() + make_interval(mins => $2::int)
       WHERE username_key = $1`,
      [key, minutes]
    )

    logger.warn(
      { failedCount: row.failed_count, lockoutMinutes: minutes },
      'Account locked after repeated failed logins'
    )

    return { locked: true, retryAfterSeconds: minutes * 60 }
  } catch (err) {
    logger.warn({ err }, 'Could not record failed login')
    return NOT_LOCKED
  }
}

/** Clear the counter after a successful authentication. */
export async function clearLoginAttempts(username: string): Promise<void> {
  const key = usernameKey(username)
  if (!key) return

  try {
    await query('DELETE FROM login_attempts WHERE username_key = $1', [key])
  } catch (err) {
    logger.warn({ err }, 'Could not clear login attempts')
  }
}
