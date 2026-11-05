/**
 * Which requests carrying an `Origin` header are let through.
 *
 * A browser sends `Origin` on more than cross-origin calls: on every same-origin
 * POST, and in Chrome on same-origin module scripts too. So comparing it with
 * APP_BASE_URL alone refused an instance reached by any other address (a LAN
 * address beside a public domain) its own entry chunk, and the page stayed blank.
 *
 * Three answers:
 *
 * - `cors`: an origin named in configuration. The only answer that adds
 *   Access-Control-Allow-Origin and -Credentials, so the only one that lets a
 *   page on another origin read a response.
 * - `no-headers`: passes without CORS headers. A same-origin request needs none,
 *   since the browser does not consult CORS for it, so even a wrong reading of
 *   the arrival address could never hand a foreign site credentialed access. A
 *   public file asked for by a foreign page gets this too: the browser keeps the
 *   response from that page, and the file is no secret anyway.
 * - `refuse`: anything else. This stops the request before its handler, which is
 *   also a defence against forged cross-site writes, so it stays for every API
 *   route and every method that can write.
 *
 * Nothing here imports code: `corsDelegator` is handed the proxy trust, and the
 * tests run without a database.
 */

import type { FastifyCorsOptions } from '@fastify/cors'

const DEV_ORIGINS = [
  'http://localhost:3456',
  'http://localhost:3457',
  'http://127.0.0.1:3456',
  'http://127.0.0.1:3457',
]

/** Served by routes rather than from the built web app; serverBoot.test.ts checks. */
const ROUTE_PREFIXES = ['/api', '/health', '/openapi', '/ready', '/live']

export type CorsDecision = 'cors' | 'no-headers' | 'refuse'

export interface ArrivalAddress {
  /** As the client wrote it: a host and maybe a port. */
  host: string | undefined
  /** Only ever a known https; see {@link arrivalAddress}. */
  scheme: 'https' | undefined
}

type HeaderValue = string | string[] | undefined

/** Proxies append, so the last entry is the one the nearest proxy wrote. */
function lastEntry(value: HeaderValue): string | undefined {
  const joined = Array.isArray(value) ? value.join(',') : value
  const last = joined?.split(',').pop()?.trim()
  return last || undefined
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** Origins named in configuration: the only ones that get CORS headers. */
export function configuredOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const appBaseUrl = env.APP_BASE_URL ? parseHttpUrl(env.APP_BASE_URL)?.origin : undefined
  const configured = appBaseUrl ? [appBaseUrl] : []
  return env.NODE_ENV === 'production' ? configured : [...DEV_ORIGINS, ...configured]
}

/**
 * The address a request arrived on, believing a forwarded header only from a
 * peer TRUST_PROXY or Settings > Deployment names.
 *
 * Fastify's `request.host` and `request.protocol` must not be used for this.
 * They read X-Forwarded-Host and X-Forwarded-Proto whenever any trustProxy option
 * is set, whoever sent them, and server.ts always sets one (a function, so the
 * list can change at runtime).
 *
 * The scheme is known only when it is https: a TLS socket, or a trusted proxy
 * saying so. A plain socket with no trusted proxy is a direct HTTP client or a
 * TLS-terminating proxy nobody declared, and from here they look the same. A
 * trusted proxy saying `http` proves as little, because in a chain the inner one
 * reports its own hop (nginx `$scheme` behind cloudflared) while the browser is on
 * https. What this has to catch is an http page calling an https instance, and
 * that is the case it does know.
 */
export function arrivalAddress(request: {
  host: HeaderValue
  forwardedHost: HeaderValue
  forwardedProto: HeaderValue
  encrypted: boolean
  peerTrusted: boolean
}): ArrivalAddress {
  const hostHeader = Array.isArray(request.host) ? request.host[0] : request.host
  const forwardedHost = request.peerTrusted ? lastEntry(request.forwardedHost) : undefined
  const forwardedProto = request.peerTrusted
    ? lastEntry(request.forwardedProto)?.toLowerCase()
    : undefined

  return {
    host: forwardedHost ?? hostHeader,
    scheme: forwardedProto === 'https' || request.encrypted ? 'https' : undefined,
  }
}

function parseAddress(protocol: string, host: string | undefined): URL | null {
  if (!host || /[/\\@?#]/.test(host)) return null
  return parseHttpUrl(`${protocol}//${host}`)
}

/**
 * Whether `origin` is the address the request arrived on.
 *
 * Compared through the URL parser, so case and a default port written either way
 * cannot make two spellings of one address differ. A Host naming anything beyond
 * a host and port is not an address at all.
 */
export function originMatchesArrival(origin: string, arrival: ArrivalAddress): boolean {
  const parsed = parseHttpUrl(origin)
  if (!parsed) return false
  if (arrival.scheme && `${arrival.scheme}:` !== parsed.protocol) return false
  return parseAddress(parsed.protocol, arrival.host)?.host === parsed.host
}

/**
 * Whether a URL belongs to a route rather than to the built web app.
 *
 * The path is decoded first because the router decodes it too: `/%61pi/x` reaches
 * `/api/x`. One that will not decode counts as a route, the safe side.
 */
export function isRoutePath(url: string): boolean {
  let path: string
  try {
    path = decodeURIComponent(url.split('?')[0])
  } catch {
    return true
  }
  return ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/** A GET or HEAD for a file of the built web app. */
export function isPublicFileRequest(method: string, url: string): boolean {
  return (method === 'GET' || method === 'HEAD') && !isRoutePath(url)
}

/** The one decision. See the top of this file for what each answer means. */
export function decideCors(request: {
  origin: string
  method: string
  url: string
  arrival: ArrivalAddress
  configured: string[]
}): CorsDecision {
  const { origin, configured } = request
  const parsed = parseHttpUrl(origin)
  if (parsed && configured.includes(parsed.origin)) return 'cors'
  if (originMatchesArrival(origin, request.arrival)) return 'no-headers'
  if (isPublicFileRequest(request.method, request.url)) return 'no-headers'
  return 'refuse'
}

/**
 * Whether a page on this origin could be some other site's page, pointed at this
 * server by DNS rebinding.
 *
 * An attacker's page can make its own name resolve to this server's address. The
 * browser then calls that same-origin and sends `Host: evil.example` with
 * `Origin: http://evil.example`, which match. It holds no session (cookies are
 * filed under the real name), so this only matters where having no session is
 * enough: first-run setup, whose only guard is "from the local network", and
 * passwordless login. Those two ask this question.
 *
 * An address written as an IP, or a name browsers keep on loopback, cannot be
 * rebound; nor can one the operator configured. Anything else might be, and those
 * two surfaces refused it before same-origin requests were let through anyway.
 */
export function originCouldBeRebound(
  origin: string | undefined,
  configured: string[] = configuredOrigins()
): boolean {
  if (!origin) return false
  const parsed = parseHttpUrl(origin)
  if (!parsed) return true
  if (configured.includes(parsed.origin)) return false

  return !hostnameCannotBeRebound(parsed.hostname)
}

/**
 * The same question for the address a request arrived on, for a route that has to
 * answer before any `Origin` exists (a same-origin GET carries none). A missing or
 * unusable address counts as one that could be, the side that asks for a password.
 */
export function addressCouldBeRebound(
  host: string | undefined,
  configured: string[] = configuredOrigins()
): boolean {
  if (configured.some((origin) => originMatchesArrival(origin, { host, scheme: undefined }))) {
    return false
  }
  const parsed = parseAddress('http:', host)
  return !parsed || !hostnameCannotBeRebound(parsed.hostname)
}

function hostnameCannotBeRebound(hostname: string): boolean {
  const isIpLiteral = hostname.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
  const isLoopbackName = hostname === 'localhost' || hostname.endsWith('.localhost')
  return isIpLiteral || isLoopbackName
}

/** What @fastify/cors needs of a request. Fastify's own type is wider than this. */
interface CorsRequest {
  method: string
  url: string
  headers: Record<string, HeaderValue>
  socket: { remoteAddress?: string; encrypted?: boolean }
}

/** The address a live request arrived on. */
export function arrivalOf(
  request: Pick<CorsRequest, 'headers' | 'socket'>,
  peerIsTrusted: (address: string | undefined) => boolean
): ArrivalAddress {
  return arrivalAddress({
    host: request.headers.host,
    forwardedHost: request.headers['x-forwarded-host'],
    forwardedProto: request.headers['x-forwarded-proto'],
    encrypted: request.socket.encrypted === true,
    peerTrusted: peerIsTrusted(request.socket.remoteAddress),
  })
}

/**
 * The options @fastify/cors asks for per request. A delegator rather than its
 * `origin` callback because that callback sees only the origin, not the request.
 */
export function corsDelegator(deps: {
  peerIsTrusted: (address: string | undefined) => boolean
  onRefused: (origin: string) => void
}) {
  return (
    request: CorsRequest,
    callback: (error: Error | null, options?: FastifyCorsOptions) => void
  ): void => {
    const header = request.headers.origin
    const origin = Array.isArray(header) ? header[0] : header
    // No Origin: not a browser's cross-origin call (curl, a native client, a page's
    // own GET). Nothing to work out, on the path every poll and image takes. Stays
    // on the branch it has always taken, which adds no Access-Control-Allow-Origin
    // because there is nothing to reflect.
    if (!origin) {
      callback(null, { origin: true, credentials: true })
      return
    }

    const decision = decideCors({
      origin,
      method: request.method,
      url: request.url,
      configured: configuredOrigins(),
      arrival: arrivalOf(request, deps.peerIsTrusted),
    })

    if (decision === 'refuse') {
      deps.onRefused(origin)
      // Refused through the origin callback, not by failing the delegator: only
      // then has the plugin added `Vary: Origin`, which this answer needs as much
      // as any other, since it depends on the Origin.
      const refusal = Object.assign(new Error('Not allowed by CORS'), { statusCode: 403 })
      callback(null, { origin: (_origin, done) => done(refusal, false), credentials: true })
      return
    }
    callback(null, { origin: decision === 'cors', credentials: true })
  }
}
