/**
 * Access-log noise control for high-frequency poll routes.
 *
 * By default Fastify logs an "incoming request" / "request completed" pair at
 * info level for every request. The web UI polls a few endpoints every couple
 * of seconds (e.g. GET /api/jobs/active from the running-jobs widget, the admin
 * layout, and the discovery status hook), which floods container logs.
 *
 * Behaviour is opt-in via the QUIET_POLL_LOGS env var:
 *   - unset / false  -> default: every request is logged (no change).
 *   - true           -> the routes in DEFAULT_QUIET_POLL_ROUTES are raised to
 *                       'warn', suppressing their info req/res pairs while still
 *                       logging warnings and errors.
 *   - "<path>,<path>" -> quiet exactly the listed route paths instead of the
 *                        default set, e.g. QUIET_POLL_LOGS=/api/jobs/active,/health
 */

/** Routes silenced when QUIET_POLL_LOGS is simply enabled (=true). */
const DEFAULT_QUIET_POLL_ROUTES = ['/api/jobs/active']

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FALSY = new Set(['', '0', 'false', 'no', 'off'])

export interface QuietPollConfig {
  enabled: boolean
  routes: Set<string>
}

/**
 * Resolve the quiet-poll-logs configuration from QUIET_POLL_LOGS.
 * Returns { enabled: false } when unset/false — i.e. current default behaviour.
 */
export function getQuietPollConfig(): QuietPollConfig {
  const raw = (process.env.QUIET_POLL_LOGS ?? '').trim()
  const lower = raw.toLowerCase()

  if (FALSY.has(lower)) return { enabled: false, routes: new Set() }

  if (TRUTHY.has(lower)) {
    return { enabled: true, routes: new Set(DEFAULT_QUIET_POLL_ROUTES) }
  }

  // Any other non-empty value is treated as a comma-separated list of routes.
  const routes = raw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)

  if (routes.length === 0) return { enabled: false, routes: new Set() }
  return { enabled: true, routes: new Set(routes) }
}
