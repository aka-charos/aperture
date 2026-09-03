/**
 * Admin account assumption ("view as user") — the parts that are pure
 * decisions, kept out of the auth plugin so a test can pin them directly
 * instead of only reaching them through a live request.
 */

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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * The only unsafe requests an assumed session may make. Both END the
 * assumption, which is exactly why they are exempt: an admin who cannot POST
 * anything cannot get back out of the account they stepped into.
 */
const EXIT_ROUTES = new Set(['/api/auth/impersonate/stop', '/api/auth/logout'])

/**
 * Lookups that are POSTs only because their input is a list of ids too long
 * for a query string. They write nothing, and blocking them would leave the
 * assumed session showing a library with no favourite hearts and no request
 * badges — a wrong picture of the very thing the admin opened it to check.
 *
 * The bar for adding to this list is that the handler performs no write of any
 * kind, for anyone. When in doubt, leave it out: a missing badge is a visible,
 * self-explaining gap, and a write slipped through here is neither.
 */
const READ_ONLY_POSTS = new Set([
  '/api/favorites/status/bulk',
  '/api/seerr/status/batch',
])

/**
 * GETs that write. The method guard rests on "a GET changes nothing", and
 * these are where the app breaks that contract — so they are named rather than
 * left to the rule that does not cover them.
 *
 * Both are halves of the Trakt OAuth handshake. `auth-url` mints a one-time
 * state token bound to `request.user.id` — the TARGET during an assumption —
 * and `callback` redeems it by writing OAuth tokens to whichever account that
 * state names. Left open, an admin could link their own Trakt account to
 * someone else's Aperture account through two GETs, and the next ratings sync
 * would push that user's ratings to the admin's Trakt profile: a silent
 * cross-account data flow that outlives the assumption entirely.
 *
 * The callback is blocked even though its state may name the admin rather than
 * the target (if the flow was started before the assumption). Failing that way
 * costs one retry after exiting; failing the other way is unrecoverable.
 *
 * A GET belongs here when it writes anything scoped to a user. It is the
 * exception list for a rule, so adding to it should feel like a defect report
 * about the handler, not like configuration.
 */
const BLOCKED_GETS = new Set(['/api/trakt/auth-url', '/api/trakt/callback'])

function normalizePath(url: string): string {
  const path = url.split('?')[0].split('#')[0]
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

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
 */
export function impersonationBlocksRequest(method: string, url: string): boolean {
  const path = normalizePath(url)
  if (SAFE_METHODS.has(method.toUpperCase())) return BLOCKED_GETS.has(path)
  return !EXIT_ROUTES.has(path) && !READ_ONLY_POSTS.has(path)
}

/** Refusal payload, shaped so the client can tell this apart from a real 403. */
export const IMPERSONATION_READ_ONLY_ERROR = {
  error: 'This is a read-only session. Return to your admin session to make changes.',
  code: 'IMPERSONATION_READ_ONLY',
} as const
