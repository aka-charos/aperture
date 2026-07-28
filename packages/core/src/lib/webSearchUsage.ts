/**
 * Usage meter for the Web Search (Google Gemini grounding) role.
 *
 * Every grounding call writes a row to `web_search_usage`; the admin panel reads
 * a summary of the last minute and the current Gemini day back out and shows it
 * against the free-tier limits in ./webSearchQuota.ts.
 *
 * Two things shape the queries. Gemini's daily request quota is **per model**
 * and resets at midnight US/Pacific, not UTC and not local — so the day window
 * is anchored there and the counts are filtered to the configured model.
 * And the quotas are per project, i.e. per API key — so counts are broken out
 * per key slot rather than lumped together, or a fallback key's spend would
 * make the primary's meter look full.
 *
 * Nothing here throws at its caller: a usage meter must never be able to break
 * the search it is measuring.
 */
import { query } from './db.js'
import { createChildLogger } from './logger.js'
import {
  getFreeTierLimits,
  getSlotCooldownUntil,
  WEB_SEARCH_KEY_SLOTS,
  type FreeTierLimits,
  type WebSearchKeySlot,
} from './webSearchQuota.js'

const logger = createChildLogger('web-search-usage')

/** How a call ended. `rate_limited` rows are what make the 429s visible. */
export type WebSearchCallStatus = 'ok' | 'rate_limited' | 'error'

export interface WebSearchCallRecord {
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
         (provider, model, key_slot, status, input_tokens, output_tokens, total_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [record.provider, record.model, record.slot, record.status, input, output, total]
    )
  } catch (err) {
    logger.warn({ err, slot: record.slot }, 'Failed to record Web Search usage')
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

function emptySlot(slot: WebSearchKeySlot, now: number): WebSearchSlotUsage {
  const cooldown = getSlotCooldownUntil(slot, now)
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
 * Counts for the given model, per key slot. Returns zeroed slots (rather than
 * throwing) when the table is missing or the query fails, so a settings page
 * still renders on a database that hasn't run the migration yet.
 */
export async function getWebSearchUsageSummary(
  model: string | null
): Promise<WebSearchUsageSummary> {
  const now = Date.now()
  const limits = getFreeTierLimits(model)

  const empty: WebSearchUsageSummary = {
    model,
    limits,
    dayStart: new Date(now).toISOString(),
    dayResetsAt: new Date(now).toISOString(),
    slots: WEB_SEARCH_KEY_SLOTS.map((slot) => emptySlot(slot, now)),
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
         AND ($1::text IS NULL OR model = $1)
       GROUP BY key_slot`,
      [model]
    )

    const bySlot = new Map(rows.rows.map((r) => [r.key_slot, r]))
    const slots = WEB_SEARCH_KEY_SLOTS.map((slot) => {
      const row = bySlot.get(slot)
      if (!row) return emptySlot(slot, now)
      const cooldown = getSlotCooldownUntil(slot, now)
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

    return { ...empty, slots }
  } catch (err) {
    logger.warn({ err }, 'Failed to read Web Search usage; reporting zeroes')
    return empty
  }
}
