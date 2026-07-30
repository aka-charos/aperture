/**
 * Validation for operator-supplied server URLs (media server base/public URL).
 *
 * Note on scope: this deliberately does NOT block private, loopback or
 * link-local addresses. A self-hosted Emby/Jellyfin is almost always on exactly
 * those — `http://192.168.1.10:8096`, `http://jellyfin:8096` on a Docker
 * network — so an SSRF filter of that shape would reject the normal case while
 * the abnormal case (an attacker choosing the URL) is prevented by requiring
 * authentication to reach these settings at all.
 *
 * What is left to enforce is the part that has no legitimate use: non-HTTP
 * schemes, and credentials smuggled into the URL.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export class InvalidServerUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidServerUrlError'
  }
}

/**
 * Validate and normalize a server URL.
 *
 * @returns the URL with any trailing slash removed
 * @throws {InvalidServerUrlError} when the URL is unusable or unsafe
 */
export function validateServerUrl(raw: string, label = 'Server URL'): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new InvalidServerUrlError(`${label} is required`)
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new InvalidServerUrlError(
      `${label} must be a complete URL including the scheme, e.g. http://192.168.1.10:8096`
    )
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    // file:, gopher:, ftp: and friends turn a fetch into a local read or a
    // protocol-smuggling primitive.
    throw new InvalidServerUrlError(
      `${label} must use http:// or https:// (got ${url.protocol.replace(':', '')}://)`
    )
  }

  if (url.username || url.password) {
    // Credentials in the URL would be sent on every proxied request and end up
    // in logs and error reports. The API key field is the place for secrets.
    throw new InvalidServerUrlError(`${label} must not embed a username or password`)
  }

  if (!url.hostname) {
    throw new InvalidServerUrlError(`${label} must include a hostname`)
  }

  return trimmed.replace(/\/$/, '')
}
