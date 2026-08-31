export interface ModelCapabilities {
  supportsToolCalling: boolean
  supportsToolStreaming: boolean
  supportsObjectGeneration: boolean
  supportsEmbeddings: boolean
}

export interface ModelMetadata {
  id: string
  name: string
  capabilities: ModelCapabilities

  embeddingDimensions?: number

  /**
   * The retrieval mode this model should be embedded with for THIS app, when
   * leaving it unset would land in the wrong space.
   *
   * A recommendation, never an automatic action. Applying it silently would
   * rewrite the set identity — a different population of vectors — off the back
   * of someone opening a settings page, and the card shows it as a hint with an
   * explicit Apply instead.
   *
   * Absent means there is no mode worth asking for on this model. That covers
   * two quite different cases and neither is "the default is fine":
   * gemini-embedding-001 CAN take one and must not, because the endpoint
   * delivers it only sometimes; Qwen has no symmetric form to ask for, its
   * instruction recipe being query-side against bare documents.
   */
  recommendedInputType?: 'semantic_similarity' | 'search_query' | 'search_document'

  /**
   * HOW a retrieval mode reaches this model. Absent means `parameter`.
   *
   * `parameter` — an API field (OpenRouter's `input_type`, Google's native
   * `taskType`). What `gemini-embedding-001` and every older model use.
   *
   * `textPrefix` — the mode is written into the text being embedded.
   * `gemini-embedding-2` dropped `task_type` and moved task conditioning into
   * the prompt, so it **ignores** `input_type` entirely: measured, its
   * `semantic_similarity` output is byte-identical to sending nothing, while
   * the documented prefix moves the vector to cosine 0.811 from bare text.
   *
   * Exactly one path is taken. A model on `textPrefix` is sent no parameter,
   * because a field it ignores is noise in the request and, worse, reads to a
   * later maintainer as though the mode were being delivered that way.
   */
  inputTypeMechanism?: 'parameter' | 'textPrefix'

  /**
   * For `textPrefix` models: the exact string prepended for each mode.
   *
   * A mode absent from this map is **not supported** on this model, and the
   * settings route refuses it rather than storing a mode that would be recorded
   * in the set identity and then never applied.
   *
   * Google documents eight prefixes for gemini-embedding-2 (verified against
   * ai.google.dev 2026-08-31). Only the symmetric one is offered here, and the
   * two retrieval ones are omitted on PURPOSE rather than for lack of
   * verification:
   *
   * - `task: search result | query: {content}` is the query half of an
   *   ASYMMETRIC pair. It only means anything against documents embedded as
   *   `title: {title} | text: {content}` — and this app has ONE index that the
   *   recommender, the similarity graph and semantic search all read, so a
   *   query-space vector would be compared against item-space ones. Splitting
   *   into two indexes is a much larger change than a settings field.
   * - the document form is not a prefix at all: it is a two-part template
   *   needing the title separately, which `prepareText(text)` cannot express.
   */
  inputTypePrefixes?: Partial<
    Record<'semantic_similarity' | 'search_query' | 'search_document', string>
  >

  /**
   * Why {@link recommendedInputType} is what it is, or — when there is no
   * recommendation — why this model needs none. Shown under the mode control,
   * because "leave this alone" is exactly as much a decision as changing it and
   * an empty hint reads as an oversight.
   */
  inputTypeNote?: string

  description?: string
  quality?: 'budget' | 'standard' | 'premium'
  speed?: 'slow' | 'medium' | 'fast'
  costTier?: 'free' | 'low' | 'medium' | 'high'
  contextWindow?: string
  inputCostPerMillion?: number
  outputCostPerMillion?: number
  notes?: string

  isCustom?: boolean
}

export interface ProviderMetadata {
  id: string
  name: string
  type: 'cloud' | 'self-hosted' | 'openai-compatible'
  website?: string
  logoPath?: string

  supportsEmbeddings: boolean
  supportsChat: boolean
  supportsTextGeneration: boolean
  supportsExploration: boolean

  requiresApiKey: boolean
  requiresBaseUrl: boolean
  defaultBaseUrl?: string

  embeddingModels: ModelMetadata[]
  chatModels: ModelMetadata[]
  textGenerationModels: ModelMetadata[]
  explorationModels: ModelMetadata[]
}

/**
 * Every configurable AI role. Each holds its own provider, model and credentials.
 *
 * `webSearch` and `titleAnalysis` can both spend Google's grounded-search quota,
 * and are separate roles precisely so they spend it from different keys: a
 * batch job writing per-title analysis would otherwise exhaust the daily
 * grounding cap that the assistant's discovery needs, and one meter covering
 * both could not say which did it.
 *
 * This is a runtime list rather than a bare union because the roles are also a
 * JSON-Schema `enum` on ten Fastify routes, and TypeScript cannot check a
 * hand-written copy of a union against the union. Adding `titleAnalysis` to the
 * type alone left every one of those enums a role short, so the settings card
 * asked for its providers and models and got `400 Bad Request` — which the web
 * reads as "no models available", for every provider, with the "add a custom
 * model" escape hatch rejected by the same rule. Derive, never retype.
 */
export const AI_FUNCTIONS = [
  'embeddings',
  'chat',
  'textGeneration',
  'exploration',
  'webSearch',
  'titleAnalysis',
] as const

export type AIFunction = (typeof AI_FUNCTIONS)[number]

/** Narrow a string that arrived over HTTP to a known role. */
export function isAIFunction(value: string): value is AIFunction {
  return (AI_FUNCTIONS as readonly string[]).includes(value)
}

export interface FunctionPricing {
  provider: string
  providerName: string
  model: string
  modelName: string
  isLocalProvider: boolean
  inputCostPerMillion: number
  outputCostPerMillion: number
  embeddingDimensions?: number
  /**
   * False when nobody could tell us what this model costs — no published price
   * in the registry, the Helicone table or the provider's own catalog. The costs
   * above are then 0 as a placeholder, which is NOT the same as free: a UI that
   * shows "$0.00" for an unpriced model is confidently wrong. Local providers
   * are `true` (genuinely free), as is any model with a real price.
   */
  pricingKnown: boolean
}
