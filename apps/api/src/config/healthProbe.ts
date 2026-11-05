/**
 * The container's own health check, seen from both ends: the address it dials
 * and how the server treats it when it arrives.
 *
 * Pure, and free of @aperture/core: healthcheck.ts loads this module and nothing
 * else, in a new process every 30 seconds.
 */
import { isIPv6 } from 'node:net'

type Env = Record<string, string | undefined>

/** Where the server binds. IPv4 only by default, see the comment in index.ts. */
export function listenHost(env: Env = process.env): string {
  return env.HOST?.trim() || '0.0.0.0'
}

/** The address a process in the same container reaches that bind address on. */
function dialAddress(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '[::1]'
  return isIPv6(host) ? `[${host}]` : host
}

/**
 * What the health check calls. Never "localhost" for the default bind: which
 * address that name gives first depends on the container's network, and the
 * server only listens on one family.
 */
export function probeUrl(env: Env = process.env): string {
  const port = env.PORT?.trim() || '3456'
  return `http://${dialAddress(listenHost(env))}:${port}/health`
}

const PROBE_ROUTES = new Set(['/health', '/ready', '/live'])

function isLoopback(address: string): boolean {
  const plain = address.replace(/^::ffff:/i, '')
  return plain === '::1' || plain.startsWith('127.')
}

/**
 * Whether a request is the container checking itself: a probe route, from
 * loopback, not forwarded. The route alone is not enough. The admin dashboard
 * polls /health from a browser, and an outside monitor may call it through the
 * proxy; those are visitors, and their forwarding headers are evidence the
 * deployment posture needs.
 */
export function isContainerProbe(
  url: string,
  peerAddress: string | undefined,
  hasForwardedFor: boolean
): boolean {
  if (hasForwardedFor || !peerAddress || !isLoopback(peerAddress)) return false
  return PROBE_ROUTES.has(url.split('?')[0])
}

let lastProbeOk: boolean | null = null

/**
 * Whether to log a finished container probe. Every failure, the first answer
 * after boot, and the first answer after a failure. That keeps two lines per 30
 * seconds out of the log and still lets a reader see that probes are arriving,
 * which is the only evidence a log can give when a container reads unhealthy.
 * Call once per response: each call moves the state.
 */
export function shouldLogContainerProbe(statusCode: number): boolean {
  const ok = statusCode < 400
  const changed = ok !== lastProbeOk
  lastProbeOk = ok
  return changed || !ok
}

export function resetContainerProbeLog(): void {
  lastProbeOk = null
}
