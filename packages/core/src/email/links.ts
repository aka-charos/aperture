/**
 * Links from an email back into the app. Pure.
 *
 * A link needs the address the RECIPIENT reaches the app at, which the server
 * cannot know from a request — a notification is sent from a job with no
 * request at all. So it is a setting (`SmtpConfig.publicUrl`), with the
 * `APP_BASE_URL` environment variable as its fallback. That variable defaults
 * to `http://localhost:3456` and most installs never change it, and a link to
 * localhost in someone's inbox points at THEIR machine, so a loopback address
 * is treated as unset: no link at all beats a link that goes nowhere.
 */

/** Strip trailing slashes, so `appLink` is the one place a path is joined on. */
export function normalizePublicUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

/**
 * Why a public address cannot be stored, or null. Blank is allowed (it means
 * "use APP_BASE_URL, or no links"). A path is allowed, for an app served
 * under one; a query or a fragment is not, since paths are appended to it.
 */
export function publicUrlProblem(value: string): string | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'The public address must be a full address, like https://aperture.example.com'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'The public address must start with http:// or https://'
  }
  if (url.username || url.password) return 'The public address cannot contain a username or password'
  if (url.search || url.hash) return 'The public address cannot contain ? or #'
  // Refused rather than stored and then ignored: links are never built on a
  // loopback address, so saving one would leave the card claiming links point
  // somewhere while every email went out without them.
  if (isLoopbackHost(url.hostname)) {
    return 'The public address must be one people can open from another machine, not localhost'
  }
  return null
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')
}

/** Whether an address could mean something to someone reading an email on another machine. */
export function isReachablePublicUrl(value: string | null | undefined): value is string {
  return !!value && publicUrlProblem(value) === null
}

/**
 * The address links are built on: the setting, else `APP_BASE_URL`, else
 * none. A loopback address is never used, set or not — an admin who typed
 * localhost would otherwise mail every recipient a dead link.
 */
export function emailLinkBase(publicUrl: string, envBaseUrl: string | null | undefined): string | null {
  const configured = normalizePublicUrl(publicUrl)
  if (configured) return isReachablePublicUrl(configured) ? configured : null
  const fromEnv = normalizePublicUrl(envBaseUrl ?? '')
  return isReachablePublicUrl(fromEnv) ? fromEnv : null
}

/**
 * A page of the app as an absolute link, or null when there is no base. The
 * path is joined to the base's own path, so an app served under `/aperture`
 * keeps it.
 */
export function appLink(base: string | null, path: string): string | null {
  if (!base) return null
  return new URL(path.replace(/^\/+/, ''), `${base}/`).toString()
}
