/**
 * Free-tier quota handling for the Web Search (Google Gemini grounding) role.
 *
 * Grounding runs on a Gemini key that is very often a free-tier one, and the
 * free tier is metered three ways at once: requests per minute, requests per
 * day, and tokens per minute. Blow any of them and the API answers
 * `429 RESOURCE_EXHAUSTED` (https://ai.google.dev/gemini-api/docs/rate-limits).
 *
 * This module is the pure half of the response to that: the published limits,
 * the classification of a 429 into "wait a minute" vs "wait until tomorrow",
 * and a per-key-slot cooldown so an exhausted key is skipped instead of being
 * hammered. The DB-backed counters live in ./webSearchUsage.ts; the key
 * switching lives in ./ai-provider.ts.
 */
import { createChildLogger } from './logger.js'

const logger = createChildLogger('web-search-quota')

/**
 * Which configured API key served a call. The Web Search role can hold two: the
 * everyday one and a fallback used when the first hits its quota.
 */
export type WebSearchKeySlot = 'primary' | 'fallback'

export const WEB_SEARCH_KEY_SLOTS: WebSearchKeySlot[] = ['primary', 'fallback']

export interface FreeTierLimits {
  /** Requests per minute. */
  rpm: number
  /** Requests per day, resetting at midnight US/Pacific. */
  rpd: number
  /** Tokens per minute (input + output). */
  tpm: number
}

/**
 * Google's published free-tier limits, per model. These are Google's numbers,
 * not ours, and Google revises them — they drive a progress bar and a warning,
 * never a hard block, so being a revision behind degrades to a slightly wrong
 * gauge rather than a refused request.
 *
 * Models absent here (anything newer, or a paid-tier key) simply have no
 * denominator: usage is still counted and shown, just without a limit.
 */
const GEMINI_FREE_TIER_LIMITS: Record<string, FreeTierLimits> = {
  'gemini-2.5-flash-lite': { rpm: 15, rpd: 1000, tpm: 250_000 },
  'gemini-2.5-flash': { rpm: 10, rpd: 250, tpm: 250_000 },
  'gemini-2.5-pro': { rpm: 5, rpd: 100, tpm: 250_000 },
}

/** Published free-tier limits for a model, or null when we don't know them. */
export function getFreeTierLimits(modelId: string | null | undefined): FreeTierLimits | null {
  if (!modelId) return null
  return GEMINI_FREE_TIER_LIMITS[modelId] ?? null
}

// ============================================================================
// 429 classification
// ============================================================================

/** Which bucket a 429 blew through — decides how long the key stays parked. */
export type QuotaScope = 'minute' | 'day' | 'unknown'

export interface QuotaErrorInfo {
  /** True when this is a rate/quota rejection rather than any other failure. */
  isQuota: boolean
  scope: QuotaScope
  /** Google's own RetryInfo, when the error body carried one. */
  retryAfterMs?: number
}

const NOT_QUOTA: QuotaErrorInfo = { isQuota: false, scope: 'unknown' }

/** Flatten an error's cause chain (bounded — chains can be cyclic). */
function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = []
  let current: unknown = err
  for (let i = 0; i < 6 && current != null; i++) {
    chain.push(current)
    // The AI SDK's RetryError keeps the real failure on `lastError`.
    const lastError = (current as { lastError?: unknown }).lastError
    if (lastError != null) {
      current = lastError
    } else if (current instanceof Error && current.cause != null) {
      current = current.cause
    } else {
      break
    }
  }
  return chain
}

/** Every string on an error worth pattern-matching (message + raw response body). */
function errorTexts(err: unknown): string[] {
  const texts: string[] = []
  for (const e of errorChain(err)) {
    if (e instanceof Error && e.message) texts.push(e.message)
    const body = (e as { responseBody?: unknown }).responseBody
    if (typeof body === 'string') texts.push(body)
    const data = (e as { data?: unknown }).data
    if (data != null && typeof data === 'object') {
      try {
        texts.push(JSON.stringify(data))
      } catch {
        // Circular / unserializable — the message alone will have to do.
      }
    }
  }
  return texts
}

/**
 * Decide whether a failure is Gemini telling us we're out of quota, and which
 * quota it was. Duck-typed rather than instanceof-checked against the AI SDK's
 * APICallError, so a raw fetch failure or a re-thrown wrapper classifies too.
 *
 * Google's 429 body names the violated quota in `quotaId`
 * (e.g. `GenerateRequestsPerDayPerProjectPerModel-FreeTier`) and often carries a
 * `RetryInfo` with `retryDelay: "27s"` — both are used when present.
 */
export function classifyQuotaError(err: unknown): QuotaErrorInfo {
  const statusCode = errorChain(err)
    .map((e) => (e as { statusCode?: unknown }).statusCode)
    .find((s): s is number => typeof s === 'number')

  const texts = errorTexts(err)
  const blob = texts.join(' ')

  const looksLikeQuota =
    statusCode === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(blob)
  if (!looksLikeQuota) return NOT_QUOTA

  // A 4xx that isn't 429 mentioning "quota" in passing is not a rate limit.
  if (typeof statusCode === 'number' && statusCode !== 429) return NOT_QUOTA

  const scope: QuotaScope = /PerDay|per day|daily/i.test(blob)
    ? 'day'
    : /PerMinute|per minute/i.test(blob)
      ? 'minute'
      : 'unknown'

  // "retryDelay": "27s" — seconds, occasionally fractional.
  const retryMatch = /"?retry[-_]?(?:delay|after)"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s?"?/i.exec(blob)
  const retryAfterMs = retryMatch ? Math.round(Number(retryMatch[1]) * 1000) : undefined

  return { isQuota: true, scope, retryAfterMs }
}

// ============================================================================
// Per-slot cooldowns
// ============================================================================

/**
 * How long a key sits out after a 429 we couldn't attribute to a specific
 * bucket. Long enough to clear a per-minute window, short enough that a
 * one-off blip doesn't park a working key for the rest of the day.
 */
const UNKNOWN_SCOPE_COOLDOWN_MS = 60_000
/** A per-minute quota clears when the minute does. */
const MINUTE_SCOPE_COOLDOWN_MS = 60_000
/** Never park a key for more than this, however the error read. */
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000

interface SlotCooldown {
  until: number
  scope: QuotaScope
}

/**
 * In-memory, deliberately. A cooldown is an optimisation — skip a key we just
 * saw fail — and losing it on restart costs one wasted request, which the 429
 * handler then re-parks. Persisting it would risk the opposite mistake: parking
 * a key that has since recovered.
 */
const cooldowns = new Map<WebSearchKeySlot, SlotCooldown>()

/** Milliseconds from `now` until the next midnight in US/Pacific, where Gemini's daily quota rolls over. */
function msUntilPacificMidnight(now: number): number {
  const date = new Date(now)
  // Pacific wall-clock time right now, as an offset from UTC.
  const pacific = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offsetMs = pacific.getTime() - utc.getTime()

  const pacificMs = now + offsetMs
  const sinceMidnight = ((pacificMs % 86_400_000) + 86_400_000) % 86_400_000
  return 86_400_000 - sinceMidnight
}

/** Park a key after a quota rejection. Returns when it becomes usable again. */
export function markSlotExhausted(
  slot: WebSearchKeySlot,
  info: QuotaErrorInfo,
  now: number = Date.now()
): number {
  const base =
    info.scope === 'day'
      ? msUntilPacificMidnight(now)
      : info.scope === 'minute'
        ? MINUTE_SCOPE_COOLDOWN_MS
        : UNKNOWN_SCOPE_COOLDOWN_MS

  // Google's own RetryInfo wins when it asks for longer than our default.
  const raw = Math.min(MAX_COOLDOWN_MS, Math.max(base, info.retryAfterMs ?? 0))
  // A non-finite value here (a timezone or retryDelay we failed to parse) would
  // park the key for good, since NaN never compares as expired. Short-cool instead.
  const waitMs = Number.isFinite(raw) && raw > 0 ? raw : UNKNOWN_SCOPE_COOLDOWN_MS
  const until = now + waitMs

  const existing = cooldowns.get(slot)
  if (existing && existing.until >= until) return existing.until

  cooldowns.set(slot, { until, scope: info.scope })
  logger.warn(
    { slot, scope: info.scope, waitSeconds: Math.round(waitMs / 1000) },
    'Web Search key hit its quota; parking it'
  )
  return until
}

/** When this key becomes usable again, or null if it is usable now. */
export function getSlotCooldownUntil(
  slot: WebSearchKeySlot,
  now: number = Date.now()
): number | null {
  const cooldown = cooldowns.get(slot)
  if (!cooldown) return null
  if (cooldown.until <= now) {
    cooldowns.delete(slot)
    return null
  }
  return cooldown.until
}

/** True when the key is parked and should be skipped if another is available. */
export function isSlotCoolingDown(slot: WebSearchKeySlot, now: number = Date.now()): boolean {
  return getSlotCooldownUntil(slot, now) !== null
}

/** Clear a key's cooldown — called when it serves a request successfully. */
export function clearSlotCooldown(slot: WebSearchKeySlot): void {
  cooldowns.delete(slot)
}

/** Current cooldowns, for the admin usage panel. */
export function getSlotCooldowns(
  now: number = Date.now()
): Array<{ slot: WebSearchKeySlot; until: string; scope: QuotaScope }> {
  const out: Array<{ slot: WebSearchKeySlot; until: string; scope: QuotaScope }> = []
  for (const slot of WEB_SEARCH_KEY_SLOTS) {
    const cooldown = cooldowns.get(slot)
    if (cooldown && cooldown.until > now) {
      out.push({ slot, until: new Date(cooldown.until).toISOString(), scope: cooldown.scope })
    }
  }
  return out
}
