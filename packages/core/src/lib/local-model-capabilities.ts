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

/**
 * A model as this app needs to see it, shaped like `GET /api/v0/models` — LM
 * Studio's own REST API, richer than the OpenAI-compatible `/v1/models`, which
 * returns bare ids and so cannot say what a model is FOR.
 * Verified against lmstudio.ai/docs/developer/rest/endpoints.
 *
 * Only `id` is guaranteed: `capabilities` arrived in 0.3.16, and every other
 * field is absent on a server that merely answers this path without being LM
 * Studio, or comes from the newer v1 API which does not publish it. Treat each
 * one as optional at the point of use.
 */
export interface LmStudioModel {
  /** What `/v1/chat/completions` and `/v1/embeddings` take as `model`. */
  id: string
  /** 'llm' | 'vlm' | 'embeddings' — what the model is for. */
  type?: string
  publisher?: string
  arch?: string
  /** 'gguf' | 'mlx' */
  compatibility_type?: string
  quantization?: string
  /** 'loaded' | 'not-loaded' — LM Studio loads on demand, so either is usable. */
  state?: string
  max_context_length?: number
  /** 0.3.16+. Absent means the version predates it, NOT that it can do nothing. */
  capabilities?: string[]
  /** v1 only: a human name, e.g. "Phi-2". Never sent anywhere. */
  displayName?: string
  /** v1 only: parameter count, e.g. "2.7B". */
  paramsString?: string
}

/**
 * One entry of `GET /api/v1/models`, the native REST API that LM Studio 0.4.0
 * released and recommends. This is the PRIMARY source.
 *
 * It renames nearly everything (`key`, `type: 'embedding'` singular,
 * `architecture`, a quantization object, `loaded_instances` in place of
 * `state`), which is why it is normalised into the v0 shape above rather than
 * given its own code path — the role filter and the capability reader stay one
 * pure implementation with one set of tests.
 *
 * Two things v0 has and v1 does not, which is why v0 is still read alongside it
 * (see {@link enrichFromV0}): `capabilities`, the only published source of
 * `tool_use`, and a context length for a model that is downloaded but not
 * loaded — v1 carries that only on a running instance.
 */
interface LmStudioV1Model {
  key: string
  /** 'llm' | 'embedding' — note the singular, unlike v0's 'embeddings'. */
  type?: string
  publisher?: string
  display_name?: string
  architecture?: string | null
  quantization?: { name?: string | null; bits_per_weight?: number | null } | null
  size_bytes?: number
  params_string?: string | null
  loaded_instances?: { id?: string; config?: { context_length?: number } }[]
}

/**
 * Bring a v1 entry into the v0-shaped record above. Pure, and pinned, because
 * every field here is renamed and one of them — `type` — differs by a single
 * letter that decides whether a model is offered for embeddings or for chat.
 */
export function normalizeLmStudioV1Model(entry: LmStudioV1Model): LmStudioModel {
  const loaded = entry.loaded_instances ?? []
  const context = loaded[0]?.config?.context_length

  return {
    id: entry.key,
    // v0's vocabulary is what the rest of the code reads. 'embedding' →
    // 'embeddings' is the whole of the mapping that matters; anything else
    // passes through, so an unknown future type is treated as a language model
    // rather than silently becoming an embedding one.
    type: entry.type === 'embedding' ? 'embeddings' : entry.type,
    ...(entry.publisher != null && { publisher: entry.publisher }),
    ...(entry.architecture != null && { arch: entry.architecture }),
    ...(entry.quantization?.name != null && { quantization: entry.quantization.name }),
    // v1 replaces v0's `state` with a list of running instances. An empty list
    // is 'not-loaded', which is still perfectly usable — LM Studio loads on
    // demand — so this only decides which row gets the "loaded" chip.
    state: loaded.length > 0 ? 'loaded' : 'not-loaded',
    // Deliberately absent when nothing is loaded, rather than 0: this is the
    // model's context window, and "we don't know" is not "zero tokens".
    ...(context != null && { max_context_length: context }),
    ...(entry.display_name != null && { displayName: entry.display_name }),
    ...(entry.params_string != null && { paramsString: entry.params_string }),
    // No `capabilities`: v1 does not publish tool support. Left absent so the
    // role filter reads it as unknown rather than as "cannot call tools".
  }
}

/**
 * LM Studio can be configured to require a bearer token. Sending one it did not
 * ask for is harmless, so the key rides along whenever the operator has entered
 * it — the alternative is a probe that fails with 401 on a locked-down server
 * while the actual inference calls, which do send it, work perfectly.
 */
function authHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

/** `GET /api/v0/models` — the enhanced sibling of the OpenAI-compatible list. */
async function fetchV0Models(base: string, apiKey?: string): Promise<LmStudioModel[] | null> {
  const response = await fetch(`${base}/api/v0/models`, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  if (!response.ok) return null

  const json = (await response.json()) as { data?: LmStudioModel[] }
  if (!Array.isArray(json.data)) return null

  return json.data.filter((m) => typeof m.id === 'string')
}

/** `GET /api/v1/models` — the newer REST API, normalised into the v0 shape. */
async function fetchV1Models(base: string, apiKey?: string): Promise<LmStudioModel[] | null> {
  const response = await fetch(`${base}/api/v1/models`, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  if (!response.ok) return null

  const json = (await response.json()) as { models?: LmStudioV1Model[] }
  if (!Array.isArray(json.models)) return null

  return json.models
    .filter((m) => typeof m.key === 'string')
    .map(normalizeLmStudioV1Model)
}

/**
 * Fill in what v1 does not publish, from the v0 listing of the same server.
 *
 * Only two fields, and only one of them matters much: `capabilities` is the
 * sole published source of `tool_use`, which is what the Chat role filters on.
 * Without it every model reads as "unknown", which is offered rather than
 * withheld — safe, but it stops the filter doing its job.
 *
 * Matched on an EXACT id. The two APIs need not spell a model the same way, and
 * a fuzzy match would attach one model's tool support to another; an unmatched
 * entry simply keeps v1's answer, which is the "unknown" branch. Pure.
 */
export function enrichFromV0(
  v1Models: LmStudioModel[],
  v0Models: LmStudioModel[]
): LmStudioModel[] {
  const byId = new Map(v0Models.map((m) => [m.id, m]))

  return v1Models.map((model) => {
    const v0 = byId.get(model.id)
    if (!v0) return model

    return {
      ...model,
      ...(v0.capabilities != null && { capabilities: v0.capabilities }),
      // v1 reports a context length only for a loaded model, so this fills the
      // gap for a downloaded one. v1 wins when it has an answer: that figure
      // describes the instance actually running.
      ...(model.max_context_length == null &&
        v0.max_context_length != null && { max_context_length: v0.max_context_length }),
      ...(v0.compatibility_type != null && { compatibility_type: v0.compatibility_type }),
    }
  })
}

/**
 * Read LM Studio's installed models, across both generations of its REST API.
 *
 * **v1 first**: LM Studio 0.4.0 released the native `/api/v1/*` API and
 * recommends it, and v0 is now the previous one. v0 is then read too, purely to
 * fill in `capabilities` — v1 does not publish tool support, and that is the
 * signal the Chat role filters on. When v1 is absent (an older LM Studio), v0
 * answers alone.
 *
 * A model id from either API is handed straight to `/v1/chat/completions` or
 * `/v1/embeddings` as `model`. Nothing here can prove those spellings agree, so
 * the safety net is procedural rather than structural: the dialog will not
 * enable Add until the model has been tested, and a wrong id fails that test
 * loudly instead of being saved and failing later.
 */
async function getLmStudioModelList(
  base: string,
  apiKey?: string,
  refresh = false
): Promise<LmStudioModel[] | null> {
  const cacheKey = `lmstudio:${base}:${apiKey ?? ''}`
  if (!refresh) {
    const cached = getCached<LmStudioModel[] | null>(cacheKey)
    if (cached !== undefined) return cached
  }

  const attempt = async (
    label: string,
    fetchModels: (base: string, apiKey?: string) => Promise<LmStudioModel[] | null>
  ): Promise<LmStudioModel[] | null> => {
    try {
      return await fetchModels(base, apiKey)
    } catch (err) {
      logger.debug(
        { err, base, api: label },
        'LM Studio model list probe failed (server may not be LM Studio)'
      )
      return null
    }
  }

  const v1 = await attempt('v1', fetchV1Models)
  let result: LmStudioModel[] | null

  if (v1) {
    // Best effort only: an LM Studio that has retired v0 still discovers fine,
    // it just cannot say which of its models call tools.
    const v0 = await attempt('v0', fetchV0Models)
    result = v0 ? enrichFromV0(v1, v0) : v1
  } else {
    result = await attempt('v0', fetchV0Models)
  }

  setCached(cacheKey, result)
  return result
}

/**
 * Every model LM Studio has downloaded, loaded or not.
 *
 * Returns null when the server is unreachable or is not LM Studio, which the
 * caller must present as "could not read the catalog" rather than as an empty
 * one — "no models installed" and "wrong address" look identical in a list and
 * mean opposite things.
 *
 * `refresh` skips the cache on the way in but still fills it on the way out.
 * The cache is there for the per-model capability probe, which runs on every
 * models fetch; a person who has just downloaded a model in LM Studio and
 * pressed Refresh is asking a different question, and answering it from a
 * two-minute-old copy is the one thing that button must not do.
 */
export async function listLmStudioModels(
  baseUrl?: string,
  apiKey?: string,
  refresh = false
): Promise<LmStudioModel[] | null> {
  const base = stripSuffix(baseUrl ?? DEFAULT_LMSTUDIO_BASE_URL, '/v1')
  return getLmStudioModelList(base, apiKey, refresh)
}

/**
 * Ask LM Studio's native REST API what a model can do.
 * Returns null when the server isn't LM Studio, the model isn't downloaded,
 * or the LM Studio version predates the capabilities field (0.3.16) —
 * callers should then fall back to the custom-model assumption.
 */
export async function getLmStudioModelCapabilities(
  modelId: string,
  baseUrl?: string,
  apiKey?: string
): Promise<ModelCapabilities | null> {
  const models = await listLmStudioModels(baseUrl, apiKey)
  if (!models) return null

  const entry = models.find((m) => m.id === modelId)
  if (!entry) return null

  return lmStudioCapabilities(entry)
}

/**
 * Read one catalog entry's capabilities. Pure, so the discovery mapping and the
 * per-model probe cannot disagree about what a downloaded model can do.
 *
 * Returns null for a language model on a pre-0.3.16 server, where the answer is
 * genuinely unknown and the caller falls back to the custom-model assumption.
 */
export function lmStudioCapabilities(entry: LmStudioModel): ModelCapabilities | null {
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
