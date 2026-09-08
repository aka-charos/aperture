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
/** Loading a large model off a cold disk is minutes, not seconds. */
const LOAD_TIMEOUT_MS = 10 * 60 * 1000

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
 * The base URL to send OpenAI-shaped inference to, from whatever the operator
 * typed.
 *
 * LM Studio serves its native API under `/api/…` and its OpenAI-compatible one
 * under `/v1/…`, off the same host and port. Discovery reaches the first by
 * stripping any `/v1` suffix, so it works whether or not the operator included
 * one — but inference appends `/chat/completions` to this value verbatim, so it
 * *requires* the suffix. That asymmetry meant a base URL of
 * `http://localhost:1234` listed every installed model perfectly and then
 * failed every test against `/chat/completions`, which LM Studio does not
 * serve. A dialog that discovers correctly and tests incorrectly points the
 * blame at the model.
 *
 * Only ever appends, and only when absent, so a URL that already works is
 * returned unchanged. Applied to `lmstudio` alone: a generic OpenAI-compatible
 * server may legitimately live at any path, and rewriting it would break
 * setups that work today.
 */
export function lmStudioInferenceBaseUrl(baseUrl?: string): string {
  const trimmed = (baseUrl ?? DEFAULT_LMSTUDIO_BASE_URL).replace(/\/+$/, '')
  if (trimmed.length === 0) return DEFAULT_LMSTUDIO_BASE_URL
  return trimmed.toLowerCase().endsWith('/v1') ? trimmed : `${trimmed}/v1`
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

// ============================================================================
// LM Studio: server status and model loading
// ============================================================================

/**
 * Why a request to the server did not arrive.
 *
 * A connection failure carries its reason in `error.cause.code`, and for this
 * integration that code IS the diagnosis: `ENOTFOUND host.docker.internal` says
 * the container cannot resolve the host, `ECONNREFUSED` says nothing is
 * listening on that port, `ETIMEDOUT` says a firewall ate it. Collapsing all
 * three into "could not connect" throws away the only sentence that tells an
 * operator what to change — which matters most here, because Aperture in Docker
 * reaching LM Studio on the host is the normal deployment and every one of
 * those failures has a different fix.
 */
function describeFetchFailure(err: unknown): string {
  const cause = (err as { cause?: { code?: string } })?.cause
  const code = cause?.code
  const message = err instanceof Error ? err.message : String(err)

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Host not found (${code}). From a container, the host machine is usually host.docker.internal.`
    case 'ECONNREFUSED':
      return `Connection refused (${code}). Nothing is listening there — check LM Studio's server is started and on this port.`
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `Timed out reaching the server (${code}). A firewall between the container and the host does this.`
    case 'ECONNRESET':
      return `Connection reset (${code}).`
    default:
      return code ? `${message} (${code})` : message
  }
}

/** What one loaded instance of a model is running with. */
export interface LmStudioLoadedInstance {
  modelId: string
  contextLength?: number
}

/**
 * The state of an LM Studio server, as a *test* rather than a ping.
 *
 * Reachability alone answers almost nothing. The failures this integration
 * actually produces are a wrong port, a container that cannot resolve the host,
 * a server with nothing installed, and a role pointed at a server holding no
 * model of the right type. Every one of those is invisible to a yes/no
 * connection check and obvious from the catalog.
 */
export interface LmStudioServerStatus {
  reachable: boolean
  /** Which generation of the REST API answered, so an old server is visible. */
  api?: 'v1' | 'v0'
  /** Everything installed, whatever its type. */
  totalModels: number
  languageModels: number
  embeddingModels: number
  /** Models in memory now. Empty is normal — LM Studio loads on demand. */
  loaded: LmStudioLoadedInstance[]
  /** Why it could not be reached, in the operator's terms. */
  error?: string
}

async function probeApi(
  base: string,
  path: string,
  apiKey: string | undefined
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${base}${path}`, {
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) {
      // A token problem reads nothing like a 404, which means this server does
      // not serve LM Studio's API at all.
      const detail =
        response.status === 401 || response.status === 403
          ? 'the server requires an API token — enter it above'
          : `HTTP ${response.status}`
      return { ok: false, error: `${path} answered ${detail}` }
    }
    return { ok: true, json: await response.json() }
  } catch (err) {
    return { ok: false, error: describeFetchFailure(err) }
  }
}

/**
 * Test a server the way somebody debugging it would: reach it, say which API
 * answered, and report what it actually holds.
 *
 * Tries v1 then v0, so a success names the generation rather than merely
 * succeeding. When neither answers, the v1 failure is the one reported — it is
 * the recommended API, so its error describes the server as it ought to be.
 */
export async function probeLmStudioServer(
  baseUrl?: string,
  apiKey?: string
): Promise<LmStudioServerStatus> {
  const base = stripSuffix(baseUrl ?? DEFAULT_LMSTUDIO_BASE_URL, '/v1')

  const v1 = await probeApi(base, '/api/v1/models', apiKey)
  if (v1.ok) {
    const raw = (v1.json as { models?: LmStudioV1Model[] })?.models
    const entries = (Array.isArray(raw) ? raw : []).filter((m) => typeof m?.key === 'string')
    const normalized = entries.map(normalizeLmStudioV1Model)
    return {
      reachable: true,
      api: 'v1',
      totalModels: normalized.length,
      languageModels: normalized.filter((m) => m.type !== 'embeddings').length,
      embeddingModels: normalized.filter((m) => m.type === 'embeddings').length,
      loaded: entries
        .filter((m) => (m.loaded_instances?.length ?? 0) > 0)
        .map((m) => {
          const context = m.loaded_instances?.[0]?.config?.context_length
          return {
            modelId: m.key,
            ...(context != null && { contextLength: context }),
          }
        }),
    }
  }

  const v0 = await probeApi(base, '/api/v0/models', apiKey)
  if (v0.ok) {
    const raw = (v0.json as { data?: LmStudioModel[] })?.data
    const models = (Array.isArray(raw) ? raw : []).filter((m) => typeof m?.id === 'string')
    return {
      reachable: true,
      api: 'v0',
      totalModels: models.length,
      languageModels: models.filter((m) => m.type !== 'embeddings').length,
      embeddingModels: models.filter((m) => m.type === 'embeddings').length,
      loaded: models
        .filter((m) => m.state === 'loaded')
        .map((m) => ({
          modelId: m.id,
          ...(m.max_context_length != null && { contextLength: m.max_context_length }),
        })),
    }
  }

  return {
    reachable: false,
    totalModels: 0,
    languageModels: 0,
    embeddingModels: 0,
    loaded: [],
    error: v1.error,
  }
}

/**
 * Options `POST /api/v1/models/load` accepts.
 *
 * `contextLength` is the one that changes outcomes rather than speed: a model
 * loaded at LM Studio's default context truncates a long prompt, and this app
 * sends some long ones — a title analysis runs to ~69,000 characters of
 * retrieved sources. The rest are performance knobs, passed only when set, so
 * an unspecified field leaves LM Studio's own default alone.
 */
export interface LmStudioLoadOptions {
  contextLength?: number
  flashAttention?: boolean
  evalBatchSize?: number
  numExperts?: number
  offloadKvCacheToGpu?: boolean
}

export interface LmStudioLoadResult {
  ok: boolean
  /** What LM Studio says it loaded with, when it echoes the config back. */
  loadConfig?: Record<string, unknown>
  error?: string
}

/**
 * Load a model into memory, with the configuration it should run under.
 *
 * Deliberately an explicit action rather than something that happens on every
 * call. LM Studio loads on demand already, and a model loaded THIS way is not a
 * JIT model — it is exempt from Auto-Evict and outlives the idle TTL, which is
 * what somebody wants from a button labelled Load and is not what they want as
 * a side effect of a batch job. Unloading is deliberately not offered for the
 * matching reason: it must never take away a model somebody else is using, and
 * nothing here can tell whose it is.
 *
 * Loading is slow — a large model off a cold disk is minutes — so it gets its
 * own generous timeout rather than the catalog probe's three seconds.
 */
export async function loadLmStudioModel(
  modelId: string,
  baseUrl?: string,
  apiKey?: string,
  options: LmStudioLoadOptions = {}
): Promise<LmStudioLoadResult> {
  const base = stripSuffix(baseUrl ?? DEFAULT_LMSTUDIO_BASE_URL, '/v1')

  try {
    const response = await fetch(`${base}/api/v1/models/load`, {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        ...(options.contextLength != null && { context_length: options.contextLength }),
        ...(options.flashAttention != null && { flash_attention: options.flashAttention }),
        ...(options.evalBatchSize != null && { eval_batch_size: options.evalBatchSize }),
        ...(options.numExperts != null && { num_experts: options.numExperts }),
        ...(options.offloadKvCacheToGpu != null && {
          offload_kv_cache_to_gpu: options.offloadKvCacheToGpu,
        }),
        // Ask for the resolved configuration back, so the UI reports what the
        // model is ACTUALLY running with rather than what was requested.
        echo_load_config: true,
      }),
      signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return {
        ok: false,
        error: `HTTP ${response.status}${body ? ` — ${body.slice(0, 300)}` : ''}`,
      }
    }

    const json = (await response.json()) as { load_config?: Record<string, unknown> }
    return { ok: true, ...(json.load_config != null && { loadConfig: json.load_config }) }
  } catch (err) {
    logger.debug({ err, base, model: modelId }, 'LM Studio load failed')
    return { ok: false, error: describeFetchFailure(err) }
  }
}
