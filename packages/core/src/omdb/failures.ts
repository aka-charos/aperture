/**
 * Telling OMDb's failures apart.
 *
 * Split out of client.ts so it can be tested without a database or a network,
 * the same way enrichment/pending.ts carries the selection predicate.
 *
 * The distinction that matters here is not cosmetic. The enrichment job records
 * whether OMDb was *asked and answered* (`movies.omdb_enriched_at`), and a row
 * it stamps is excluded from every future pass. So a failure that reads as an
 * answer permanently freezes the row — which is exactly what happened when the
 * client returned `null` for an HTTP 401 and for a genuine "Movie not found!"
 * alike, and an entire library was marked complete during an auth outage.
 */

/**
 * `auth` and `limit` are properties of the *key*, not of the title, so every
 * remaining request in a run will fail the same way; `transport` is a property
 * of the moment and is worth retrying.
 */
export type OmdbFailureKind = 'auth' | 'limit' | 'transport'

/**
 * Body strings OMDb returns. These duplicate the keys of `OMDB_ERROR_MESSAGES`
 * in errors/omdb.ts, which maps them to user-facing copy — matching is done
 * here rather than there because this module must stay free of the error
 * module's DB imports.
 */
const INVALID_KEY = 'Invalid API key'
const NO_KEY = 'No API key'
const LIMIT_REACHED = 'Request limit reached'

/**
 * OMDb answers **401 for both an invalid key and an exhausted daily quota**.
 * The repo already knew this — errors/omdb.ts says so in a comment above its
 * 401 entry — but the client read `response.status` and returned before
 * touching the body, so the one string that separates a key you must fix from
 * a quota you must wait out was discarded on every request. All the logs could
 * say was "HTTP 401", which is true of both.
 *
 * An unrecognised 401/403 is reported as `auth` rather than `limit`: both stop
 * the run, so the only thing riding on the guess is which message the operator
 * reads, and "check your key" is the more actionable of the two. A missing body
 * is normal here — OMDb sometimes answers non-OK with HTML.
 */
export function classifyOmdbFailure(status: number, omdbError: string | null): OmdbFailureKind {
  if (omdbError) {
    if (omdbError.includes(LIMIT_REACHED)) return 'limit'
    if (omdbError.includes(INVALID_KEY) || omdbError.includes(NO_KEY)) return 'auth'
  }
  if (status === 401 || status === 403) return 'auth'
  return 'transport'
}

/**
 * Whether the same request is worth making again in a moment.
 *
 * Only `transport` is: a key does not become valid, and a daily quota does not
 * refill, inside the client's retry window. Retrying those burns the remaining
 * quota (when there is any) and delays the failure the operator needs to see.
 */
export function isRetryableOmdbFailure(kind: OmdbFailureKind): boolean {
  return kind === 'transport'
}

/**
 * Whether a failure describes the key rather than the title, and so predicts
 * every other request in the run.
 */
export function isGlobalOmdbFailure(kind: OmdbFailureKind): boolean {
  return kind === 'auth' || kind === 'limit'
}

/**
 * A failed OMDb request.
 *
 * Thrown rather than returned so it cannot be mistaken for an answer. The
 * enrichment job's OMDb branch already catches and records the row as unasked,
 * so throwing is what makes `omdb_enriched_at` mean what it claims.
 */
export class OmdbRequestError extends Error {
  readonly kind: OmdbFailureKind
  readonly status: number
  /** OMDb's own `Error` field, when the body carried one. */
  readonly omdbError: string | null

  constructor(status: number, omdbError: string | null, kind?: OmdbFailureKind) {
    const resolved = kind ?? classifyOmdbFailure(status, omdbError)
    super(omdbError ? `OMDb ${status}: ${omdbError}` : `OMDb request failed (HTTP ${status})`)
    this.name = 'OmdbRequestError'
    this.kind = resolved
    this.status = status
    this.omdbError = omdbError
  }
}

/**
 * OMDb's "we have no entry for this" replies, which arrive as HTTP 200 with
 * `Response: "False"`. These are answers, not failures: the title genuinely is
 * not in OMDb (or the id on the row is malformed, which asking again will not
 * repair), and retrying them every pass would never end.
 *
 * The list is deliberately closed. OMDb also reports auth and quota failures
 * this way — errors/handler.ts notes it "often returns 200 with error in body"
 * — so treating every `Response: "False"` as an answer, which is what the
 * client used to do, stamps a row as OMDb-complete on the strength of a reply
 * that says the key is invalid. Anything unrecognised is therefore a failure,
 * which costs a retry next run and cannot cost the row its metadata.
 */
const NOT_FOUND_ERRORS = ['Movie not found!', 'Series not found!', 'Incorrect IMDb ID.']

export function isNotFoundBody(omdbError: string | undefined): boolean {
  if (!omdbError) return false
  return NOT_FOUND_ERRORS.some((known) => omdbError.includes(known))
}
