/**
 * Local Model Capability Probes
 *
 * Local inference servers can report real per-model capabilities:
 * - Ollama: POST /api/show returns a `capabilities` array ("completion",
 *   "tools", "embedding", ...) on recent versions.
 * - LM Studio: its native REST API (GET /api/v0/models) lists each model
 *   with a `type` and, since 0.3.16, a `capabilities` array ("tool_use").
 *   The openai-compatible provider might be LM Studio (it's the default
 *   base URL), so we probe that API and fall through harmlessly when the
 *   server is something else (vLLM, llama.cpp, ...).
 *
 * Probes are cheap metadata requests against localhost-class servers.
 * Results — including failures — are cached briefly so capability/status
 * endpoints stay fast, while still tracking models being loaded/unloaded.
 */

import { createChildLogger } from './logger.js'
import type { ModelCapabilities } from './ai-capabilities.js'

const logger = createChildLogger('local-model-capabilities')

const PROBE_TIMEOUT_MS = 3000
const CACHE_TTL_MS = 2 * 60 * 1000

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'
const DEFAULT_LMSTUDIO_BASE_URL = 'http://localhost:1234/v1'

// undefined = not cached; null = cached "unknown" (probe failed / no data)
const cache = new Map<string, { at: number; value: unknown }>()

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return entry.value as T
}

function setCached(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value })
}

/** Trim trailing slashes and a trailing path suffix like "/api" or "/v1" */
function stripSuffix(url: string, suffix: string): string {
  const trimmed = url.replace(/\/+$/, '')
  return trimmed.toLowerCase().endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed
}

// ============================================================================
// Ollama
// ============================================================================

/**
 * Ask Ollama what a model can do via its show endpoint.
 * Returns null when the server is unreachable, the model isn't pulled, or
 * the Ollama version predates the capabilities field — callers should then
 * fall back to the custom-model assumption.
 */
export async function getOllamaModelCapabilities(
  modelId: string,
  baseUrl?: string
): Promise<ModelCapabilities | null> {
  const base = stripSuffix(baseUrl ?? DEFAULT_OLLAMA_BASE_URL, '/api')
  const cacheKey = `ollama:${base}:${modelId}`
  const cached = getCached<ModelCapabilities | null>(cacheKey)
  if (cached !== undefined) return cached

  let result: ModelCapabilities | null = null
  try {
    const response = await fetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (response.ok) {
      const json = (await response.json()) as { capabilities?: string[] }
      // Older Ollama versions don't report capabilities — leave unknown
      if (Array.isArray(json.capabilities)) {
        const caps = json.capabilities
        result = {
          supportsToolCalling: caps.includes('tools'),
          supportsToolStreaming: caps.includes('tools'),
          supportsObjectGeneration: caps.includes('completion'),
          supportsEmbeddings: caps.includes('embedding'),
        }
      }
    }
  } catch (err) {
    logger.debug({ err, base, model: modelId }, 'Ollama capability probe failed')
  }

  setCached(cacheKey, result)
  return result
}

// ============================================================================
// LM Studio
// ============================================================================

interface LmStudioModel {
  id: string
  type?: string // 'llm' | 'vlm' | 'embeddings'
  capabilities?: string[]
}

async function getLmStudioModelList(base: string): Promise<LmStudioModel[] | null> {
  const cacheKey = `lmstudio:${base}`
  const cached = getCached<LmStudioModel[] | null>(cacheKey)
  if (cached !== undefined) return cached

  let result: LmStudioModel[] | null = null
  try {
    const response = await fetch(`${base}/api/v0/models`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (response.ok) {
      const json = (await response.json()) as { data?: LmStudioModel[] }
      if (Array.isArray(json.data)) {
        result = json.data.filter((m) => typeof m.id === 'string')
      }
    }
  } catch (err) {
    logger.debug({ err, base }, 'LM Studio capability probe failed (server may not be LM Studio)')
  }

  setCached(cacheKey, result)
  return result
}

/**
 * Ask LM Studio's native REST API what a model can do.
 * Returns null when the server isn't LM Studio, the model isn't downloaded,
 * or the LM Studio version predates the capabilities field (0.3.16) —
 * callers should then fall back to the custom-model assumption.
 */
export async function getLmStudioModelCapabilities(
  modelId: string,
  baseUrl?: string
): Promise<ModelCapabilities | null> {
  const base = stripSuffix(baseUrl ?? DEFAULT_LMSTUDIO_BASE_URL, '/v1')
  const models = await getLmStudioModelList(base)
  if (!models) return null

  const entry = models.find((m) => m.id === modelId)
  if (!entry) return null

  // Embedding models are typed explicitly and carry no capability list
  if (entry.type === 'embeddings') {
    return {
      supportsToolCalling: false,
      supportsToolStreaming: false,
      supportsObjectGeneration: false,
      supportsEmbeddings: true,
    }
  }

  if (!Array.isArray(entry.capabilities)) return null

  const supportsTools = entry.capabilities.includes('tool_use')
  return {
    supportsToolCalling: supportsTools,
    supportsToolStreaming: supportsTools,
    supportsObjectGeneration: true,
    supportsEmbeddings: false,
  }
}
