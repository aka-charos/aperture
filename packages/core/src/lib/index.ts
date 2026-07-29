export { createLogger, getLogger, createChildLogger, type Logger } from './logger.js'

// n8n Webhook Integration
export {
  getN8nConfig,
  setN8nConfig,
  callN8nWebhook,
  N8nWebhookError,
  type N8nWebhookConfig,
  type N8nIntegrationConfig,
} from './n8n.js'

// Tavily Search Integration
export {
  getTavilyConfig,
  setTavilyConfig,
  isTavilyEnabled,
  tavilySearch,
  TavilyError,
  DEFAULT_TAVILY_CONFIG,
  type TavilyConfig,
  type TavilySearchParams,
  type TavilySearchResponse,
  type TavilySearchResultItem,
  type TavilySearchDepth,
  type TavilyTopic,
  type TavilyTimeRange,
} from './tavily.js'

export {
  getPool,
  query,
  queryOne,
  transaction,
  closePool,
  healthCheck,
  type QueryResult,
  type Pool,
  type PoolClient,
} from './db.js'

// AI Provider Abstraction
export {
  // Configuration
  getAIConfig,
  setAIConfig,
  getFunctionConfig,
  setFunctionConfig,
  // Model Factory (returns AI SDK model instances)
  getEmbeddingModelInstance,
  getChatModelInstance,
  getWebSearchModelInstance,
  getWebSearchAttempts,
  withWebSearchModel,
  getWebSearchProviderTools,
  getTextGenerationModelInstance,
  // Capability Checking
  getAICapabilitiesStatus,
  isAIFunctionConfigured,
  isAnyAIConfigured,
  isFullyConfigured,
  getCurrentEmbeddingDimensions,
  getActiveEmbeddingModelId,
  // Multi-Dimension Embedding Tables
  VALID_EMBEDDING_DIMENSIONS,
  getEmbeddingTableSuffix,
  getActiveEmbeddingTableName,
  // Legacy Embedding Cleanup
  checkLegacyEmbeddingsExist,
  dropLegacyEmbeddingTables,
  // Connection Testing
  testProviderConnection,
  // Backwards Compatibility
  getOpenAIApiKeyLegacy,
  // Re-exports from capabilities
  getProvider,
  getModel,
  getDefaultModel,
  validateCapabilityForFeature,
  getEmbeddingDimensions,
  getProvidersForFunction,
  getModelsForFunction,
  getModelsForFunctionWithCustom,
  getPricingForModel,
  getPricingForModelAsync,
  PROVIDERS,
  // Custom models (Ollama & OpenAI-compatible)
  getCustomModels,
  addCustomModel,
  deleteCustomModel,
  // Pricing cache
  getPricingData,
  findModelPricing,
  refreshPricingCache,
  getPricingCacheStatus,
  // OpenRouter account (credits & rolling spend on the configured key)
  getOpenRouterAccountStatus,
  // Types
  type ProviderType,
  type ProviderConfig,
  type AIConfig,
  type FunctionStatus,
  type AICapabilitiesStatus,
  type AIFunction,
  type ModelMetadata,
  type ProviderMetadata,
  type ModelCapabilities,
  type FunctionPricing,
  type ValidEmbeddingDimension,
  type LegacyEmbeddingsInfo,
  type CustomModel,
  type WebSearchAttempt,
  type WebSearchCallOutcome,
  type WebSearchUsageTokens,
} from './ai-provider.js'

// Web Search free-tier quota (Gemini grounding role)
export {
  getFreeTierLimits,
  classifyQuotaError,
  markSlotExhausted,
  isSlotCoolingDown,
  clearSlotCooldown,
  getSlotCooldownUntil,
  getSlotCooldowns,
  WEB_SEARCH_KEY_SLOTS,
  type WebSearchKeySlot,
  type FreeTierLimits,
  type QuotaScope,
  type QuotaErrorInfo,
} from './webSearchQuota.js'

export {
  recordWebSearchCall,
  getWebSearchUsageSummary,
  type WebSearchCallStatus,
  type WebSearchCallRecord,
  type WebSearchUsageWindow,
  type WebSearchSlotUsage,
  type WebSearchUsageSummary,
} from './webSearchUsage.js'

export {
  withInferenceContext,
  getInferenceContext,
  type InferenceContext,
} from './inferenceContext.js'

export {
  recordInferenceCall,
  getInferenceSummary,
  getRecentInferenceCalls,
  getInferenceSessions,
  type InferenceCallStatus,
  type InferenceCallRecord,
  type InferenceTotals,
  type InferenceBreakdownRow,
  type InferenceDailyRow,
  type InferenceSummary,
  type InferenceCallRow,
  type InferenceSessionRow,
} from './inferenceUsage.js'

export { type OpenRouterAccountStatus } from './openrouter-usage.js'
