/**
 * Unsloth Studio as an inference server.
 *
 * Unsloth Studio serves the models it has downloaded through an OpenAI-
 * compatible API (`/v1/chat/completions`, `/v1/models`, `/v1/props`) backed by
 * llama-server, so inference goes through `createOpenAICompatible` exactly as
 * LM Studio's does. What differs, and what this module exists for, is the
 * catalog and the server's state. Read off a live server (v0.1.911-beta) and
 * its source (`studio/backend/routes/inference.py`, `llama_compat.py`):
 *
 * - `GET /v1/models` lists every downloaded model, loaded or not, as
 *   `{ id, display_name, quant, loaded, status }`. The id is the repo id
 *   (`ornith-ai/Ornith-1.5-9B-GGUF`) and is what a request names. It carries NO
 *   tool support and NO model type: image, audio and video models are told
 *   apart only by a `task` field, which language models do not have.
 * - Nothing loads on demand unless the operator turns on "Switch model by
 *   request" (Settings → API). With it off, a request naming a model that is
 *   not loaded answers 503 with Unsloth's own hint to turn it on, which reaches
 *   the operator through the ordinary error path.
 * - The context window is fixed when a model loads (`-c`, or Unsloth's own
 *   choice) and is readable only while one is loaded, from `/v1/props`'
 *   `default_generation_settings.n_ctx`. A request cannot raise it.
 * - Every route needs `Authorization: Bearer sk-unsloth-…`, except under
 *   "Keyless API access", which Unsloth grants only to loopback callers and to
 *   10/8, 172.16/12, 192.168/16 and link-local addresses. A Tailscale address
 *   (100.64/10) is none of those, so a server reached over Tailscale answers
 *   401 with the toggle on. Measured, not inferred.
 *
 * Embeddings are deliberately not offered (unsloth.json). `/v1/embeddings`
 * answers from "the resident embedding GGUF when one is loaded, else Unsloth's
 * configured embedding model", so a request naming one model can be answered
 * by another — vectors from one space stored under the other's set id, which
 * nothing downstream can detect (F-093).
 */

import { createChildLogger } from './logger.js'
import {
  describeLocalFetchFailure,
  localServerAuthHeaders as authHeaders,
} from './localServerFetch.js'

const logger = createChildLogger('unsloth-server')

/** `unsloth studio` and `unsloth run` both start here unless told otherwise. */
export const DEFAULT_UNSLOTH_BASE_URL = 'http://localhost:8888/v1'

/** Listing scans the model folders on a cold index, so give it longer than a ping. */
const PROBE_TIMEOUT_MS = 10_000

/** One downloaded model, as `/v1/models` reports it. */
export interface UnslothModel {
  id: string
  displayName?: string
  /** The GGUF quantization on disk, e.g. `Q4_K_M`. */
  quant?: string
  /** In memory now. A model that is not is still usable with auto-switch on. */
  loaded: boolean
  /**
   * Set only on image, audio and video models (`text-to-speech`, `separation`,
   * …). A language model has none, which is the only way the catalog tells the
   * two apart.
   */
  task?: string
  /** Reported on a loaded row only. */
  contextLength?: number
}

/** Trim trailing slashes and a trailing `/v1`, giving the server root. */
export function unslothServerRoot(baseUrl?: string): string {
  const trimmed = (baseUrl ?? DEFAULT_UNSLOTH_BASE_URL).trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return unslothServerRoot(DEFAULT_UNSLOTH_BASE_URL)
  return trimmed.toLowerCase().endsWith('/v1') ? trimmed.slice(0, -3) : trimmed
}

/**
 * The base URL inference is sent to. The SDK appends `/chat/completions` to it
 * verbatim and Unsloth serves the OpenAI routes under `/v1` only, so a URL typed
 * without the suffix would list every model and then fail every test — the
 * fault `lmStudioInferenceBaseUrl` exists for, with the same answer.
 */
export function unslothInferenceBaseUrl(baseUrl?: string): string {
  return `${unslothServerRoot(baseUrl)}/v1`
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * Read `/v1/models`. Pure: an entry without a string id is dropped, and a
 * missing `loaded` reads as not loaded, never as loaded — "answers instantly"
 * is the claim, and it must not be made on no evidence.
 */
export function parseUnslothModels(json: unknown): UnslothModel[] {
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const out: UnslothModel[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    if (typeof e.id !== 'string' || e.id.length === 0) continue
    const contextLength = positiveInt(e.context_length)
    out.push({
      id: e.id,
      ...(typeof e.display_name === 'string' && e.display_name && { displayName: e.display_name }),
      ...(typeof e.quant === 'string' && e.quant && { quant: e.quant }),
      loaded: e.loaded === true,
      ...(typeof e.task === 'string' && e.task && { task: e.task }),
      ...(contextLength != null && { contextLength }),
    })
  }
  return out
}

/** Whether a catalog entry can hold a writing or conversing role. */
export function isUnslothLanguageModel(entry: UnslothModel): boolean {
  return entry.task == null
}

/** What a failed connection to Unsloth means; the mapping is shared (localServerFetch.ts). */
function describeFetchFailure(err: unknown): string {
  return describeLocalFetchFailure(err, {
    refused:
      'Nothing is listening there: check Unsloth is running on this port, and started with -H 0.0.0.0 if Aperture is on another machine or in a container.',
    timedOut:
      'Unsloth listens only on localhost unless started with -H 0.0.0.0, and a firewall on its machine does the same.',
  })
}

/** The sentence a 401 deserves, since "keyless is on" is the usual belief behind it. */
export const UNSLOTH_KEY_REQUIRED =
  'Unsloth asked for an API key. Create one under Settings → API in Unsloth and enter it here. ' +
  'Keyless access covers only localhost and private network addresses (10.x, 172.16–31.x, 192.168.x); ' +
  'a Tailscale or public address always needs a key.'

type Fetched = { ok: true; json: unknown } | { ok: false; error: string }

async function getJson(root: string, path: string, apiKey?: string): Promise<Fetched> {
  try {
    const response = await fetch(`${root}${path}`, {
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: UNSLOTH_KEY_REQUIRED }
      }
      return { ok: false, error: `${path} answered HTTP ${response.status}` }
    }
    return { ok: true, json: await response.json() }
  } catch (err) {
    return { ok: false, error: describeFetchFailure(err) }
  }
}

/**
 * Every model the server has downloaded, loaded or not.
 *
 * Null when the list could not be read — not running, wrong address, wrong key
 * — which callers must show as "could not reach the server", never as an empty
 * list. `onUnreachable` hears why, in the operator's terms, because the three
 * have different fixes and "a key is needed" is the one nobody guesses from a
 * generic message. Never cached: it is asked for by hand, after something
 * changed.
 */
export async function listUnslothModels(
  baseUrl?: string,
  apiKey?: string,
  onUnreachable?: (reason: string) => void
): Promise<UnslothModel[] | null> {
  const root = unslothServerRoot(baseUrl)
  const result = await getJson(root, '/v1/models', apiKey)
  if (!result.ok) {
    logger.debug({ root, error: result.error }, 'Unsloth model list could not be read')
    onUnreachable?.(result.error)
    return null
  }
  return parseUnslothModels(result.json)
}

/** A model in memory and the context window it was loaded with, when known. */
export interface UnslothLoadedModel {
  modelId: string
  contextLength?: number
}

/**
 * The state of an Unsloth server, as a test rather than a ping. The same shape
 * as the LM Studio status, so the card reports both one way; `version` replaces
 * LM Studio's REST API generation, and there is never an embedding count.
 */
export interface UnslothServerStatus {
  reachable: boolean
  version?: string
  totalModels: number
  languageModels: number
  embeddingModels: number
  loaded: UnslothLoadedModel[]
  error?: string
}

/**
 * Read the context window off `/v1/props`. Pure. `n_ctx` is what llama-server
 * reports for the loaded model; `model_path` is mapped by Unsloth to the same
 * public id `/v1/models` uses.
 */
export function readUnslothProps(json: unknown): { modelId?: string; contextLength?: number } {
  const props = json as { model_path?: unknown; default_generation_settings?: { n_ctx?: unknown } }
  const contextLength = positiveInt(props?.default_generation_settings?.n_ctx)
  return {
    ...(typeof props?.model_path === 'string' && props.model_path && { modelId: props.model_path }),
    ...(contextLength != null && { contextLength }),
  }
}

/**
 * Reach the server, say which version answered, count what it has, and report
 * what is loaded with the context window it runs at. The window matters more
 * here than on LM Studio: it is fixed at load and a request cannot raise it, so
 * a model loaded small truncates a long prompt with nothing in the request able
 * to change that.
 */
export async function probeUnslothServer(baseUrl?: string, apiKey?: string): Promise<UnslothServerStatus> {
  const root = unslothServerRoot(baseUrl)
  const listed = await getJson(root, '/v1/models', apiKey)
  if (!listed.ok) {
    return { reachable: false, totalModels: 0, languageModels: 0, embeddingModels: 0, loaded: [], error: listed.error }
  }
  const models = parseUnslothModels(listed.json)

  // Both best effort: the list already proves the server is there.
  const [version, props] = await Promise.all([
    getJson(root, '/version', apiKey),
    models.some((m) => m.loaded) ? getJson(root, '/v1/props', apiKey) : Promise.resolve(null),
  ])
  const versionText = version.ok ? (version.json as { version?: unknown })?.version : undefined
  const propsRead = props?.ok ? readUnslothProps(props.json) : {}
  const loadedCount = models.filter((m) => m.loaded).length

  return {
    reachable: true,
    ...(typeof versionText === 'string' && versionText && { version: versionText }),
    totalModels: models.length,
    languageModels: models.filter(isUnslothLanguageModel).length,
    embeddingModels: 0,
    loaded: models
      .filter((m) => m.loaded)
      .map((m) => {
        // `/v1/props` describes the one llama-server model, so it answers for a
        // row it names, or for the only loaded row when an alias renamed it.
        const propsApply = propsRead.modelId === m.id || loadedCount === 1
        const contextLength = m.contextLength ?? (propsApply ? propsRead.contextLength : undefined)
        return { modelId: m.id, ...(contextLength != null && { contextLength }) }
      }),
  }
}
