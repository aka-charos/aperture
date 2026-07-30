/**
 * Deployment security posture.
 *
 * Single home for the "is this instance exposed?" decisions so they cannot
 * drift apart between the cookie plugin, the auth plugin and the server. In
 * particular the Secure cookie flag used to be derived from APP_BASE_URL, which
 * silently dropped Secure for the most common self-hosted layout: Aperture on
 * plain HTTP behind a TLS-terminating reverse proxy.
 */

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * Read a boolean env var, case-insensitively.
 *
 * `COOKIE_SECURE=False` matching neither 'true' nor 'false' and silently
 * falling through to the default is the kind of thing that costs an operator an
 * afternoon — the symptom is "I can't log in", nowhere near the cause.
 */
function envFlag(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase()
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  return undefined
}

/**
 * Whether to set `Secure` on the session cookie.
 *
 * Defaults to on in production regardless of how APP_BASE_URL is written, since
 * a production deployment reachable over plain HTTP is the thing we are trying
 * to protect against, not a configuration to accommodate. `COOKIE_SECURE=false`
 * is the deliberate escape hatch for a LAN-only HTTP install.
 */
export function useSecureCookies(): boolean {
  return envFlag('COOKIE_SECURE') ?? isProduction()
}

export type DeploymentMode = 'direct' | 'proxy'

/** Address assumed to be the proxy when a mode implies one but none is named. */
export const LOOPBACK_PROXIES = ['127.0.0.1', '::1']

/**
 * How this instance is reached.
 *
 * `direct` (default) — clients connect to the app's own port.
 * `proxy` — a reverse proxy or tunnel sits in front and forwards every request.
 *
 * The mechanism is identical for cloudflared, nginx, Traefik and Caddy, so the
 * setting is generic; DEPLOYMENT_MODE=cloudflared is accepted as an alias
 * because that is what people search for.
 */
export function deploymentMode(): DeploymentMode {
  const raw = (process.env.DEPLOYMENT_MODE || '').trim().toLowerCase()
  if (raw === 'proxy' || raw === 'tunnel' || raw === 'cloudflared') return 'proxy'
  return 'direct'
}

/**
 * Fastify `trustProxy` value.
 *
 * Off by default and deliberately so: with it on, `X-Forwarded-For` is taken at
 * face value, and a forged header would let a caller mint a fresh rate-limit
 * bucket per request. Operators behind a reverse proxy must opt in — either
 * `TRUST_PROXY=true`, a hop count, or a comma-separated list of trusted proxy
 * addresses/CIDRs, which is the safest form.
 *
 * DEPLOYMENT_MODE=proxy supplies the loopback default, which is right when the
 * proxy runs beside the app (the usual cloudflared layout). A proxy in its own
 * container has a different address and still needs TRUST_PROXY set explicitly
 * — an explicit value always wins over the mode's default.
 */
export function trustProxy(): boolean | number | string[] {
  const raw = (process.env.TRUST_PROXY || '').trim()
  if (!raw) return deploymentMode() === 'proxy' ? [...LOOPBACK_PROXIES] : false

  // Handles true/false/1/0 in any casing. Note '1' means "trust one hop" to
  // Fastify but is read as the boolean here — same effective result for a
  // single proxy, and unambiguous either way.
  const flag = envFlag('TRUST_PROXY')
  if (flag !== undefined) return flag

  const hops = Number(raw)
  if (Number.isInteger(hops) && hops > 0) return hops

  return raw.split(',').map((entry) => entry.trim()).filter(Boolean)
}

/**
 * Whether the `allow_passwordless_login` setting is honoured at all.
 *
 * Passwordless login authenticates anyone who can name an account that has no
 * media-server password, which is a full authentication bypass on an instance
 * reachable from the internet. The admin toggle stays available for LAN
 * installs, but in production it does nothing unless the operator also sets
 * ALLOW_PASSWORDLESS_LOGIN=true — a deliberate second step, out of reach of
 * anyone who only compromises the admin UI.
 */
export function passwordlessLoginPermitted(): boolean {
  if (!isProduction()) return true
  return envFlag('ALLOW_PASSWORDLESS_LOGIN') ?? false
}

/**
 * Escape hatch for running the first-run wizard from off-network.
 *
 * See isTrustedSetupSource — until setup completes, /api/setup/* is
 * unauthenticated by necessity (there is no account to log in to yet), so it is
 * restricted to local callers unless the operator opts out.
 */
export function setupAllowsRemote(): boolean {
  return envFlag('SETUP_ALLOW_REMOTE') ?? false
}

/**
 * Whether an address is local enough to be trusted with first-run setup.
 *
 * Loopback, RFC1918, CGNAT, link-local and IPv6 unique-local. The bar is "same
 * network as the server", which is where a self-hosted first run happens; an
 * instance whose port is exposed to the internet before the wizard is finished
 * is otherwise a race an attacker can win, taking admin and pointing the
 * install at a media server of their choosing.
 */
export function isTrustedSetupSource(ip: string | undefined): boolean {
  if (!ip) return false

  // Normalize IPv4-mapped IPv6 (::ffff:192.168.1.5) down to the IPv4 form.
  const addr = ip.replace(/^::ffff:/i, '').toLowerCase()

  if (addr === '::1' || addr === '127.0.0.1') return true

  const v4 = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127) return true // loopback
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
    return false
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd]/.test(addr)) return true
  if (/^fe[89ab]/.test(addr)) return true

  return false
}

/**
 * Ship the CSP as report-only.
 *
 * The policy is the one change here that can break the SPA at runtime rather
 * than at build time — a dependency reaching for `new Function`, or an asset
 * host nobody remembered, shows up only when a real browser loads a real page.
 * Setting CSP_REPORT_ONLY=true emits Content-Security-Policy-Report-Only
 * instead, so violations appear in the browser console while nothing is
 * actually blocked. Useful for one deploy; not a place to live.
 */
export function cspReportOnly(): boolean {
  return envFlag('CSP_REPORT_ONLY') ?? false
}

/**
 * Options for @fastify/helmet.
 *
 * Lives here rather than inline in server.ts so the policy is one reviewable
 * object and tests can assert the headers the server actually emits.
 *
 * The SPA is served from this same origin, so a strict policy is affordable;
 * frame-ancestors 'none' is what stops the login form being iframed.
 */
export function helmetOptions() {
  return {
    contentSecurityPolicy: {
      reportOnly: cspReportOnly(),
      directives: {
        // scriptSrc inherits 'self' from here. index.html carries no inline
        // script and the built bundle contains no eval/new Function (checked),
        // so no nonce or 'unsafe-eval' is needed — this is the directive that
        // actually contains an injection.
        defaultSrc: ["'self'"],
        // MUI/emotion inject <style> at runtime; there is no nonce to thread
        // through a CSS-in-JS runtime, so inline styles stay permitted.
        // index.html also pulls the Inter/Open Sans/Oswald stylesheet.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        // Deliberately wide. Media-server artwork is proxied to this origin,
        // but TMDB posters are loaded direct from image.tmdb.org in Discovery,
        // Gap Analysis and the person/studio pages, and getProxiedImageUrl
        // passes through any other stored URL untouched — including plain http
        // for a LAN media server. Restricting this would break artwork across
        // the app for little gain: with scriptSrc locked down there is no
        // injected code to beacon out through an image.
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        // No client code fetches cross-origin; everything goes through /api.
        // This also fences assistant-ui's cloud path — see the comment at the
        // useChatRuntime call site in AssistantChatSurface.tsx.
        connectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        // TrailerModal embeds the YouTube player; everything else is denied.
        frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
        // The clickjacking control: nothing may frame the login page.
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: useSecureCookies() ? { maxAge: 31536000, includeSubDomains: true } : false,
    // Must agree with the CSP's frame-ancestors 'none'. Helmet's default here
    // is SAMEORIGIN, which would leave same-origin framing allowed for any
    // client that honours X-Frame-Options but not CSP.
    frameguard: { action: 'deny' as const },
    // Poster/backdrop images are proxied through this origin but consumed by
    // canvas in the overlay code; COEP would break those reads.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' as const },
    referrerPolicy: { policy: 'no-referrer' as const },
  }
}

export type ApiDocsMode = 'public' | 'admin' | 'off'

/**
 * Who may read the OpenAPI spec and Swagger UI.
 *
 * The UI ships with "Try it out" enabled and documents every route and body
 * schema, so in production it defaults to admin-only rather than public.
 */
export function apiDocsMode(): ApiDocsMode {
  const raw = (process.env.API_DOCS || '').trim().toLowerCase()
  if (raw === 'public' || raw === 'admin' || raw === 'off') return raw
  return isProduction() ? 'admin' : 'public'
}
