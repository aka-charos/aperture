/**
 * The inference ledger: writes to `llm_inference_calls`, and the aggregations
 * the admin spend dashboard reads back out.
 *
 * What separates this from the cost estimator is that these are *measurements*.
 * The estimator multiplies published per-million prices by guessed call volumes;
 * this records the token counts and the credits the provider actually charged,
 * per call. Where the two disagree, this one is right.
 *
 * Cost is nullable throughout. OpenRouter reports real cost on every response,
 * which is why the dashboard is scoped to it; other providers report tokens only,
 * so their rows carry counts and no money. Sums treat a missing cost as absent
 * rather than as zero, and the read side reports how much of the window it could
 * actually price — a total that silently ignores unpriced calls is worse than no
 * total at all.
 *
 * Nothing here throws at its caller. A ledger that can break the work it is
 * recording is not worth having.
 */
import { query } from './db.js'
import { createChildLogger } from './logger.js'

const logger = createChildLogger('inference-usage')

/** How the request ended. Errors are recorded too — an error rate is signal. */
export type InferenceCallStatus = 'ok' | 'error'

export interface InferenceCallRecord {
  provider: string
  model: string
  /** AI function that made the call, when known. */
  role?: string
  /** Surface or job it ran under (see ./inferenceContext.ts). */
  feature?: string
  sessionId?: string
  userId?: string
  /** Provider-side id for the generation, for cross-referencing upstream. */
  generationId?: string
  /** Which upstream provider OpenRouter routed to (Anthropic, Fireworks, …). */
  upstreamProvider?: string
  status: InferenceCallStatus
  statusCode?: number
  streamed?: boolean
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cachedTokens?: number
  totalTokens?: number
  /** USD actually charged. Undefined when the provider doesn't report it. */
  cost?: number
  upstreamCost?: number
  latencyMs?: number
}

/**
 * Long enough to see a month-over-month trend and the tail of the one before it.
 * This is an audit log, not the rolling meter web_search_usage is — but it still
 * grows a row per call, so it is not kept forever either.
 */
const RETENTION_DAYS = 120
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000

let lastPruneAt = 0

function toInt(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

function toCost(n: number | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
}

function toText(s: string | undefined): string | null {
  const trimmed = s?.trim()
  return trimmed ? trimmed : null
}

/** Log one inference call. Never throws. */
export async function recordInferenceCall(record: InferenceCallRecord): Promise<void> {
  const prompt = toInt(record.promptTokens)
  const completion = toInt(record.completionTokens)
  // Providers report either the parts or the total, rarely both consistently.
  const total = toInt(record.totalTokens) || prompt + completion

  try {
    await query(
      `INSERT INTO llm_inference_calls
         (provider, model, role, feature, session_id, user_id, generation_id, upstream_provider,
          status, status_code, streamed,
          prompt_tokens, completion_tokens, reasoning_tokens, cached_tokens, total_tokens,
          cost, upstream_cost, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        record.provider,
        record.model,
        toText(record.role),
        toText(record.feature),
        toText(record.sessionId),
        toText(record.userId),
        toText(record.generationId),
        toText(record.upstreamProvider),
        record.status,
        record.statusCode ?? null,
        record.streamed ?? false,
        prompt,
        completion,
        toInt(record.reasoningTokens),
        toInt(record.cachedTokens),
        total,
        toCost(record.cost),
        toCost(record.upstreamCost),
        record.latencyMs ?? null,
      ]
    )
  } catch (err) {
    logger.warn({ err, provider: record.provider, model: record.model }, 'Failed to record inference call')
    return
  }

  void pruneOldCalls()
}

/** Drop rows past the retention window, at most a few times a day. Never throws. */
async function pruneOldCalls(): Promise<void> {
  const now = Date.now()
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return
  lastPruneAt = now
  try {
    await query(
      `DELETE FROM llm_inference_calls WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
    )
  } catch (err) {
    logger.warn({ err }, 'Failed to prune inference calls')
  }
}

// ============================================================================
// Read side
// ============================================================================

export interface InferenceTotals {
  calls: number
  errors: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cachedTokens: number
  totalTokens: number
  /** USD over the window. Only sums the calls the provider actually priced. */
  cost: number
  /** How many of `calls` carried a cost — the rest are counted but not billed. */
  pricedCalls: number
}

export interface InferenceBreakdownRow {
  key: string
  calls: number
  totalTokens: number
  cost: number
}

export interface InferenceDailyRow {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  calls: number
  totalTokens: number
  cost: number
}

export interface InferenceSummary {
  provider: string
  days: number
  since: string
  window: InferenceTotals
  today: InferenceTotals
  daily: InferenceDailyRow[]
  byModel: InferenceBreakdownRow[]
  byRole: InferenceBreakdownRow[]
  byFeature: InferenceBreakdownRow[]
  /** True when the ledger holds nothing at all — the panel says "not yet". */
  empty: boolean
}

const EMPTY_TOTALS: InferenceTotals = {
  calls: 0,
  errors: 0,
  promptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  cost: 0,
  pricedCalls: 0,
}

interface TotalsRow {
  calls: number
  errors: number
  prompt_tokens: string | number
  completion_tokens: string | number
  reasoning_tokens: string | number
  cached_tokens: string | number
  total_tokens: string | number
  cost: string | number | null
  priced_calls: number
}

function toTotals(row: TotalsRow | undefined): InferenceTotals {
  if (!row) return { ...EMPTY_TOTALS }
  return {
    calls: Number(row.calls),
    errors: Number(row.errors),
    promptTokens: Number(row.prompt_tokens),
    completionTokens: Number(row.completion_tokens),
    reasoningTokens: Number(row.reasoning_tokens),
    cachedTokens: Number(row.cached_tokens),
    totalTokens: Number(row.total_tokens),
    cost: Number(row.cost ?? 0),
    pricedCalls: Number(row.priced_calls),
  }
}

/** The SELECT list shared by every totals query, so they can't drift apart. */
const TOTALS_COLUMNS = `
  COUNT(*)::int AS calls,
  COUNT(*) FILTER (WHERE status <> 'ok')::int AS errors,
  COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
  COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
  COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
  COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(cost), 0) AS cost,
  COUNT(*) FILTER (WHERE cost IS NOT NULL)::int AS priced_calls`

/**
 * Everything the dashboard's top half needs, in one round trip per section.
 *
 * `days` bounds the window; `provider` scopes it (the dashboard is OpenRouter's,
 * but the ledger is not). Degrades to an empty summary rather than throwing, so
 * a database that hasn't run the migration still renders the settings page.
 */
export async function getInferenceSummary(
  provider: string,
  days: number
): Promise<InferenceSummary> {
  const windowDays = Math.min(365, Math.max(1, Math.round(days)))
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  const empty: InferenceSummary = {
    provider,
    days: windowDays,
    since,
    window: { ...EMPTY_TOTALS },
    today: { ...EMPTY_TOTALS },
    daily: [],
    byModel: [],
    byRole: [],
    byFeature: [],
    empty: true,
  }

  try {
    const windowFilter = `provider = $1 AND created_at >= NOW() - INTERVAL '${windowDays} days'`

    const [totals, todayTotals, daily, byModel, byRole, byFeature] = await Promise.all([
      query<TotalsRow>(`SELECT ${TOTALS_COLUMNS} FROM llm_inference_calls WHERE ${windowFilter}`, [
        provider,
      ]),
      query<TotalsRow>(
        `SELECT ${TOTALS_COLUMNS} FROM llm_inference_calls
         WHERE provider = $1 AND created_at >= date_trunc('day', NOW())`,
        [provider]
      ),
      query<{ day: string; calls: number; total_tokens: string | number; cost: string | number }>(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS calls,
                COALESCE(SUM(total_tokens), 0) AS total_tokens,
                COALESCE(SUM(cost), 0) AS cost
         FROM llm_inference_calls
         WHERE ${windowFilter}
         GROUP BY 1
         ORDER BY 1`,
        [provider]
      ),
      breakdown('model', windowFilter, provider),
      breakdown("COALESCE(role, 'unattributed')", windowFilter, provider),
      breakdown("COALESCE(feature, 'unattributed')", windowFilter, provider),
    ])

    const window = toTotals(totals.rows[0])

    return {
      ...empty,
      window,
      today: toTotals(todayTotals.rows[0]),
      daily: daily.rows.map((r) => ({
        day: r.day,
        calls: Number(r.calls),
        totalTokens: Number(r.total_tokens),
        cost: Number(r.cost),
      })),
      byModel: byModel,
      byRole: byRole,
      byFeature: byFeature,
      empty: window.calls === 0,
    }
  } catch (err) {
    logger.warn({ err, provider }, 'Failed to read inference summary; reporting empty')
    return empty
  }
}

/** Top 20 groups by spend, then by call count when nothing is priced. */
async function breakdown(
  expression: string,
  windowFilter: string,
  provider: string
): Promise<InferenceBreakdownRow[]> {
  const result = await query<{
    key: string
    calls: number
    total_tokens: string | number
    cost: string | number
  }>(
    `SELECT ${expression} AS key,
            COUNT(*)::int AS calls,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(cost), 0) AS cost
     FROM llm_inference_calls
     WHERE ${windowFilter}
     GROUP BY 1
     ORDER BY cost DESC, calls DESC
     LIMIT 20`,
    [provider]
  )

  return result.rows.map((r) => ({
    key: r.key,
    calls: Number(r.calls),
    totalTokens: Number(r.total_tokens),
    cost: Number(r.cost),
  }))
}

export interface InferenceCallRow {
  id: string
  createdAt: string
  model: string
  role: string | null
  feature: string | null
  sessionId: string | null
  username: string | null
  upstreamProvider: string | null
  status: string
  statusCode: number | null
  streamed: boolean
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cachedTokens: number
  totalTokens: number
  cost: number | null
  latencyMs: number | null
}

/** The most recent calls, newest first. Never throws. */
export async function getRecentInferenceCalls(
  provider: string,
  limit: number
): Promise<InferenceCallRow[]> {
  const capped = Math.min(200, Math.max(1, Math.round(limit)))

  try {
    const result = await query<{
      id: string
      created_at: Date
      model: string
      role: string | null
      feature: string | null
      session_id: string | null
      username: string | null
      upstream_provider: string | null
      status: string
      status_code: number | null
      streamed: boolean
      prompt_tokens: number
      completion_tokens: number
      reasoning_tokens: number
      cached_tokens: number
      total_tokens: number
      cost: string | null
      latency_ms: number | null
    }>(
      `SELECT c.id, c.created_at, c.model, c.role, c.feature, c.session_id,
              u.username, c.upstream_provider, c.status, c.status_code, c.streamed,
              c.prompt_tokens, c.completion_tokens, c.reasoning_tokens, c.cached_tokens,
              c.total_tokens, c.cost, c.latency_ms
       FROM llm_inference_calls c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.provider = $1
       ORDER BY c.created_at DESC
       LIMIT ${capped}`,
      [provider]
    )

    return result.rows.map((r) => ({
      id: String(r.id),
      createdAt: r.created_at.toISOString(),
      model: r.model,
      role: r.role,
      feature: r.feature,
      sessionId: r.session_id,
      username: r.username,
      upstreamProvider: r.upstream_provider,
      status: r.status,
      statusCode: r.status_code,
      streamed: r.streamed,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      reasoningTokens: r.reasoning_tokens,
      cachedTokens: r.cached_tokens,
      totalTokens: r.total_tokens,
      cost: r.cost == null ? null : Number(r.cost),
      latencyMs: r.latency_ms,
    }))
  } catch (err) {
    logger.warn({ err, provider }, 'Failed to read recent inference calls')
    return []
  }
}

export interface InferenceSessionRow {
  sessionId: string
  title: string | null
  username: string | null
  calls: number
  totalTokens: number
  cost: number
  startedAt: string
  lastCallAt: string
}

/**
 * Spend per assistant conversation — the "sessions" view. A chat turn can fan out
 * into intent routing, tool calls, discovery structuring and reason enrichment,
 * so the per-conversation total is the only honest answer to "what did that
 * conversation cost". Titles are joined in when the conversation still exists.
 */
export async function getInferenceSessions(
  provider: string,
  days: number,
  limit: number
): Promise<InferenceSessionRow[]> {
  const windowDays = Math.min(365, Math.max(1, Math.round(days)))
  const capped = Math.min(100, Math.max(1, Math.round(limit)))

  try {
    const result = await query<{
      session_id: string
      title: string | null
      username: string | null
      calls: number
      total_tokens: string | number
      cost: string | number
      started_at: Date
      last_call_at: Date
    }>(
      `SELECT c.session_id,
              MAX(conv.title) AS title,
              MAX(u.username) AS username,
              COUNT(*)::int AS calls,
              COALESCE(SUM(c.total_tokens), 0) AS total_tokens,
              COALESCE(SUM(c.cost), 0) AS cost,
              MIN(c.created_at) AS started_at,
              MAX(c.created_at) AS last_call_at
       FROM llm_inference_calls c
       LEFT JOIN assistant_conversations conv ON conv.id::text = c.session_id
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.provider = $1
         AND c.session_id IS NOT NULL
         AND c.created_at >= NOW() - INTERVAL '${windowDays} days'
       GROUP BY c.session_id
       ORDER BY last_call_at DESC
       LIMIT ${capped}`,
      [provider]
    )

    return result.rows.map((r) => ({
      sessionId: r.session_id,
      title: r.title,
      username: r.username,
      calls: Number(r.calls),
      totalTokens: Number(r.total_tokens),
      cost: Number(r.cost),
      startedAt: r.started_at.toISOString(),
      lastCallAt: r.last_call_at.toISOString(),
    }))
  } catch (err) {
    logger.warn({ err, provider }, 'Failed to read inference sessions')
    return []
  }
}
