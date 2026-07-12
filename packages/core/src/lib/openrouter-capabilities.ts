/**
 * OpenRouter Model Capability Cache
 *
 * OpenRouter has no built-in models in our registry — every model is
 * user-entered. Rather than assuming what those models can do, this module
 * resolves real capabilities from OpenRouter's public model catalog
 * (https://openrouter.ai/api/v1/models), which reports each model's
 * supported_parameters (including "tools" for function calling).
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

interface CatalogModel {
  id: string
  supportedParameters: string[]
}

interface CachedCatalog {
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
    data?: Array<{ id?: string; supported_parameters?: string[] }>
  }

  // Keep only entries that actually declare their parameters — an entry
  // without them is indistinguishable from "supports nothing", so treat it
  // as unknown and let callers fall back to assumptions
  const models = (json.data ?? [])
    .filter((m) => typeof m.id === 'string' && Array.isArray(m.supported_parameters))
    .map((m) => ({ id: m.id as string, supportedParameters: m.supported_parameters as string[] }))

  logger.info({ modelCount: models.length }, 'Fetched OpenRouter model catalog')
  return models
}

async function loadCacheFromDatabase(): Promise<CachedCatalog | null> {
  try {
    const cached = await getSystemSetting(CACHE_KEY)
    if (!cached) return null
    return JSON.parse(cached) as CachedCatalog
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
    const newCache: CachedCatalog = { fetchedAt: Date.now(), models }
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
  const supportsTools = params.includes('tools')

  return {
    supportsToolCalling: supportsTools,
    supportsToolStreaming: supportsTools,
    supportsObjectGeneration:
      params.includes('response_format') || params.includes('structured_outputs'),
    supportsEmbeddings: false,
  }
}
