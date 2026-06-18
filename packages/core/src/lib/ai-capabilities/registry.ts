import { loadProviders } from './loadProviders.js'
import type { AIFunction, FunctionPricing, ModelMetadata, ProviderMetadata } from './types.js'

export const PROVIDERS: ProviderMetadata[] = loadProviders()

/**
 * Providers that ship no built-in models and rely on user-added custom models.
 * Their custom chat models are assumed tool-capable, so they qualify for the
 * Chat Assistant even without a built-in tool-calling model — the same way they
 * already qualify for Text Generation. Mirrors the custom-model support in the
 * settings UI (Ollama, OpenAI-Compatible, OpenRouter).
 */
const CUSTOM_MODEL_PROVIDERS = new Set(['ollama', 'openai-compatible', 'openrouter'])

export function getProvider(providerId: string): ProviderMetadata | undefined {
  return PROVIDERS.find((p) => p.id === providerId)
}

export function getModel(
  providerId: string,
  modelId: string,
  functionType: AIFunction
): ModelMetadata | undefined {
  const provider = getProvider(providerId)
  if (!provider) return undefined

  const models =
    functionType === 'embeddings'
      ? provider.embeddingModels
      : functionType === 'chat' || functionType === 'webSearch'
        ? provider.chatModels
        : functionType === 'exploration'
          ? provider.explorationModels
          : provider.textGenerationModels

  return models.find((m) => m.id === modelId)
}

export function getProvidersForFunction(fn: AIFunction): ProviderMetadata[] {
  return PROVIDERS.filter((p) => {
    if (fn === 'embeddings') return p.supportsEmbeddings
    if (fn === 'chat')
      return (
        p.supportsChat &&
        (p.chatModels.some((m) => m.capabilities.supportsToolCalling) ||
          CUSTOM_MODEL_PROVIDERS.has(p.id))
      )
    if (fn === 'textGeneration') return p.supportsTextGeneration
    if (fn === 'exploration') return p.supportsExploration
    // Web Search needs a grounding-capable provider — Google only for now
    if (fn === 'webSearch') return p.id === 'google' && p.chatModels.length > 0
    return false
  })
}

export function getModelsForFunction(providerId: string, fn: AIFunction): ModelMetadata[] {
  const provider = getProvider(providerId)
  if (!provider) return []

  if (fn === 'embeddings') {
    return provider.embeddingModels
  }
  if (fn === 'chat') {
    return provider.chatModels.filter((m) => m.capabilities.supportsToolCalling)
  }
  if (fn === 'textGeneration') {
    return provider.textGenerationModels.length > 0
      ? provider.textGenerationModels
      : provider.chatModels
  }
  if (fn === 'exploration') {
    return provider.explorationModels.length > 0
      ? provider.explorationModels.filter((m) => m.capabilities.supportsObjectGeneration)
      : provider.chatModels.filter((m) => m.capabilities.supportsObjectGeneration)
  }
  if (fn === 'webSearch') {
    // Grounding-capable chat models (Google); tool calling required to ground
    return provider.chatModels.filter((m) => m.capabilities.supportsToolCalling)
  }
  return []
}

export function validateCapabilityForFeature(
  fn: AIFunction,
  providerId: string,
  modelId: string
): { supported: boolean; reason?: string } {
  const provider = getProvider(providerId)
  if (!provider) {
    return { supported: false, reason: `Unknown provider: ${providerId}` }
  }

  if (fn === 'webSearch' && providerId !== 'google') {
    return {
      supported: false,
      reason: 'Web Search requires a grounding-capable provider (Google)',
    }
  }

  const model = getModel(providerId, modelId, fn)

  if (!model) {
    return { supported: true, reason: 'Unknown model - capabilities not verified' }
  }

  if (fn === 'embeddings' && !model.capabilities.supportsEmbeddings) {
    return { supported: false, reason: `${model.name} does not support embeddings` }
  }

  if (fn === 'chat' && !model.capabilities.supportsToolCalling) {
    return {
      supported: false,
      reason: `${model.name} does not support tool calling, which is required for the Chat Assistant`,
    }
  }

  return { supported: true }
}

export function getDefaultModel(providerId: string, fn: AIFunction): string | undefined {
  const models = getModelsForFunction(providerId, fn)
  return models[0]?.id
}

export function providerRequiresApiKey(providerId: string): boolean {
  const provider = getProvider(providerId)
  return provider?.requiresApiKey ?? true
}

export function providerRequiresBaseUrl(providerId: string): boolean {
  const provider = getProvider(providerId)
  return provider?.requiresBaseUrl ?? false
}

export function getDefaultBaseUrl(providerId: string): string | undefined {
  const provider = getProvider(providerId)
  return provider?.defaultBaseUrl
}

export function getEmbeddingDimensions(providerId: string, modelId: string): number | undefined {
  const model = getModel(providerId, modelId, 'embeddings')
  return model?.embeddingDimensions
}

/** @deprecated Use getPricingForModelAsync for dynamic pricing from Helicone API */
export function getPricingForModel(
  providerId: string,
  modelId: string,
  functionType: AIFunction
): FunctionPricing | null {
  const provider = getProvider(providerId)
  if (!provider) return null

  const model = getModel(providerId, modelId, functionType)
  const isLocalProvider = provider.type === 'self-hosted' || provider.type === 'openai-compatible'

  return {
    provider: providerId,
    providerName: provider.name,
    model: modelId,
    modelName: model?.name || modelId,
    isLocalProvider,
    inputCostPerMillion: isLocalProvider ? 0 : (model?.inputCostPerMillion ?? 0),
    outputCostPerMillion: isLocalProvider ? 0 : (model?.outputCostPerMillion ?? 0),
    embeddingDimensions: model?.embeddingDimensions,
  }
}

export async function getPricingForModelAsync(
  providerId: string,
  modelId: string,
  functionType: AIFunction
): Promise<FunctionPricing | null> {
  const { findModelPricing } = await import('../pricing-cache.js')

  const provider = getProvider(providerId)
  if (!provider) return null

  const model = getModel(providerId, modelId, functionType)
  const isLocalProvider = provider.type === 'self-hosted' || provider.type === 'openai-compatible'

  let inputCostPerMillion = 0
  let outputCostPerMillion = 0

  if (!isLocalProvider) {
    const dynamicPricing = await findModelPricing(providerId, modelId)
    if (dynamicPricing) {
      inputCostPerMillion = dynamicPricing.inputCostPerMillion
      outputCostPerMillion = dynamicPricing.outputCostPerMillion
    } else {
      inputCostPerMillion = model?.inputCostPerMillion ?? 0
      outputCostPerMillion = model?.outputCostPerMillion ?? 0
    }
  }

  return {
    provider: providerId,
    providerName: provider.name,
    model: modelId,
    modelName: model?.name || modelId,
    isLocalProvider,
    inputCostPerMillion,
    outputCostPerMillion,
    embeddingDimensions: model?.embeddingDimensions,
  }
}
