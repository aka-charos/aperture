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

// fastCRW — self-hosted search + scrape, the retrieval half of title analysis
export {
  getCrwConfig,
  setCrwConfig,
  isCrwEnabled,
  crwSearch,
  testCrwConnection,
  readCrwWarnings,
  describeTestOutcome,
  urlDomain,
  CrwError,
  DEFAULT_CRW_CONFIG,
  CRW_SEARCH_ENGINES,
  isCrwSearchEngine,
  sanitizeSearchEngines,
  type CrwConfig,
  type CrwSearchEngine,
  type CrwSearchParams,
  type CrwSearchResponse,
  type CrwSearchResultItem,
} from './crw.js'

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
  getEmbeddingInvocation,
  type EmbeddingInvocation,
  getChatModelInstance,
  getWebSearchModelInstance,
  getWebSearchAttempts,
  withWebSearchModel,
  getWebSearchProviderTools,
  getGroundingAttempts,
  getGroundingKeySlots,
  withGroundingModel,
  getGroundingProviderTools,
  resolveFallbackKeys,
  resolveFallbackModels,
  resolveCallSpacingMs,
  MAX_CALL_SPACING_SECONDS,
  isFreeTierConfig,
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
  AI_FUNCTIONS,
  isAIFunction,
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
  type FallbackModel,
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

// Free-tier quota for the grounding role. Limits Google has ENFORCED always
// win; the shipped free-tier table only fills gaps, and only when the operator
// says the key is a free-tier one — see webSearchQuota.ts for why.
export {
  getFreeTierLimits,
  resolveModelLimits,
  noteObservedLimit,
  clearObservedLimits,
  classifyQuotaError,
  markSlotExhausted,
  isSlotCoolingDown,
  clearSlotCooldown,
  getSlotCooldownUntil,
  getSlotCooldowns,
  keySlotName,
  type WebSearchKeySlot,
  type FreeTierLimits,
  type ResolvedLimits,
  type LimitSource,
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

// Stored embedding sets — what this instance holds per model, and what it
// would still cost to switch to each one.
export {
  getEmbeddingSetsReport,
  deleteEmbeddingSet,
  type EmbeddingSetPending,
  type EmbeddingSetSummary,
  type EmbeddingSetsReport,
} from './embeddingSets.js'

// Embedding set identity — the one place `provider:model[~mode]` is built.
export {
  embeddingSetId,
  describeEmbeddingSetId,
  resolveEmbeddingInputType,
  isEmbeddingInputType,
  googleTaskTypeFor,
  providerSupportsInputType,
  EMBEDDING_INPUT_TYPES,
  EMBEDDING_MODE_SEPARATOR,
  UNKNOWN_EMBEDDING_SET,
  PROVIDERS_SUPPORTING_INPUT_TYPE,
  type EmbeddingInputType,
  type EmbeddingIdentityConfig,
} from './embeddingIdentity.js'

