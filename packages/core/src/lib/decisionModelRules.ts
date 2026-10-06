/**
 * The pure half of the decision-model integration: its settings, where a call
 * goes, and how an answer is read. No runtime imports, so the rules can be
 * pinned by a test without a database or a key.
 *
 * WHAT A DECISION MODEL IS. A "System One" model (TypeSafe's Jev, and the
 * open-weight models that copy its contract — Kev, Clef, Mercury Decide,
 * Liquid D1) does not generate text. It takes application state plus named,
 * typed questions and returns a probability per question. This app asks it one
 * kind of question, a `noul` (yes/no), whose answer arrives as
 *
 *   { "type": "noul", "noul": 0.93 }
 *
 * WHY IT IS AN INTEGRATION AND NOT AN AI ROLE. Roles are text-generation slots
 * wired through the AI SDK, a JSON-Schema enum on ten routes, and the spend
 * dashboard's role list (F-002). This is a different API with a different
 * response, consumed by exactly one feature, and it is OPTIONAL: nothing in the
 * app depends on it being configured. A role would make it look load-bearing.
 *
 * ONE CONTRACT, TWO PLACES TO SEND IT. OpenRouter serves the catalog at
 * `/api/v1/systemone`; a self-hosted server (Ollaya, Kev's own `serve`) speaks
 * the same TypeSafe-compatible contract at `<root>/v1/systemone`. So moving
 * from the hosted trial to a local model is a settings change, not a code one.
 */

/** Where the request goes. */
export const DECISION_MODEL_SOURCES = ['openrouter', 'custom'] as const
export type DecisionModelSource = (typeof DECISION_MODEL_SOURCES)[number]

export function isDecisionModelSource(value: unknown): value is DecisionModelSource {
  return typeof value === 'string' && (DECISION_MODEL_SOURCES as readonly string[]).includes(value)
}

export interface DecisionModelConfig {
  /** Off by default. Nothing reads a verdict that was never written. */
  enabled: boolean
  /**
   * ALSO use it to weed the title-analysis retrieval (analysis/judgeSources.ts).
   *
   * ITS OWN SWITCH, UNDER `enabled`, because the two consumers are not one
   * decision. The evidence heading asks a few dozen questions per
   * recommendation run; this asks one per retrieved document per title, over a
   * library that can be five figures, and an operator who wants the cheap one
   * must not be signed up for the expensive one by turning the integration on.
   *
   * Absent reads as OFF, which is what every config stored before this field
   * existed means and what the pre-feature behaviour was.
   */
  filterAnalysisSources: boolean
  source: DecisionModelSource
  /**
   * The model id as the endpoint names it. A VERSIONED id, never an alias:
   * `~typesafe/jev-latest` moves under stored verdicts, and two runs judged by
   * different models would then read as one population.
   */
  model: string
  /**
   * Server root for `custom`, e.g. `http://host.docker.internal:11435`. Ignored
   * for `openrouter`, whose address is fixed. `/v1` or `/v1/systemone` pasted
   * on the end is tolerated — see {@link systemOneUrl}.
   */
  baseUrl: string
  /** Optional bearer for `custom`. OpenRouter reuses the AI page's key. */
  apiKey: string
  /** Per request. A judgment is one short call; a slow one is a stuck one. */
  timeoutMs: number
  /** Picks judged at once. A run has a few dozen at most. */
  concurrency: number
}

export const DECISION_MODEL_DEFAULT_MODEL = 'typesafe/jev-1.13'

export const DEFAULT_DECISION_MODEL_CONFIG: DecisionModelConfig = {
  enabled: false,
  filterAnalysisSources: false,
  source: 'openrouter',
  model: DECISION_MODEL_DEFAULT_MODEL,
  baseUrl: '',
  apiKey: '',
  timeoutMs: 20_000,
  concurrency: 4,
}

export const DECISION_TIMEOUT_MIN_MS = 2_000
export const DECISION_TIMEOUT_MAX_MS = 120_000
export const DECISION_CONCURRENCY_MIN = 1
export const DECISION_CONCURRENCY_MAX = 16

/** OpenRouter's System One endpoint. Fixed: a base URL setting there is a trap. */
export const OPENROUTER_SYSTEMONE_URL = 'https://openrouter.ai/api/v1/systemone'

/**
 * OpenRouter's decision catalog. The plain `/api/v1/models` lists text models
 * only — the same trap embeddings hit (F-096) — so the modality is required.
 */
export const OPENROUTER_DECISION_MODELS_URL =
  'https://openrouter.ai/api/v1/models?output_modalities=decisions'

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * A stored blob, made whole. Absent fields take their defaults, so a config
 * written before a field existed still reads as a complete one; absent
 * `enabled` reads as OFF, which is the pre-feature behaviour.
 *
 * Absence is checked BEFORE coercion: `Number(null)` is 0 and finite, so a
 * missing knob would otherwise clamp to its minimum instead of its default.
 */
export function sanitizeDecisionModelConfig(
  raw: Partial<DecisionModelConfig> | null | undefined
): DecisionModelConfig {
  const input = raw ?? {}
  const d = DEFAULT_DECISION_MODEL_CONFIG
  const model = typeof input.model === 'string' ? input.model.trim() : ''
  return {
    enabled: input.enabled === true,
    filterAnalysisSources: input.filterAnalysisSources === true,
    source: isDecisionModelSource(input.source) ? input.source : d.source,
    model: model || d.model,
    baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '',
    apiKey: typeof input.apiKey === 'string' ? input.apiKey.trim() : '',
    timeoutMs:
      input.timeoutMs == null
        ? d.timeoutMs
        : clampInt(input.timeoutMs, DECISION_TIMEOUT_MIN_MS, DECISION_TIMEOUT_MAX_MS, d.timeoutMs),
    concurrency:
      input.concurrency == null
        ? d.concurrency
        : clampInt(
            input.concurrency,
            DECISION_CONCURRENCY_MIN,
            DECISION_CONCURRENCY_MAX,
            d.concurrency
          ),
  }
}

/**
 * The System One URL for a self-hosted server root.
 *
 * Accepts the root, `<root>/v1`, or the full `<root>/v1/systemone`, because
 * which of those an operator pastes depends on which README they read last —
 * and a doubled path 404s, which reads exactly like a server that is not there.
 * Returns null for anything that is not an http(s) URL.
 */
export function systemOneUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  const root = trimmed
    .replace(/\/+$/, '')
    .replace(/\/systemone$/i, '')
    .replace(/\/v1$/i, '')
  return `${root}/v1/systemone`
}

/** The models list beside a self-hosted server's System One endpoint. */
export function modelsUrlFor(baseUrl: string): string | null {
  const url = systemOneUrl(baseUrl)
  return url ? url.replace(/\/systemone$/, '/models') : null
}

/** A yes/no question. The only kind this app asks. */
export interface SystemOneQuestion {
  type: 'noul'
  instructions: string
  /** Optional per TypeSafe: what counts as true and as false, when the line is subtle. */
  criteria?: { true: string; false: string }
}

/** The request body for `/v1/systemone`. */
export interface SystemOneCall {
  model: string
  state: Record<string, unknown>
  questions: Record<string, SystemOneQuestion>
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Read a `noul` answer: the probability of yes, or null.
 *
 * Null for anything that is not a number in [0, 1] — a missing key, an answer
 * of another type, a string. A malformed answer is NOT a "no": treating it as
 * 0 would quietly flip a pick's heading to the hedged one on a parse fault.
 */
export function readNoul(answer: unknown): number | null {
  if (!answer || typeof answer !== 'object') return null
  const a = answer as Record<string, unknown>
  if (a.type !== undefined && a.type !== 'noul') return null
  const value = finite(a.noul)
  if (value === undefined || value < 0 || value > 1) return null
  return value
}

/** What a response said about its own cost. Every field optional — see usageFetch. */
export interface SystemOneUsage {
  promptTokens?: number
  completionTokens?: number
  cost?: number
  generationId?: string
  upstreamProvider?: string
}

/**
 * Read the usage block of a System One response.
 *
 * The documented shape is `usage: { input_tokens, output_tokens }`, which is
 * NOT the OpenAI spelling the shared reader expects — so a naive reuse records
 * zero tokens on every call. OpenRouter adds `usage.cost` (output is free, so
 * cost is input only), plus `id` and `provider` at the top level.
 */
export function readSystemOneUsage(chunk: Record<string, unknown>, into: SystemOneUsage): void {
  if (typeof chunk.id === 'string' && chunk.id) into.generationId = chunk.id
  if (typeof chunk.provider === 'string' && chunk.provider) into.upstreamProvider = chunk.provider

  const usage = chunk.usage as Record<string, unknown> | undefined
  if (!usage || typeof usage !== 'object') return
  into.promptTokens =
    finite(usage.input_tokens) ?? finite(usage.prompt_tokens) ?? into.promptTokens
  into.completionTokens =
    finite(usage.output_tokens) ?? finite(usage.completion_tokens) ?? into.completionTokens
  into.cost = finite(usage.cost) ?? into.cost
}

/**
 * Whether a failed call says something about the CONFIGURATION rather than
 * about this one request. Such a failure will repeat for every pick, so the
 * run stops asking instead of paying a timeout per pick to learn it again.
 *
 * 400 and 422 are deliberately NOT here: they also mean "this one state was too
 * long for the model's context", which is a fact about one pick. A wrong model
 * id answers 400 too, and the consecutive-failure limit catches that instead.
 */
export function isSystemicDecisionFailure(status: number | undefined): boolean {
  return status === 401 || status === 402 || status === 403 || status === 404
}

/** Worth one more try: rate limited, overloaded, or a server hiccup. */
export function isRetryableDecisionFailure(status: number | undefined): boolean {
  return status === 429 || status === 529 || (status !== undefined && status >= 500)
}
