/**
 * Why a title page could not be shown, and whether asking again could help.
 *
 * The page used to answer every failed request with "Movie not found", so a
 * server error, a proxy timeout or a dropped connection all read as the title
 * not existing — with nothing to press but Close. Only a 404 means the title is
 * missing (or in a library this viewer may not open, which the API answers the
 * same way on purpose). Everything else is a failure to load it, and the brief
 * ones are retried before the page gives up.
 */

export type MediaLoadError =
  | { kind: 'notFound' }
  /** `status` is null when no answer arrived at all (network, aborted connection). */
  | { kind: 'failed'; status: number | null }

/** Classify a response that was not ok. */
export function loadErrorForStatus(status: number): MediaLoadError {
  return status === 404 ? { kind: 'notFound' } : { kind: 'failed', status }
}

/**
 * Whether the same request might succeed a moment later: no answer at all, a
 * timeout, rate limiting, or a server/proxy error. A 400/401/403/404 will be
 * answered the same way however often it is asked.
 */
export function isTransientLoadError(error: MediaLoadError): boolean {
  if (error.kind !== 'failed') return false
  const { status } = error
  return status == null || status === 408 || status === 429 || status >= 500
}

/** Waits before each automatic retry; its length is the number of retries. */
export const LOAD_RETRY_DELAYS_MS: readonly number[] = [500, 1500]
