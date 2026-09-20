/**
 * Admin account assumption ("view as user") — the parts that are pure
 * decisions, kept out of the auth plugin so a test can pin them directly
 * instead of only reaching them through a live request.
 */

import { normalizePath, requestWrites } from './requestWrites.js'

/** Cookie carrying the assumption. Sits *beside* the admin's session cookie. */
export const IMPERSONATION_COOKIE_NAME = 'aperture_impersonation'

/**
 * How long a grant lives before it lapses on its own.
 *
 * The banner is the intended way out, but it is a piece of UI and UI can fail
 * to render. A short lease means the worst case for an admin who cannot find
 * the exit is a wait, not a support ticket — and it bounds an assumption left
 * open in a background tab.
 */
export const IMPERSONATION_DURATION_MINUTES = 60

/** Bytes of entropy in an assumption token — same budget as a session token. */
export const IMPERSONATION_TOKEN_BYTES = 32

/**
 * The only writing requests an assumed session may make. Both END the
 * assumption, which is exactly why they are exempt: an admin who cannot POST
 * anything cannot get back out of the account they stepped into.
 */
const EXIT_ROUTES = new Set(['/api/auth/impersonate/stop', '/api/auth/logout'])

/**
 * Whether an assumed session must be refused this request.
 *
 * The promise the feature makes is that nothing about the target account
 * changes — not `last_login_at`, not `updated_at`, not a view mode the admin
 * flipped while looking around, not a rating, not a chat conversation. An
 * allowlist on the *method* is the only way to keep that promise: the
 * alternative is auditing every one of the app's several hundred handlers for
 * whether it touches user state, and then auditing every handler added
 * afterwards, forever. Read-only is also the honest description of what
 * "see what they see" means.
 *
 * Which requests write is a question the API key `write` scope asks too, so it
 * is answered once in `requestWrites` — including the two corrections the
 * method rule needs (batch lookups that are POSTs, and the Trakt OAuth GETs
 * that write). What is left here is the half that belongs to this feature
 * alone: the way back out.
 */
export function impersonationBlocksRequest(method: string, url: string): boolean {
  if (!requestWrites(method, url)) return false
  return !EXIT_ROUTES.has(normalizePath(url))
}

/** Refusal payload, shaped so the client can tell this apart from a real 403. */
export const IMPERSONATION_READ_ONLY_ERROR = {
  error: 'This is a read-only session. Return to your admin session to make changes.',
  code: 'IMPERSONATION_READ_ONLY',
} as const
