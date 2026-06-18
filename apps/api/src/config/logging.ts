/**
 * Access-log noise control for high-frequency poll routes.
 *
 * The web UI polls a few endpoints every couple of seconds (e.g. GET
 * /api/jobs/active from the running-jobs widget, the admin layout, and the
 * discovery status hook). Combined with Fastify's per-request access logging
 * that floods container logs. This module lets those routes be silenced.
 *
 * Two controls, in precedence order:
 *   1. The `quiet_poll_logs` system setting — toggled at runtime from
 *      Settings > System ("Quiet poll-route logs"). Wins when set.
 *   2. The `QUIET_POLL_LOGS` env var — the bootstrap default when the setting
 *      is unset:
 *        - unset / false      -> log every request (default behaviour)
 *        - true               -> quiet the default poll routes
 *        - "<path>,<path>"    -> quiet exactly the listed routes instead
 *
 * State is cached in memory and read synchronously on every request (no DB hit).
 * It is refreshed at startup and whenever the setting is saved.
 */
import { getSystemSetting } from '@aperture/core'

/** System-setting key backing the Settings > System UI toggle. */
export const QUIET_POLL_LOGS_SETTING = 'quiet_poll_logs'

/** Routes silenced when quiet-poll logging is enabled (=true). */
const DEFAULT_QUIET_POLL_ROUTES = ['/api/jobs/active']

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FALSY = new Set(['', '0', 'false', 'no', 'off'])

interface QuietPollState {
  enabled: boolean
  routes: Set<string>
}

/** Parse the QUIET_POLL_LOGS env var into a state (the bootstrap default). */
function parseEnv(): QuietPollState {
  const raw = (process.env.QUIET_POLL_LOGS ?? '').trim()
  const lower = raw.toLowerCase()

  if (FALSY.has(lower)) return { enabled: false, routes: new Set() }
  if (TRUTHY.has(lower)) return { enabled: true, routes: new Set(DEFAULT_QUIET_POLL_ROUTES) }

  // Any other non-empty value is a comma-separated list of routes to quiet.
  const routes = raw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
  if (routes.length === 0) return { enabled: false, routes: new Set() }
  return { enabled: true, routes: new Set(routes) }
}

// Seeded from env at module load so the request hooks work before the DB is
// reachable; refreshed from the DB setting at startup and on save.
let state: QuietPollState = parseEnv()

/** Whether quiet-poll logging is currently active (sync, cached). */
export function isQuietPollEnabled(): boolean {
  return state.enabled
}

/**
 * Refresh the cached state. The `quiet_poll_logs` setting (UI toggle) takes
 * precedence; when unset, the QUIET_POLL_LOGS env var is the default. Fails open
 * to the env-derived state if the DB is unreachable.
 */
export async function refreshQuietPollState(): Promise<void> {
  try {
    const dbVal = await getSystemSetting(QUIET_POLL_LOGS_SETTING)
    if (dbVal === 'true') {
      state = { enabled: true, routes: new Set(DEFAULT_QUIET_POLL_ROUTES) }
      return
    }
    if (dbVal === 'false') {
      state = { enabled: false, routes: new Set() }
      return
    }
    state = parseEnv()
  } catch {
    state = parseEnv()
  }
}

/** True when this request path is one of the currently-silenced poll routes. */
function isQuietRoute(url: string): boolean {
  if (!state.enabled) return false
  const path = url.split('?')[0]
  return state.routes.has(path)
}

/** Whether to emit the "incoming request" access log for this request. */
export function shouldLogIncoming(url: string): boolean {
  return !isQuietRoute(url)
}

/**
 * Whether to emit the "request completed" access log. Failures (>= 400) are
 * always logged even on quiet routes, so problems stay visible.
 */
export function shouldLogCompleted(url: string, statusCode: number): boolean {
  if (statusCode >= 400) return true
  return !isQuietRoute(url)
}
