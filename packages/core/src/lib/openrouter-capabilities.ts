/**
 * OpenRouter Model Capability Cache
 *
 * OpenRouter has no built-in models in our registry — every model is
 * user-entered. Rather than assuming what those models can do, this module
 * resolves real capabilities from OpenRouter's public model catalog
 * (https://openrouter.ai/api/v1/models), which reports each model's
 * supported_parameters (including "tools" for function calling), pricing
 * (USD per token), and context length.
 *
 * The catalog is cached in memory and in the database with a daily TTL,
 * mirroring the Helicone pricing cache. On fetch failure we fall back to
 * stale data, and callers fall back to the custom-model assumption when the
 * catalog is unavailable or doesn't know the model.
 */

import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { createChildLogger } from './logger.js'
import type { ModelCapabilities } from './ai-capabilities.js'
import { parseEndpointsResponse, pricePerMillion, type ServiceTierFacts } from './serviceTier.js'

const logger = createChildLogger('openrouter-capabilities')

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
// After a failed fetch, don't retry for a while so capability/status
// endpoints stay fast when the catalog is unreachable
const FETCH_FAILURE_RETRY_MS = 5 * 60 * 1000
const CACHE_KEY = 'openrouter_models_cache'
// Bump when CatalogModel gains fields so stale DB caches are refetched
const CACHE_VERSION = 3

interface CatalogModel {
  id: string
  // null = the catalog entry doesn't declare its parameters (unknown, not "none")
  supportedParameters: string[] | null
  /**
   * The reasoning-effort words THIS model accepts, verbatim from the catalog.
   *
   * null covers two cases the caller must treat identically — the entry
   * declares no `reasoning` object at all (124 of 418 models), or it reasons but
   * exposes no effort parameter (140 more, deepseek-r1 among them) — because
   * both mean "offer no effort control here".
   *
   * NOT a fixed vocabulary, which is the whole reason it is read rather than
   * declared. Measured across the live catalog: 21 distinct lists drawn from
   * seven words (none, minimal, low, medium, high, xhigh, max), and no model
   * offers all seven. Anthropic's take `max` and not `minimal`; OpenAI's take
   * `xhigh` and `none`; Google's take `minimal` and neither of those. A
   * hardcoded union is wrong in three directions at once — it offers words a
   * model rejects, hides words it accepts, and cannot grow.
   *
   * The three router pseudo-models (`openrouter/auto`, `/free`, `/auto-beta`)
   * declare `reasoning_effort` in supported_parameters and no reasoning object,
   * which is correct of them: they pick a real model per request, so their
   * vocabulary is not knowable in advance. They land on null and get no control,
   * which is the right answer rather than a gap.
   */
  supportedEfforts: string[] | null
  // USD per 1M tokens; null when the catalog has no parseable price
  inputCostPerMillion: number | null
  outputCostPerMillion: number | null
  contextLength: number | null
}

interface CachedCatalog {
  version: number
  fetchedAt: number
  models: CatalogModel[]
}

let memoryCache: CachedCatalog | null = null
let lastFailedFetchAt = 0

async function fetchCatalog(): Promise<CatalogModel[]> {
  logger.info('Fetching model catalog from OpenRouter API')

  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter models API returned ${response.status}: ${response.statusText}`)
  }

  const json = (await response.json()) as {
    data?: Array<{
      id?: string
      supported_parameters?: string[]
      context_length?: number
      pricing?: { prompt?: string; completion?: string }
      reasoning?: { supported_efforts?: string[] }
    }>
  }

  // An entry without supported_parameters is indistinguishable from
  // "supports nothing", so keep it as unknown (null) and let capability
  // callers fall back to assumptions while pricing still resolves
  const models = (json.data ?? [])
    .filter((m) => typeof m.id === 'string')
    .map((m) => ({
      id: m.id as string,
      supportedParameters: Array.isArray(m.supported_parameters) ? m.supported_parameters : null,
      // Kept exactly as written. Filtering to a known set here would silently
      // drop a word a model really accepts, the first time OpenRouter adds one.
      supportedEfforts: Array.isArray(m.reasoning?.supported_efforts)
        ? m.reasoning.supported_efforts.filter((e): e is string => typeof e === 'string')
        : null,
      inputCostPerMillion: pricePerMillion(m.pricing?.prompt),
      outputCostPerMillion: pricePerMillion(m.pricing?.completion),
      contextLength: typeof m.context_length === 'number' ? m.context_length : null,
    }))

  logger.info({ modelCount: models.length }, 'Fetched OpenRouter model catalog')
  return models
}

async function loadCacheFromDatabase(): Promise<CachedCatalog | null> {
  try {
    const cached = await getSystemSetting(CACHE_KEY)
    if (!cached) return null
    const parsed = JSON.parse(cached) as CachedCatalog
    // Older cache formats lack fields new callers rely on — refetch
    if (parsed.version !== CACHE_VERSION) return null
    return parsed
  } catch (err) {
    logger.warn({ err }, 'Failed to load OpenRouter catalog cache from database')
    return null
  }
}

async function saveCacheToDatabase(cache: CachedCatalog): Promise<void> {
  try {
    await setSystemSetting(
      CACHE_KEY,
      JSON.stringify(cache),
      'Cached OpenRouter model catalog (per-model supported parameters)'
    )
  } catch (err) {
    logger.warn({ err }, 'Failed to save OpenRouter catalog cache to database')
  }
}

function isCacheValid(cache: CachedCatalog): boolean {
  return Date.now() - cache.fetchedAt < CACHE_TTL_MS
}

async function getCatalog(): Promise<CatalogModel[] | null> {
  if (memoryCache && isCacheValid(memoryCache)) {
    return memoryCache.models
  }

  const dbCache = await loadCacheFromDatabase()
  if (dbCache && isCacheValid(dbCache)) {
    memoryCache = dbCache
    return dbCache.models
  }

  if (Date.now() - lastFailedFetchAt < FETCH_FAILURE_RETRY_MS) {
    return dbCache?.models ?? memoryCache?.models ?? null
  }

  try {
    const models = await fetchCatalog()
    const newCache: CachedCatalog = { version: CACHE_VERSION, fetchedAt: Date.now(), models }
    memoryCache = newCache
    await saveCacheToDatabase(newCache)
    return models
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch OpenRouter model catalog')
    lastFailedFetchAt = Date.now()

    // Stale data beats assumptions
    if (dbCache) {
      memoryCache = dbCache
      return dbCache.models
    }
    return null
  }
}

/**
 * Look up a model's real capabilities in the OpenRouter catalog.
 * Returns null when the catalog is unavailable or doesn't list the model —
 * callers should then fall back to the custom-model assumption.
 *
 * Not meaningful for embeddings: the catalog only covers language models.
 */
export async function getOpenRouterModelCapabilities(
  modelId: string
): Promise<ModelCapabilities | null> {
  const catalog = await getCatalog()
  if (!catalog) return null

  // Exact id first; variant suffixes (":free", ":extended") are distinct
  // catalog entries, but fall back to the base id if the variant is missing
  const baseId = modelId.split(':')[0]
  const entry = catalog.find((m) => m.id === modelId) ?? catalog.find((m) => m.id === baseId)
  if (!entry) return null

  const params = entry.supportedParameters
  if (!params) return null
  const supportsTools = params.includes('tools')

  return {
    supportsToolCalling: supportsTools,
    supportsToolStreaming: supportsTools,
    supportsObjectGeneration:
      params.includes('response_format') || params.includes('structured_outputs'),
    supportsEmbeddings: false,
  }
}

export interface OpenRouterModelInfo {
  /** USD per 1M tokens; null when the catalog has no published price */
  inputCostPerMillion: number | null
  outputCostPerMillion: number | null
  contextLength: number | null
  /**
   * The effort words this model accepts, or null for "offer no effort control".
   * See {@link CatalogModel.supportedEfforts} — this is data, not a type.
   */
  supportedEfforts: string[] | null
  /**
   * Every parameter this model accepts, as the catalogue's own wire names.
   *
   * Read by `generationParams.ts` to decide whether a sampling control exists
   * at all: measured on 439 live entries, 87 refuse `temperature` and 105
   * refuse `top_p`, so this is a real capability rather than a formality. Null
   * means the catalogue said nothing, which is offered as "no control" and
   * never as "anything goes".
   *
   * Already cached since CACHE_VERSION 3 — it is what answers "does this model
   * support tools" — so exposing it needs no fetch and no cache bump.
   */
  supportedParameters: string[] | null
}

/**
 * Look up a model's published pricing and context length in the catalog.
 * Exact id match only: variants (":free", ":extended") are priced differently
 * from their base model, so falling back to the base id would show the wrong
 * price. Returns null when the catalog is unavailable or misses the model.
 */
export async function getOpenRouterModelInfo(modelId: string): Promise<OpenRouterModelInfo | null> {
  const catalog = await getCatalog()
  if (!catalog) return null

  const entry = catalog.find((m) => m.id === modelId)
  if (!entry) return null

  return {
    inputCostPerMillion: entry.inputCostPerMillion,
    outputCostPerMillion: entry.outputCostPerMillion,
    contextLength: entry.contextLength,
    supportedEfforts: entry.supportedEfforts,
    supportedParameters: entry.supportedParameters,
  }
}

// ============================================================================
// Per-model endpoints: which service tiers a model is sold at
// ============================================================================

/**
 * Where the tier answer lives. Not in the catalogue above — `/api/v1/models`
 * carries no tier information at all — but in each model's endpoints listing,
 * where a tier endpoint is its own entry with a tier-suffixed `tag`. See
 * ./serviceTier.ts for the reading and the evidence.
 *
 * Unauthenticated, like the catalogue: only the throughput figures in it need a
 * key, and nothing here reads them.
 */
const endpointsUrl = (modelId: string) => `https://openrouter.ai/api/v1/models/${modelId}/endpoints`
const ENDPOINTS_CACHE_KEY = 'openrouter_endpoints_cache'
// Bump when TierEndpoint gains fields so stale DB caches are refetched
const ENDPOINTS_CACHE_VERSION = 1
// Entries not refreshed for this long are dropped at the next save.
const ENDPOINTS_PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000

/**
 * `author/slug` with an optional `:variant`. Anything else is not put into a URL
 * path at all: model ids are operator-typed, and a `?` or `#` in one would
 * address a different resource than the one being asked about.
 */
const MODEL_ID_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/

interface CachedEndpointsEntry {
  fetchedAt: number
  facts: ServiceTierFacts
}

interface CachedEndpoints {
  version: number
  entries: Record<string, CachedEndpointsEntry>
}

let endpointsCache: Map<string, CachedEndpointsEntry> | null = null
let endpointsCacheLoad: Promise<Map<string, CachedEndpointsEntry>> | null = null
const endpointFailureAt = new Map<string, number>()
const endpointsInFlight = new Map<string, Promise<ServiceTierFacts>>()

async function loadEndpointsCache(): Promise<Map<string, CachedEndpointsEntry>> {
  if (endpointsCache) return endpointsCache
  endpointsCacheLoad ??= (async () => {
    const map = new Map<string, CachedEndpointsEntry>()
    try {
      const raw = await getSystemSetting(ENDPOINTS_CACHE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as CachedEndpoints
        if (parsed.version === ENDPOINTS_CACHE_VERSION && parsed.entries) {
          for (const [id, entry] of Object.entries(parsed.entries)) map.set(id, entry)
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load OpenRouter endpoints cache from database')
    }
    endpointsCache = map
    return map
  })()
  return endpointsCacheLoad
}

/**
 * One write at a time, and a write that arrives during one is folded into a
 * second rather than racing it. The models route asks about every custom model
 * at once, so N lookups landing together would otherwise be N concurrent
 * writes of N slightly different snapshots, the last of which wins.
 */
let endpointsSave: Promise<void> | null = null
let endpointsSaveAgain = false

function persistEndpointsCache(): void {
  if (endpointsSave) {
    endpointsSaveAgain = true
    return
  }
  endpointsSave = (async () => {
    do {
      endpointsSaveAgain = false
      // A model nobody has asked about for a month is not in use — every model a
      // role or a picker reads is refetched daily — so it is dropped rather than
      // kept forever. Without this, every id ever typed into the add-model
      // dialog's Test, typos included, would live in system_settings for good.
      const cutoff = Date.now() - ENDPOINTS_PRUNE_AFTER_MS
      for (const [id, entry] of endpointsCache ?? []) {
        if (entry.fetchedAt < cutoff) endpointsCache?.delete(id)
      }
      const snapshot: CachedEndpoints = {
        version: ENDPOINTS_CACHE_VERSION,
        entries: Object.fromEntries(endpointsCache ?? []),
      }
      try {
        await setSystemSetting(
          ENDPOINTS_CACHE_KEY,
          JSON.stringify(snapshot),
          'Cached OpenRouter per-model endpoint listings (service tiers)'
        )
      } catch (err) {
        logger.warn({ err }, 'Failed to save OpenRouter endpoints cache to database')
      }
    } while (endpointsSaveAgain)
  })().finally(() => {
    endpointsSave = null
  })
}

async function fetchEndpointFacts(modelId: string): Promise<ServiceTierFacts> {
  const response = await fetch(endpointsUrl(modelId), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })

  // OpenRouter answered, and the answer is that it lists nothing under this id —
  // a mistyped model, or a variant id the listing does not take. That is a fact
  // ("no flex here"), not an outage, so it is cached like one.
  if (response.status === 404) return { endpoints: [] }

  if (!response.ok) {
    throw new Error(`OpenRouter endpoints API returned ${response.status}: ${response.statusText}`)
  }

  const facts = parseEndpointsResponse(await response.json())
  if (!facts) throw new Error('OpenRouter endpoints API returned an unexpected shape')
  return facts
}

/**
 * The endpoints OpenRouter lists for a model, with the tier each one serves.
 *
 * Returns null for UNKNOWN — the listing could not be read and no earlier copy
 * exists — which callers must keep apart from `{ endpoints: [] }` (OpenRouter
 * answered and lists nothing): the request builder sends a flex tier on the
 * first and not on the second, for the reason ./serviceTier.ts gives.
 *
 * Cached per model in memory and in the database for a day, like the catalogue,
 * with a stale copy preferred over unknown when a refetch fails. `fresh` skips
 * the cache for the connection test — a Test button that answers from a cache
 * cannot report that a model gained or lost a tier since yesterday.
 */
export async function getOpenRouterServiceTierFacts(
  modelId: string,
  options: { fresh?: boolean } = {}
): Promise<ServiceTierFacts | null> {
  const id = modelId.trim()
  if (!MODEL_ID_PATTERN.test(id)) return { endpoints: [] }

  const cache = await loadEndpointsCache()
  const cached = cache.get(id)

  if (!options.fresh) {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.facts
    // A recent failure keeps the picker fast while OpenRouter is unreachable.
    const failedAt = endpointFailureAt.get(id)
    if (failedAt != null && Date.now() - failedAt < FETCH_FAILURE_RETRY_MS) {
      return cached?.facts ?? null
    }
  }

  let pending = endpointsInFlight.get(id)
  if (!pending) {
    pending = fetchEndpointFacts(id)
    endpointsInFlight.set(id, pending)
    void pending.catch(() => undefined).finally(() => endpointsInFlight.delete(id))
  }

  try {
    const facts = await pending
    cache.set(id, { fetchedAt: Date.now(), facts })
    endpointFailureAt.delete(id)
    persistEndpointsCache()
    return facts
  } catch (err) {
    logger.warn({ err, model: id }, 'Failed to fetch OpenRouter endpoints for model')
    endpointFailureAt.set(id, Date.now())
    // Stale data beats unknown, exactly as it does for the catalogue.
    return cached?.facts ?? null
  }
}
