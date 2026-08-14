/**
 * OMDb API Client
 * Handles API requests with rate limiting and error handling
 *
 * Rate limits:
 * - Free tier: 1,000 requests/day → conservative 10 req/sec
 * - Paid tier: 100,000 requests/day → aggressive 40 req/sec
 */

import { createChildLogger } from '../lib/logger.js'
import { getOMDbApiKey, isOMDbPaidTier } from '../settings/systemSettings.js'
import { parseApiError } from '../errors/handler.js'
import { logApiError, hasRecentSimilarError } from '../errors/db.js'
import { OMDB_API_BASE_URL } from './types.js'
import type { OMDbMovieResponse } from './types.js'
import {
  OmdbRequestError,
  classifyOmdbFailure,
  isGlobalOmdbFailure,
  isNotFoundBody,
  isRetryableOmdbFailure,
} from './failures.js'
import type { ApiLogCallback } from '../tmdb/client.js'

const logger = createChildLogger('omdb')

// Rate limiting configuration
// Free tier: 1,000 requests/day → ~10 req/sec to be safe
// Paid tier: 100,000 requests/day → ~40 req/sec (could go higher but matching TMDb)
const RATE_LIMIT_FREE_MS = 100 // 10 requests/second
const RATE_LIMIT_PAID_MS = 25 // 40 requests/second
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

// Cached tier status (refreshed periodically)
let cachedPaidTier: boolean | null = null
let lastTierCheck = 0
const TIER_CHECK_INTERVAL_MS = 60000 // Re-check tier setting every minute

// Simple rate limiter with dynamic delay
let lastRequestTime = 0

/**
 * A bad key or an exhausted quota is a fact about the account, not about the
 * title, so the second request of a run predicts the twelve-thousandth. Without
 * this an auth failure produced one doomed HTTPS round trip per library item —
 * measured on a real instance as a full pass of `OMDB ✗ … (HTTP 401)` lines,
 * every one of which also burned quota if the fault happened to be quota.
 *
 * It expires rather than persisting, because the two ways an operator fixes
 * this are pasting a new key (caught by the key comparison) and activating the
 * existing one at omdbapi.com (not caught by anything, since the key string
 * never changes). Ten minutes outlasts a full-library pass — ~12.5k requests at
 * 40/sec is around five — while still letting a retry work without a restart.
 */
const FAILURE_LATCH_MS = 600000
let latch: { key: string; reason: string; at: number } | null = null

function activeLatch(apiKey: string): string | null {
  if (!latch) return null
  if (latch.key !== apiKey || Date.now() - latch.at > FAILURE_LATCH_MS) {
    latch = null
    return null
  }
  return latch.reason
}

/**
 * Drop the latch so the next request goes to the network again. Called after a
 * successful request, which is the only proof that whatever was wrong is over.
 */
function clearLatch(): void {
  latch = null
}

async function getRateLimitDelay(): Promise<number> {
  const now = Date.now()
  // Refresh cached tier status periodically
  if (cachedPaidTier === null || now - lastTierCheck > TIER_CHECK_INTERVAL_MS) {
    cachedPaidTier = await isOMDbPaidTier()
    lastTierCheck = now
    if (cachedPaidTier) {
      logger.debug('OMDb paid tier detected - using faster rate limit')
    }
  }
  return cachedPaidTier ? RATE_LIMIT_PAID_MS : RATE_LIMIT_FREE_MS
}

async function rateLimit(): Promise<void> {
  const delay = await getRateLimitDelay()
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime
  if (timeSinceLastRequest < delay) {
    await new Promise((resolve) => setTimeout(resolve, delay - timeSinceLastRequest))
  }
  lastRequestTime = Date.now()
}

/**
 * Recover OMDb's own `Error` string from a non-OK response.
 *
 * This is the whole reason a 401 used to be undiagnosable: the status alone
 * cannot say whether the key is wrong or the day's quota is spent, and the
 * client returned before reading the body. Failing to parse is expected and
 * harmless — OMDb answers some faults with HTML.
 */
async function readOmdbError(response: Response): Promise<string | null> {
  try {
    const text = await response.text()
    if (!text) return null
    const parsed = JSON.parse(text) as { Error?: string }
    return parsed.Error ?? null
  } catch {
    return null
  }
}

/**
 * Record a failure on the API Errors page.
 *
 * `parseOMDbError` and both body patterns have existed in errors/omdb.ts since
 * the integration was written, but nothing in this client ever called them, so
 * OMDb was the one integration whose outages were invisible outside the job
 * log. Deduped on the parsed type the same way mdblist/provider.ts does it, or
 * a failing run inserts one row per title.
 */
async function recordOmdbError(status: number, omdbError: string | null): Promise<void> {
  const parsed = parseApiError('omdb', status, { errorMessage: omdbError ?? undefined })
  const recent = await hasRecentSimilarError('omdb', parsed.definition.type, status).catch(() => false)
  if (recent) return
  await logApiError(parsed).catch((err) => logger.error({ err }, 'Failed to log OMDb API error'))
}

/**
 * Make a rate-limited request to the OMDb API
 *
 * Returns null only when OMDb answered and had no entry for the id. Every other
 * outcome throws `OmdbRequestError`, because callers record a null as "asked
 * and answered" and stop asking — see enrichment/pending.ts.
 */
export async function omdbRequest(
  imdbId: string,
  options: { apiKey?: string; onLog?: ApiLogCallback } = {}
): Promise<OMDbMovieResponse | null> {
  // Trimmed because the key is pasted into a settings field, and a trailing
  // newline survives into the query string as %0A — which OMDb reads as a
  // different, invalid key while the value still looks right in the UI.
  const apiKey = (options.apiKey || (await getOMDbApiKey()))?.trim()
  const { onLog } = options

  if (!apiKey) {
    logger.warn('OMDb API key not configured')
    return null
  }

  const latched = activeLatch(apiKey)
  if (latched) {
    onLog?.('omdb', imdbId, 'error', latched)
    throw new OmdbRequestError(0, latched, 'auth')
  }

  // plot=full costs nothing extra — same request, same quota, larger response —
  // and returns IMDb's long synopsis instead of the one-line blurb. The media
  // server already supplies a short overview, so asking for the short one here
  // fetched a near-duplicate of something we had.
  const url = `${OMDB_API_BASE_URL}/?apikey=${encodeURIComponent(apiKey)}&i=${encodeURIComponent(imdbId)}&plot=full`

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await rateLimit()

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        const omdbError = await readOmdbError(response)
        const kind = classifyOmdbFailure(response.status, omdbError)
        const detail = omdbError ?? `HTTP ${response.status}`

        if (isRetryableOmdbFailure(kind) && attempt < MAX_RETRIES) {
          logger.warn({ status: response.status, omdbError, attempt, imdbId }, 'OMDb request failed, retrying...')
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
          continue
        }

        logger.error({ status: response.status, omdbError, kind, imdbId }, 'OMDb API request failed')
        onLog?.('omdb', imdbId, 'error', detail)
        await recordOmdbError(response.status, omdbError)

        if (isGlobalOmdbFailure(kind)) {
          latch = { key: apiKey, reason: detail, at: Date.now() }
          logger.error({ kind, detail }, 'OMDb disabled for the next few minutes — the failure is about the key, not the title')
        }

        throw new OmdbRequestError(response.status, omdbError, kind)
      }

      const data = (await response.json()) as OMDbMovieResponse

      if (data.Response === 'False') {
        // OMDb reports auth and quota faults this way too, at HTTP 200, so a
        // blanket "False means not found" reads an invalid key as a definitive
        // answer about the title and retires the row forever.
        if (!isNotFoundBody(data.Error)) {
          const kind = classifyOmdbFailure(200, data.Error ?? null)
          logger.error({ imdbId, error: data.Error, kind }, 'OMDb returned an error body')
          onLog?.('omdb', imdbId, 'error', data.Error ?? 'Unknown OMDb error')
          await recordOmdbError(200, data.Error ?? null)
          if (isGlobalOmdbFailure(kind)) {
            latch = { key: apiKey, reason: data.Error ?? 'Unknown OMDb error', at: Date.now() }
          }
          throw new OmdbRequestError(200, data.Error ?? null, kind)
        }

        clearLatch()
        onLog?.('omdb', imdbId, 'not_found')
        return null
      }

      clearLatch()

      // Build details string with ratings info
      const details: string[] = []
      const rtRating = data.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')
      if (rtRating) details.push(`RT: ${rtRating.Value}`)
      if (data.Metascore && data.Metascore !== 'N/A') details.push(`MC: ${data.Metascore}`)

      onLog?.('omdb', imdbId, 'success', details.length > 0 ? details.join(', ') : undefined)
      return data
    } catch (err) {
      // Already classified and reported above; retrying would only re-record it.
      if (err instanceof OmdbRequestError) throw err

      if (attempt === MAX_RETRIES) {
        logger.error({ err, imdbId }, 'OMDb API request failed after retries')
        onLog?.('omdb', imdbId, 'error', err instanceof Error ? err.message : 'Unknown error')
        throw new OmdbRequestError(0, err instanceof Error ? err.message : null, 'transport')
      }
      logger.warn({ err, attempt, imdbId }, 'OMDb API request failed, retrying...')
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
    }
  }

  // The loop only falls through here after exhausting retries without a verdict.
  throw new OmdbRequestError(0, 'Exhausted retries', 'transport')
}
