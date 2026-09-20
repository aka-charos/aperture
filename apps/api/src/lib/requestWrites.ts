/**
 * Whether a request changes anything.
 *
 * Two features need this answer and must not answer it differently: an assumed
 * session is read-only (`lib/impersonation.ts`), and an API key without the
 * `write` scope is read-only (`plugins/auth.ts`). Both rest on the same claim —
 * that the HTTP method tells you whether a handler writes — and both need the
 * same two corrections to it, so the corrections live here rather than in one
 * of them.
 *
 * The alternative to a method rule is auditing every one of the app's ~490
 * handlers for whether it touches state, and then auditing every handler added
 * afterwards, forever. The method rule plus two named exception lists is the
 * version of that which stays true.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Lookups that are POSTs only because their input is a list of ids too long for
 * a query string. They write nothing, and refusing them leaves a read-only
 * caller looking at a library with no favourite hearts and no request badges —
 * a wrong picture of the very thing they opened it to see.
 *
 * The bar for adding to this list is that the handler performs no write of any
 * kind, for anyone. When in doubt, leave it out: a missing badge is a visible,
 * self-explaining gap, and a write slipped through here is neither.
 */
const READ_ONLY_POSTS = new Set(['/api/favorites/status/bulk', '/api/seerr/status/batch'])

/**
 * GETs that write. The method rule rests on "a GET changes nothing", and these
 * are where the app breaks that contract, so they are named rather than left to
 * a rule that does not cover them.
 *
 * Both are halves of the Trakt OAuth handshake. `auth-url` mints a one-time
 * state token bound to `request.user.id` and `callback` redeems it by writing
 * OAuth tokens to whichever account that state names — so left open, these two
 * GETs link one account's Trakt profile to another's, and the next ratings sync
 * pushes the wrong person's ratings. A cross-account data flow that outlives
 * whatever opened it.
 *
 * A GET belongs here when it writes anything scoped to a user. It is the
 * exception list for a rule, so adding to it should feel like a defect report
 * about the handler, not like configuration.
 */
const WRITING_GETS = new Set(['/api/trakt/auth-url', '/api/trakt/callback'])

export function normalizePath(url: string): string {
  const path = url.split('?')[0].split('#')[0]
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

/**
 * Whether this request should be treated as changing state.
 *
 * Errs toward "yes": an unsafe method is a write unless it is on the short
 * list of known lookups, and a safe method is a read unless it is on the short
 * list of known writers. Both mistakes this can make are refusals of something
 * harmless, which is visible; the mistake it cannot make is letting a write
 * through unnoticed.
 */
export function requestWrites(method: string, url: string): boolean {
  const path = normalizePath(url)
  if (SAFE_METHODS.has(method.toUpperCase())) return WRITING_GETS.has(path)
  return !READ_ONLY_POSTS.has(path)
}
