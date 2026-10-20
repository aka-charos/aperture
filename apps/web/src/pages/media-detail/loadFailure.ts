/**
 * Reading the title page's requests, and why one could not be read.
 *
 * The page used to answer every failed request for the title with "Movie not
 * found", so a server error, a proxy timeout or a dropped connection all read
 * as the title not existing — with nothing to press but Close — while the
 * page's other requests turned the same failures into silently empty sections.
 * Every request on the page now goes through `readJsonWithRetry`: brief
 * failures are asked again, and what is left is classified.
 *
 * Only a 404 means the title is missing (or in a library this viewer may not
 * open, which the API answers the same way on purpose). A 401 means the
 * session ended. Everything else is a failure to load it.
 */

export type MediaLoadError =
  | { kind: 'notFound' }
  /** The session ended (idle timeout, or an assumed account's lease ran out). */
  | { kind: 'signedOut' }
  | {
      kind: 'failed'
      /**
       * The status of an error answer, or null when no usable answer arrived:
       * no response at all, or a body that was not the API's JSON (a proxy page
       * served with 200, a connection cut mid-body).
       */
      status: number | null
      /** How long the server asked us to wait before asking again (Retry-After). */
      retryAfterMs?: number
    }

export type LoadResult<T> = { ok: true; data: T } | { ok: false; error: MediaLoadError }

/** Waits before each automatic retry; its length is the number of retries. */
export const LOAD_RETRY_DELAYS_MS: readonly number[] = [500, 1500]

/**
 * The longest a Retry-After may ask us to wait and still be honoured here. A
 * longer one is not waited out behind a spinner: the page shows the failure
 * and its Try again button instead.
 */
export const MAX_RETRY_AFTER_MS = 5000

/**
 * A Retry-After header in milliseconds: delay-seconds or an HTTP date. Null
 * when absent or unreadable.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const at = Date.parse(trimmed)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

/** Classify an answer that was not ok. */
export function loadErrorForStatus(status: number, retryAfterMs?: number | null): MediaLoadError {
  if (status === 404) return { kind: 'notFound' }
  if (status === 401) return { kind: 'signedOut' }
  return retryAfterMs != null ? { kind: 'failed', status, retryAfterMs } : { kind: 'failed', status }
}

/**
 * Whether the same request might succeed a moment later: no usable answer, a
 * timeout, rate limiting, or a server/proxy error. A 400/401/403/404 will be
 * answered the same way however often it is asked.
 */
export function isTransientLoadError(error: MediaLoadError): boolean {
  if (error.kind !== 'failed') return false
  const { status } = error
  return status == null || status === 408 || status === 429 || status >= 500
}

/**
 * How long to wait before asking again, or null to stop: the scheduled delay,
 * stretched to the server's Retry-After, and never past `MAX_RETRY_AFTER_MS`.
 */
export function retryDelayFor(error: MediaLoadError, scheduledMs: number): number | null {
  if (!isTransientLoadError(error)) return null
  const asked = error.kind === 'failed' ? error.retryAfterMs : undefined
  if (asked == null) return scheduledMs
  return asked > MAX_RETRY_AFTER_MS ? null : Math.max(scheduledMs, asked)
}

/** One GET of a JSON body, classified. Never throws. */
export async function readJson<T>(url: string): Promise<LoadResult<T>> {
  let response: Response
  try {
    response = await fetch(url, { credentials: 'include' })
  } catch {
    return { ok: false, error: { kind: 'failed', status: null } }
  }
  if (!response.ok) {
    return {
      ok: false,
      error: loadErrorForStatus(response.status, parseRetryAfter(response.headers.get('retry-after'))),
    }
  }
  try {
    return { ok: true, data: (await response.json()) as T }
  } catch {
    // A proxy page in place of the API's JSON, or a body cut off mid-way:
    // no usable answer, whatever the status line said.
    return { ok: false, error: { kind: 'failed', status: null } }
  }
}

export interface RetryOptions {
  /** False once the caller no longer wants the answer (the page moved on). */
  isLive: () => boolean
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * `readJson`, asked again after each of `LOAD_RETRY_DELAYS_MS` while the
 * failure is a brief one. Null when the caller stopped wanting the answer.
 */
export async function readJsonWithRetry<T>(
  url: string,
  { isLive, sleep = defaultSleep }: RetryOptions
): Promise<LoadResult<T> | null> {
  let result = await readJson<T>(url)
  for (const scheduled of LOAD_RETRY_DELAYS_MS) {
    if (!isLive()) return null
    if (result.ok) break
    const delay = retryDelayFor(result.error, scheduled)
    if (delay == null) break
    await sleep(delay)
    if (!isLive()) return null
    result = await readJson<T>(url)
  }
  return isLive() ? result : null
}
