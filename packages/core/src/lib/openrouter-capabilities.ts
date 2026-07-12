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

const logger = createChildLogger('openrouter-capabilities')

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
// After a failed fetch, don't retry for a while so capability/status
// endpoints stay fast when the catalog is unreachable
const FETCH_FAILURE_RETRY_MS = 5 * 60 * 1000
const CACHE_KEY = 'openrouter_models_cache'
// Bump when CatalogModel gains fields so stale DB caches are refetched
const CACHE_VERSION = 2

interface CatalogModel {
  id: string
  // null = the catalog entry doesn't declare its parameters (unknown, not "none")
  supportedParameters: string[] | null
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

/** The catalog prices in USD per token (as strings); convert to USD per 1M */
function perTokenToPerMillion(perToken: string | undefined): number | null {
  if (perToken == null || perToken === '') return null
  const n = Number(perToken)
  if (!Number.isFinite(n) || n < 0) return null
  // Round away float noise (0.15000000000000002 → 0.15)
  return Math.round(n * 1_000_000 * 10_000) / 10_000
}

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
      inputCostPerMillion: perTokenToPerMillion(m.pricing?.prompt),
      outputCostPerMillion: perTokenToPerMillion(m.pricing?.completion),
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
  }
}
