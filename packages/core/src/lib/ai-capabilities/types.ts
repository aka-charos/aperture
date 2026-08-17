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
