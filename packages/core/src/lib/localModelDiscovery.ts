/**
 * Local Model Discovery
 *
 * A local inference server already knows which models it has, so making the
 * operator retype their ids by hand is asking them to copy a list the server
 * would hand over for free — and LM Studio's ids are exactly the kind nobody
 * remembers (`text-embedding-nomic-embed-text-v1.5`, `qwen/qwen3-8b`). One
 * character wrong and the model tests as unreachable, which reads as a broken
 * integration rather than a typo.
 *
 * So the picker reads the catalog off the server and offers what is actually
 * installed, filtered to the models that can hold the role being configured.
 *
 * The filtering is a pure function over the catalog entries, pinned by
 * `localModelDiscovery.test.ts`, because its two failure modes are both silent:
 * offering an embedding model for the assistant produces a confusing test
 * failure at the far end, and hiding a usable model reads as "LM Studio isn't
 * detected" — the exact confusion this exists to remove.
 */

import { formatContextWindow } from './ai-capabilities/contextWindow.js'
import type { AIFunction, ModelCapabilities } from './ai-capabilities.js'
import {
  listLmStudioModels,
  lmStudioCapabilities,
  type LmStudioModel,
} from './local-model-capabilities.js'
import {
  isUnslothLanguageModel,
  listUnslothModels,
  type UnslothModel,
} from './unslothServer.js'

/** A model the server reports having, described well enough to choose between. */
export interface DiscoveredModel {
  id: string
  name: string
  description?: string
  capabilities: ModelCapabilities
  contextWindow?: string
  /** LM Studio loads on demand, and Unsloth does with "Switch model by request"
   *  on, so a not-loaded model is still usable — this is purely so the picker
   *  can say which one answers instantly. */
  loaded?: boolean
}

/** A model the server has that this role cannot use, and why. */
export interface SkippedModel {
  id: string
  /**
   * A stable reason id, not prose: the web bundle translates it. `wrongType` is
   * an embedding model offered to a writing role or the reverse; `noToolCalling`
   * is a language model whose catalog entry says it cannot call tools, which the
   * assistant requires.
   */
  reason: 'wrongType' | 'noToolCalling'
}

export interface DiscoveryResult {
  models: DiscoveredModel[]
  skipped: SkippedModel[]
}

/** Providers whose catalog can be read straight off the operator's server. */
export type DiscoverableProvider = 'lmstudio' | 'unsloth' | 'openai-compatible'

export function isDiscoverableProvider(value: string): value is DiscoverableProvider {
  return value === 'lmstudio' || value === 'unsloth' || value === 'openai-compatible'
}

/** Roles that write or converse, as opposed to embedding. */
function isLanguageRole(fn: AIFunction): boolean {
  return fn !== 'embeddings'
}

/**
 * Whether a catalog entry is a language model.
 *
 * An entry with NO `type` is treated as one. That is not a guess about the
 * model so much as about the server: `type` is absent only on something that
 * answers LM Studio's path without being LM Studio, where excluding everything
 * would report an empty catalog — indistinguishable from "nothing installed".
 * The reverse default would be worse, since embedding is the narrower claim and
 * a wrongly-offered embedding model breaks the role it was picked for.
 */
function isLanguageModel(entry: LmStudioModel): boolean {
  return entry.type !== 'embeddings'
}

/**
 * Assumed capabilities for an entry whose server is too old to report any
 * (`capabilities` arrived in LM Studio 0.3.16). Mirrors the assumption the
 * settings UI already makes for a hand-added custom model: it was chosen for a
 * role, so assume it can do what the role needs.
 */
function assumedFor(fn: AIFunction): ModelCapabilities {
  return {
    supportsToolCalling: fn === 'chat',
    supportsToolStreaming: fn === 'chat',
    supportsObjectGeneration: fn !== 'embeddings',
    supportsEmbeddings: fn === 'embeddings',
  }
}

/**
 * The line under a model's id in the picker.
 *
 * `displayName` and `paramsString` come only from the v1 API and are worth
 * showing when present — "Phi-2 · 2.7B" says more about which model this is
 * than an architecture string does. The id itself stays the label, because it
 * is the value that gets sent; this is only there to tell two similar ids
 * apart.
 */
function describe(entry: LmStudioModel): string | undefined {
  const parts = [
    entry.displayName,
    entry.paramsString,
    entry.publisher,
    entry.arch,
    entry.quantization,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * Which of a server's models can hold this role, and which cannot.
 *
 * Pure: takes the catalog as read, decides nothing about how it was fetched.
 */
export function lmStudioModelsForRole(
  entries: LmStudioModel[],
  fn: AIFunction
): DiscoveryResult {
  // Web Search grounds through the provider itself and is Google-only, so a
  // local server can never answer it. Returning nothing is the honest answer;
  // the role never offers the button.
  if (fn === 'webSearch') return { models: [], skipped: [] }

  const models: DiscoveredModel[] = []
  const skipped: SkippedModel[] = []

  for (const entry of entries) {
    const wantsLanguage = isLanguageRole(fn)
    if (wantsLanguage !== isLanguageModel(entry)) {
      skipped.push({ id: entry.id, reason: 'wrongType' })
      continue
    }

    const known = lmStudioCapabilities(entry)
    const capabilities = known ?? assumedFor(fn)

    // The assistant cannot work without tool calling, so a model whose entry
    // says it has none is withheld rather than offered and then broken. Only a
    // KNOWN absence counts: a pre-0.3.16 server reports nothing at all, and
    // hiding every model there would look like a failed detection.
    if (fn === 'chat' && known && !known.supportsToolCalling) {
      skipped.push({ id: entry.id, reason: 'noToolCalling' })
      continue
    }

    models.push({
      id: entry.id,
      name: entry.id,
      description: describe(entry),
      capabilities,
      ...(entry.max_context_length != null && {
        contextWindow: formatContextWindow(entry.max_context_length),
      }),
      ...(entry.state != null && { loaded: entry.state === 'loaded' }),
    })
  }

  return { models, skipped }
}

/**
 * Which of an Unsloth server's models can hold this role. Pure.
 *
 * Unsloth's catalog says less than LM Studio's: no tool support and no type,
 * only a `task` on image, audio and video models. So a language role is offered
 * every entry without one, with the capabilities the role needs assumed, which
 * is the same assumption a hand-added custom model gets and the reason the add
 * dialog refuses to save a model that has not tested successfully. Embeddings
 * and Web Search get nothing: the provider holds neither role (unsloth.json).
 */
export function unslothModelsForRole(entries: UnslothModel[], fn: AIFunction): DiscoveryResult {
  if (fn === 'webSearch' || fn === 'embeddings') return { models: [], skipped: [] }

  const models: DiscoveredModel[] = []
  const skipped: SkippedModel[] = []
  for (const entry of entries) {
    if (!isUnslothLanguageModel(entry)) {
      skipped.push({ id: entry.id, reason: 'wrongType' })
      continue
    }
    const parts = [entry.displayName, entry.quant].filter(
      (p): p is string => typeof p === 'string' && p.length > 0
    )
    models.push({
      id: entry.id,
      name: entry.id,
      ...(parts.length > 0 && { description: parts.join(' · ') }),
      capabilities: assumedFor(fn),
      ...(entry.contextLength != null && { contextWindow: formatContextWindow(entry.contextLength) }),
      loaded: entry.loaded,
    })
  }
  return { models, skipped }
}

/**
 * Read a local server's installed models and keep the ones this role can use.
 *
 * Returns null when the catalog could not be read — the server is not running,
 * the address is wrong, or it is not LM Studio. The caller must present that as
 * "could not reach the server", never as an empty list: "nothing installed" and
 * "wrong address" look identical in a dropdown and mean opposite things.
 */
export async function discoverLocalModels(
  providerId: string,
  fn: AIFunction,
  baseUrl?: string,
  apiKey?: string,
  options: {
    /**
     * Why the list could not be read, when the server said. Only Unsloth's
     * reader reports one; LM Studio's probe falls back across two APIs and has
     * no single reason to give.
     */
    onUnreachable?: (reason: string) => void
  } = {}
): Promise<DiscoveryResult | null> {
  if (!isDiscoverableProvider(providerId)) return null

  // Always a fresh read. Discovery is asked for by hand, and the point of
  // asking is usually that something changed on the server a moment ago.
  if (providerId === 'unsloth') {
    const unsloth = await listUnslothModels(baseUrl, apiKey, options.onUnreachable)
    return unsloth ? unslothModelsForRole(unsloth, fn) : null
  }

  const entries = await listLmStudioModels(baseUrl, apiKey, true)
  if (!entries) return null

  return lmStudioModelsForRole(entries, fn)
}
