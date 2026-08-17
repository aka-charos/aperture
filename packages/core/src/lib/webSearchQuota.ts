/**
 * Free-tier quota handling for any role that spends Google Gemini grounding
 * quota. One does: `webSearch`, behind the assistant's discovery and channel
 * web-expansion. (`titleAnalysis` was the second until it moved to a
 * self-hosted retrieval endpoint; the role parameter survives because a
 * self-hosted grounding source is planned for discovery — see 0142.)
 *
 * Grounding runs on a Gemini key that is very often a free-tier one, and the
 * free tier is metered three ways at once: requests per minute, requests per
 * day, and tokens per minute. Blow any of them and the API answers
 * `429 RESOURCE_EXHAUSTED` (https://ai.google.dev/gemini-api/docs/rate-limits).
 *
 * This module is the pure half of the response to that: the published limits,
 * the classification of a 429 into "wait a minute" vs "wait until tomorrow",
 * and a per-key cooldown so an exhausted key is skipped instead of being
 * hammered. The DB-backed counters live in ./webSearchUsage.ts; the key
 * switching lives in ./ai-provider.ts.
 *
 * The `webSearch*` naming is historical — it predates the second role, and the
 * usage table it feeds is `web_search_usage`. Renaming the code without being
 * able to rename the table would trade one confusion for a worse one.
 */
import type { AIFunction } from './ai-capabilities/types.js'
import { createChildLogger } from './logger.js'

const logger = createChildLogger('web-search-quota')

/**
 * Which configured API key served a call: `primary`, then `fallback`,
 * `fallback2`, `fallback3`… for as many as the role holds.
 *
 * A plain string rather than a union because the count is now configurable.
 * The first fallback keeps the bare name `fallback` deliberately — historical
 * `web_search_usage` rows carry it, and renaming would split one key's history
 * into two slots in the admin panel.
 */
export type WebSearchKeySlot = string

/** Slot name for the nth configured key (0 = primary). */
export function keySlotName(index: number): WebSearchKeySlot {
  if (index === 0) return 'primary'
  if (index === 1) return 'fallback'
  return `fallback${index}`
}

/**
 * Every field is optional because each is learned separately — see
 * {@link getFreeTierLimits}. A missing field means "no denominator yet", which
 * the panel renders as a bare count rather than a bar.
 */
export interface FreeTierLimits {
  /** Requests per minute. */
  rpm?: number
  /** Requests per day, resetting at midnight US/Pacific. */
  rpd?: number
  /** Tokens per minute (input + output). */
  tpm?: number
  /**
   * Grounded-search requests per day — a SEPARATE quota from the model's own,
   * charged per model *family* rather than per model. A role can sit well
   * inside every number above and still be refused, which is why this is its
   * own field rather than folded into `rpd`.
   *
   * **Zero is a real answer here, not a missing one.** On the free tier the
   * whole Gemini 3.x family currently has no grounding allowance at all, so
   * anything reading this must test `undefined`, never falsiness.
   */
  groundingRpd?: number
}

/**
 * Limits OBSERVED from Google's own 429 responses, keyed by model.
 *
 * This is the authority. Google's quota rejections carry a `QuotaFailure`
 * detail naming the violated quota and its `quotaValue`, which is *this*
 * account's real limit for *this* model — not a documented figure, not a tier
 * assumption, the enforced number. It therefore overrides the shipped free-tier
 * table below in every case, field by field.
 *
 * That ordering is not a preference, it is the lesson from getting it backwards:
 * a hardcoded table claiming 1,000 requests/day for a model the live account
 * caps at 20 drew a green bar at 1.2% of a budget that was 60% spent. The table
 * is back — see {@link FREE_TIER_MODEL_LIMITS} — but only as a stated
 * assumption about a stated tier, and only where nothing has been observed.
 *
 * In memory, deliberately, exactly like the cooldowns below: losing it on
 * restart costs a gauge until the next 429, whereas persisting it risks showing
 * a stale limit after Google revises one or the operator upgrades a tier. It is
 * display data and nothing throttles on it.
 *
 * Note these are limits on the MODEL. Grounded search carries a separate
 * allowance, charged per model family, which `groundingRpd` holds — so a role
 * well inside every number here can still be refused, and on the free tier a
 * Gemini 3.x model is refused *always*.
 */
const observedLimits = new Map<string, FreeTierLimits>()

/**
 * Limits for a model as learned from its 429s, or null if none have arrived.
 *
 * Returns a copy: callers hand this straight to an API response, and a mutation
 * there would silently rewrite what every later request reports.
 */
export function getFreeTierLimits(modelId: string | null | undefined): FreeTierLimits | null {
  if (!modelId) return null
  const learned = observedLimits.get(modelId)
  if (!learned) return null
  return { ...learned }
}

/**
 * Record a limit Google just told us about.
 *
 * Exported for the one caller that has a model id and a classified error in
 * hand at the same time ({@link markSlotExhausted}), and for tests.
 */
export function noteObservedLimit(modelId: string, info: QuotaErrorInfo): void {
  if (!info.observedLimit || !Number.isFinite(info.observedLimit)) return

  const field: keyof FreeTierLimits | null = info.limitIsTokens
    ? 'tpm'
    : info.limitIsGrounding
      ? // The grounding allowance is a per-day tool quota and is NOT the model's
        // own ceiling: recording it as `rpd` would draw a 1,500/day search
        // budget on a bar measuring a 20/day model. An unattributed scope is
        // safe here where it isn't below, because grounding has only the one
        // bucket — the page lists no per-minute figure for it.
        info.scope === 'day' || info.scope === 'unknown'
        ? 'groundingRpd'
        : null
      : info.scope === 'day'
        ? 'rpd'
        : info.scope === 'minute'
          ? 'rpm'
          : // An unattributed 429 tells us a number but not which bucket it
            // belongs to, and guessing would put a per-minute cap on the daily
            // bar. Drop it; another rejection will be clearer.
            null
  if (!field) return

  const current = observedLimits.get(modelId) ?? {}
  if (current[field] === info.observedLimit) return

  observedLimits.set(modelId, { ...current, [field]: info.observedLimit })
  logger.info(
    { model: modelId, [field]: info.observedLimit },
    'Learned a quota limit from Google’s 429'
  )
}

/** Test seam — the map is process-wide and would otherwise leak between cases. */
export function clearObservedLimits(): void {
  observedLimits.clear()
}

// ============================================================================
// Free-tier defaults
// ============================================================================

/**
 * Free-tier ceilings per model, transcribed from the AI Studio rate-limit page
 * of a live free-tier account on 2026-08-17.
 *
 * A table like this existed before and was deleted, for good reasons that still
 * hold: it claimed 1,000 requests/day for a model the account caps at 20, so the
 * panel drew a green bar at 1.2% of a budget that was 60% gone. Google has
 * withdrawn the published per-model table, and the numbers genuinely differ
 * between accounts and tiers, so no table can ever be authoritative.
 *
 * Two things make one safe again, and both are load-bearing. It applies **only
 * when the operator has said this key is a free-tier one** — otherwise a paid
 * account would see a 20/day ceiling it does not have, which is the same
 * confidently-wrong gauge wearing different numbers. And it is **subordinate to
 * observation**: the moment Google's own 429 names a limit, that wins, field by
 * field ({@link resolveModelLimits}).
 *
 * Keys are deliberately restricted to models this app can actually select
 * (`ai-capabilities/data/google.json`) — Google is not a custom-model provider,
 * so nothing else can reach here, and an id nobody can pick is an id nobody can
 * check. An unlisted model resolves to nothing, which the panel renders as a
 * bare count. `gemini-1.5-pro` is absent because the account's page does not
 * list it at all.
 */
const FREE_TIER_MODEL_LIMITS: Readonly<Record<string, FreeTierLimits>> = {
  'gemini-3.7-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemini-3.5-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemini-3.5-flash-lite': { rpm: 15, tpm: 250_000, rpd: 500 },
  'gemini-3.1-flash-lite': { rpm: 15, tpm: 250_000, rpd: 500 },
  'gemini-2.5-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemini-2.5-flash-lite': { rpm: 10, tpm: 250_000, rpd: 20 },
  'gemini-embedding-001': { rpm: 100, tpm: 30_000, rpd: 1_000 },
}

/**
 * Free-tier grounded-search allowance, per model FAMILY, from the same page.
 *
 * The finding that matters: **the Gemini 3.x family gets none.** Search
 * grounding appears there as four buckets — Default, Gemini 2, Gemini 2.5 and
 * Gemini 3, at 1,500 / 1,500 / 1,500 / **0** requests per day — whereas *map*
 * grounding is listed per model, which is what identifies these as family
 * buckets rather than model rows.
 *
 * Read together with the table above, that says something the model limits
 * alone cannot. The only groundable free-tier models are the 2.x ones, whose
 * own ceiling is 20 requests a day — so the 1,500 allowance never binds, the
 * model does, and 20 grounded calls a day is the real figure. Meanwhile a 3.x
 * model cannot ground at all however much of its 500/day is untouched, and 3.x
 * is what a new Google project is limited to: `gemini-2.5-flash-lite` is no
 * longer offered to new projects.
 *
 * Confirmed by the bucket's own tooltip on that page, which lists its members:
 * every 3.x model including `gemini-3.5-flash-lite` — 500 requests/day of its
 * own, and no grounding at all — plus the floating aliases `gemini-flash-latest`,
 * `gemini-flash-lite-latest` and `gemini-pro-latest`. Those three sit in the
 * bucket but do NOT start with `gemini-3`, so adding one to `google.json` would
 * need an entry here or its allowance would silently read as unknown.
 *
 * "Default" is deliberately not mapped. The page does not say what falls into
 * it, and guessing a bucket is exactly how the old table went wrong.
 */
const FREE_TIER_GROUNDING_RPD: ReadonlyArray<readonly [prefix: string, rpd: number]> = [
  ['gemini-3', 0],
  ['gemini-2.5', 1500],
  ['gemini-2', 1500],
]

/** Grounding allowance for a model, by longest matching family prefix. */
function freeTierGroundingRpd(modelId: string): number | undefined {
  let best: { length: number; rpd: number } | undefined
  for (const [prefix, rpd] of FREE_TIER_GROUNDING_RPD) {
    // `gemini-2` prefixes `gemini-2.5-flash` too, so the longest match wins or
    // every 2.5 model would read as plain 2.x. Today they agree; the next
    // revision of the page is exactly when they would not.
    if (!modelId.startsWith(prefix)) continue
    if (!best || prefix.length > best.length) best = { length: prefix.length, rpd }
  }
  return best?.rpd
}

/** Everything the free-tier tables know about a model, or null for silence. */
function freeTierLimitsFor(modelId: string): FreeTierLimits | null {
  const model = FREE_TIER_MODEL_LIMITS[modelId]
  const groundingRpd = freeTierGroundingRpd(modelId)
  if (!model && groundingRpd === undefined) return null
  return { ...model, ...(groundingRpd === undefined ? {} : { groundingRpd }) }
}

/** Which authority a resolved ceiling came from, so the panel can say so. */
export type LimitSource = 'observed' | 'freeTier' | 'mixed'

export interface ResolvedLimits extends FreeTierLimits {
  /** `mixed` means at least one number came from the shipped free-tier table. */
  source: LimitSource
}

/**
 * The ceilings to show for a model: the free-tier table when the operator says
 * this key is on the free tier, with anything Google has actually told us laid
 * over the top, field by field.
 *
 * Observation always wins and always applies — a paid tier has limits too, just
 * larger ones, so a 429 is worth believing whatever the checkbox says. Turning
 * the checkbox off therefore does not blind the meter; it stops it asserting
 * numbers that belong to a tier the operator is not on.
 *
 * Null when there is nothing to say, which the panel renders as counts with no
 * bar — the honest rendering, and the one this module exists to protect.
 */
export function resolveModelLimits(
  modelId: string | null | undefined,
  opts: { freeTier: boolean }
): ResolvedLimits | null {
  if (!modelId) return null

  const observed = getFreeTierLimits(modelId)
  const published = opts.freeTier ? freeTierLimitsFor(modelId) : null
  if (!observed && !published) return null

  const source: LimitSource = observed && published ? 'mixed' : observed ? 'observed' : 'freeTier'
  // `observed` only ever carries fields it genuinely learned, so spreading it
  // last overlays without punching holes in the defaults underneath.
  return { ...published, ...observed, source }
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
  /**
   * The violated quota's actual value, when the body named it. This is the
   * account's real limit and the only trustworthy source of one — see
   * {@link getFreeTierLimits}.
   */
  observedLimit?: number
  /** True when the violated quota counts tokens rather than requests. */
  limitIsTokens?: boolean
  /**
   * True when the violated quota is the grounded-search allowance rather than
   * the model's own request budget. They are separate ceilings with wildly
   * different values, so conflating them puts one on the other's bar.
   */
  limitIsGrounding?: boolean
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

  // The account's real limit, straight from the QuotaFailure detail:
  //   "quotaValue": "20"
  // Some responses phrase it in the message instead ("limit: 20"), so both are
  // matched. `quotaValue` wins — it is structured, and a message can mention a
  // number that is not the limit.
  const limitMatch =
    /"?quota_?[Vv]alue"?\s*[:=]\s*"?(\d+)"?/.exec(blob) ??
    /\blimit(?:\s+of)?\s*[:=]?\s*(\d+)\b/i.exec(blob)
  const observedLimit = limitMatch ? Number(limitMatch[1]) : undefined

  // A token quota reads as PerMinute too, so without this a TPM ceiling would
  // be recorded as a requests-per-minute limit and the RPM bar would show a
  // quarter-million.
  const limitIsTokens = /token/i.test(blob)

  // Same class of mistake, other quota: a grounding refusal is also a per-day
  // request limit, so without this the search allowance would be filed as the
  // model's own ceiling. The ordinary quota ids (`GenerateRequestsPerDay…`,
  // `generate_content_free_tier_requests`) carry neither word, and Gemini model
  // ids carry neither either, so this cannot fire on a plain model 429.
  const limitIsGrounding = /grounding|google.?search/i.test(blob)

  return { isQuota: true, scope, retryAfterMs, observedLimit, limitIsTokens, limitIsGrounding }
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
  role: AIFunction
  slot: WebSearchKeySlot
  until: number
  scope: QuotaScope
}

/**
 * In-memory, deliberately. A cooldown is an optimisation — skip a key we just
 * saw fail — and losing it on restart costs one wasted request, which the 429
 * handler then re-parks. Persisting it would risk the opposite mistake: parking
 * a key that has since recovered.
 *
 * Keyed by role AND slot. Every role names its first key `primary`, so keying
 * on the slot alone would let one role's exhausted key park another role's
 * working one — which is the exact contention that giving `titleAnalysis` its
 * own credentials exists to prevent.
 */
const cooldowns = new Map<string, SlotCooldown>()

const cooldownKey = (role: AIFunction, slot: WebSearchKeySlot) => `${role}:${slot}`

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

/**
 * Park a key after a quota rejection. Returns when it becomes usable again.
 *
 * Also harvests the limit Google just disclosed, when the caller knows which
 * model was refused. Doing it here rather than at the call sites is deliberate:
 * every quota rejection already funnels through this function, so a new caller
 * cannot forget to feed the gauge.
 */
export function markSlotExhausted(
  role: AIFunction,
  slot: WebSearchKeySlot,
  info: QuotaErrorInfo,
  modelId?: string | null,
  now: number = Date.now()
): number {
  if (modelId) noteObservedLimit(modelId, info)

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

  const key = cooldownKey(role, slot)
  const existing = cooldowns.get(key)
  if (existing && existing.until >= until) return existing.until

  cooldowns.set(key, { role, slot, until, scope: info.scope })
  logger.warn(
    { role, slot, scope: info.scope, waitSeconds: Math.round(waitMs / 1000) },
    'Grounding key hit its quota; parking it'
  )
  return until
}

/** When this key becomes usable again, or null if it is usable now. */
export function getSlotCooldownUntil(
  role: AIFunction,
  slot: WebSearchKeySlot,
  now: number = Date.now()
): number | null {
  const key = cooldownKey(role, slot)
  const cooldown = cooldowns.get(key)
  if (!cooldown) return null
  if (cooldown.until <= now) {
    cooldowns.delete(key)
    return null
  }
  return cooldown.until
}

/** True when the key is parked and should be skipped if another is available. */
export function isSlotCoolingDown(
  role: AIFunction,
  slot: WebSearchKeySlot,
  now: number = Date.now()
): boolean {
  return getSlotCooldownUntil(role, slot, now) !== null
}

/** Clear a key's cooldown — called when it serves a request successfully. */
export function clearSlotCooldown(role: AIFunction, slot: WebSearchKeySlot): void {
  cooldowns.delete(cooldownKey(role, slot))
}

/**
 * Current cooldowns, for the admin usage panel. Walks the map rather than a
 * fixed slot list, since how many keys a role holds is now configuration.
 */
export function getSlotCooldowns(
  now: number = Date.now()
): Array<{ role: AIFunction; slot: WebSearchKeySlot; until: string; scope: QuotaScope }> {
  const out: Array<{
    role: AIFunction
    slot: WebSearchKeySlot
    until: string
    scope: QuotaScope
  }> = []
  for (const [key, cooldown] of cooldowns) {
    if (cooldown.until <= now) {
      cooldowns.delete(key)
      continue
    }
    out.push({
      role: cooldown.role,
      slot: cooldown.slot,
      until: new Date(cooldown.until).toISOString(),
      scope: cooldown.scope,
    })
  }
  return out
}
