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
 * A configurable AI role. Each holds its own provider, model and credentials.
 *
 * `webSearch` and `titleAnalysis` both spend Google's grounded-search quota,
 * and are separate roles precisely so they spend it from different keys: a
 * batch job writing per-title analysis would otherwise exhaust the daily
 * grounding cap that the assistant's discovery needs, and one meter covering
 * both could not say which did it.
 */
export type AIFunction =
  | 'embeddings'
  | 'chat'
  | 'textGeneration'
  | 'exploration'
  | 'webSearch'
  | 'titleAnalysis'

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
