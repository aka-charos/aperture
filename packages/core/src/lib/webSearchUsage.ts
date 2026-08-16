/**
 * Usage meter for the roles that spend Google Gemini grounding quota:
 * `webSearch` and `titleAnalysis`.
 *
 * Every grounding call writes a row to `web_search_usage`; the admin panel reads
 * a summary of the last minute and the current Gemini day back out and shows it
 * against the free-tier limits in ./webSearchQuota.ts.
 *
 * Three things shape the queries. Gemini's daily request quota is **per model**
 * and resets at midnight US/Pacific, not UTC and not local — so the day window
 * is anchored there and the counts are filtered to the configured model.
 * The quotas are per project, i.e. per API key — so counts are broken out
 * per key slot rather than lumped together, or a fallback key's spend would
 * make the primary's meter look full. And they are broken out **per role**,
 * because two roles now spend this quota from different credentials: one number
 * covering both could not answer "which of them exhausted the day", which is
 * the entire question the split exists to make answerable.
 *
 * Nothing here throws at its caller: a usage meter must never be able to break
 * the search it is measuring.
 */
import type { AIFunction } from './ai-capabilities/types.js'
import { query } from './db.js'
import { createChildLogger } from './logger.js'
import {
  getFreeTierLimits,
  getSlotCooldownUntil,
  type FreeTierLimits,
  type WebSearchKeySlot,
} from './webSearchQuota.js'

const logger = createChildLogger('web-search-usage')

/**
 * How a call ended. `rate_limited` rows are what make the 429s visible.
 *
 * `empty` is a request that SUCCEEDED at the HTTP level and returned no usable
 * text — a soft refusal. It is not `ok` (nothing came back), not `error`
 * (nothing failed), and not `rate_limited` (quota was fine). It exists because
 * grounding retries an empty response, and every one of those retries is a
 * request the provider counts against the daily limit: without a status for it,
 * the retry either went unrecorded (undercounting real spend) or had to be
 * mislabelled as a success.
 */
export type WebSearchCallStatus = 'ok' | 'rate_limited' | 'error' | 'empty'

export interface WebSearchCallRecord {
  /**
   * Which role spent the quota. Two do, from different credentials, and the
   * meter is useless if it cannot tell them apart.
   */
  role: AIFunction
  provider: string
  model: string
  slot: WebSearchKeySlot
  status: WebSearchCallStatus
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/** Rolling meter, not an audit log — rows past this are dropped. */
const RETENTION_DAYS = 3
/** Prune at most this often per process. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000

let lastPruneAt = 0

/** SQL for the start of the current Gemini day (midnight US/Pacific). */
const PACIFIC_DAY_START =
  "(date_trunc('day', NOW() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles')"

function toInt(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

/** Log one Web Search call. Never throws. */
export async function recordWebSearchCall(record: WebSearchCallRecord): Promise<void> {
  const input = toInt(record.inputTokens)
  const output = toInt(record.outputTokens)
  // Providers sometimes report only the parts, sometimes only the total.
  const total = toInt(record.totalTokens) || input + output

  try {
    await query(
      `INSERT INTO web_search_usage
         (role, provider, model, key_slot, status, input_tokens, output_tokens, total_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [record.role, record.provider, record.model, record.slot, record.status, input, output, total]
    )
  } catch (err) {
    logger.warn({ err, role: record.role, slot: record.slot }, 'Failed to record Web Search usage')
    return
  }

  void pruneOldUsage()
}

/** Drop rows past the retention window, at most hourly. Never throws. */
async function pruneOldUsage(): Promise<void> {
  const now = Date.now()
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return
  lastPruneAt = now
  try {
    await query(`DELETE FROM web_search_usage WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`)
  } catch (err) {
    logger.warn({ err }, 'Failed to prune Web Search usage')
  }
}

export interface WebSearchUsageWindow {
  requests: number
  tokens: number
}

export interface WebSearchSlotUsage {
  slot: WebSearchKeySlot
  /** Trailing 60 seconds — the window RPM and TPM are measured over. */
  minute: WebSearchUsageWindow
  /** Since midnight US/Pacific — the window RPD is measured over. */
  day: WebSearchUsageWindow
  /** 429s this key took today. Non-zero means the free tier is biting. */
  rateLimitedToday: number
  lastRateLimitedAt: string | null
  lastUsedAt: string | null
  /** Set while the key is parked after a 429 (see webSearchQuota). */
  cooldownUntil: string | null
}

export interface WebSearchUsageSummary {
  /** Which role's spend this is. */
  role: AIFunction
  /** The model these counts are for; quotas are per model. */
  model: string | null
  /** Published free-tier limits, or null for a model we have no figures for. */
  limits: FreeTierLimits | null
  dayStart: string
  dayResetsAt: string
  slots: WebSearchSlotUsage[]
}

interface UsageRow {
  key_slot: string
  minute_requests: number
  minute_tokens: string | number
  day_requests: number
  day_tokens: string | number
  rate_limited_today: number
  last_rate_limited_at: Date | null
  last_used_at: Date | null
}

function emptySlot(role: AIFunction, slot: WebSearchKeySlot, now: number): WebSearchSlotUsage {
  const cooldown = getSlotCooldownUntil(role, slot, now)
  return {
    slot,
    minute: { requests: 0, tokens: 0 },
    day: { requests: 0, tokens: 0 },
    rateLimitedToday: 0,
    lastRateLimitedAt: null,
    lastUsedAt: null,
    cooldownUntil: cooldown ? new Date(cooldown).toISOString() : null,
  }
}

/**
 * Counts for one role's model, per key slot. Returns zeroed slots (rather than
 * throwing) when the table is missing or the query fails, so a settings page
 * still renders on a database that hasn't run the migration yet.
 *
 * `slots` is passed in rather than derived from a constant because how many
 * keys a role holds is now configuration. A slot that has spent nothing still
 * appears — an unused fallback reading zero is information, and a slot missing
 * from the panel would look like a key that was never configured.
 */
export async function getWebSearchUsageSummary(
  role: AIFunction,
  model: string | null,
  slots: WebSearchKeySlot[]
): Promise<WebSearchUsageSummary> {
  const now = Date.now()
  const limits = getFreeTierLimits(model)

  const empty: WebSearchUsageSummary = {
    role,
    model,
    limits,
    dayStart: new Date(now).toISOString(),
    dayResetsAt: new Date(now).toISOString(),
    slots: slots.map((slot) => emptySlot(role, slot, now)),
  }

  try {
    const bounds = await query<{ day_start: Date; day_resets_at: Date }>(
      `SELECT ${PACIFIC_DAY_START} AS day_start,
              ${PACIFIC_DAY_START} + INTERVAL '1 day' AS day_resets_at`
    )
    const dayStart = bounds.rows[0]?.day_start
    const dayResetsAt = bounds.rows[0]?.day_resets_at
    if (dayStart) empty.dayStart = dayStart.toISOString()
    if (dayResetsAt) empty.dayResetsAt = dayResetsAt.toISOString()

    // `model IS NULL OR model = $1` keeps the meter honest when the role has no
    // model configured yet: show everything rather than silently nothing.
    const rows = await query<UsageRow>(
      `SELECT
         key_slot,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 minute')::int AS minute_requests,
         COALESCE(SUM(total_tokens) FILTER (WHERE created_at >= NOW() - INTERVAL '1 minute'), 0) AS minute_tokens,
         COUNT(*) FILTER (WHERE created_at >= ${PACIFIC_DAY_START})::int AS day_requests,
         COALESCE(SUM(total_tokens) FILTER (WHERE created_at >= ${PACIFIC_DAY_START}), 0) AS day_tokens,
         COUNT(*) FILTER (WHERE created_at >= ${PACIFIC_DAY_START} AND status = 'rate_limited')::int AS rate_limited_today,
         MAX(created_at) FILTER (WHERE status = 'rate_limited') AS last_rate_limited_at,
         MAX(created_at) AS last_used_at
       FROM web_search_usage
       WHERE created_at >= ${PACIFIC_DAY_START} - INTERVAL '1 day'
         AND role = $2
         AND ($1::text IS NULL OR model = $1)
       GROUP BY key_slot`,
      [model, role]
    )

    const bySlot = new Map(rows.rows.map((r) => [r.key_slot, r]))
    const slotUsage = slots.map((slot) => {
      const row = bySlot.get(slot)
      if (!row) return emptySlot(role, slot, now)
      const cooldown = getSlotCooldownUntil(role, slot, now)
      return {
        slot,
        minute: { requests: row.minute_requests, tokens: Number(row.minute_tokens) },
        day: { requests: row.day_requests, tokens: Number(row.day_tokens) },
        rateLimitedToday: row.rate_limited_today,
        lastRateLimitedAt: row.last_rate_limited_at?.toISOString() ?? null,
        lastUsedAt: row.last_used_at?.toISOString() ?? null,
        cooldownUntil: cooldown ? new Date(cooldown).toISOString() : null,
      }
    })

    return { ...empty, slots: slotUsage }
  } catch (err) {
    logger.warn({ err, role }, 'Failed to read Web Search usage; reporting zeroes')
    return empty
  }
}
