export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'ollama'
  | 'groq'
  | 'google'
  | 'openai-compatible'
  | 'deepseek'
  | 'openrouter'
  | 'huggingface'

export interface ProviderInfo {
  id: ProviderType
  name: string
  type: 'cloud' | 'self-hosted' | 'openai-compatible'
  requiresApiKey: boolean
  requiresBaseUrl: boolean
  defaultBaseUrl?: string
  website?: string
  logoPath?: string
}

export interface FunctionConfig {
  provider: ProviderType
  model: string
  apiKey?: string
  baseUrl?: string
  /**
   * Spare keys, tried in order when the main one runs out of quota. Offered by
   * the grounding roles (Web Search, Title Analysis), where a free-tier daily
   * cap is what actually runs out. Omitted from a save request means "leave
   * them as they are"; an empty array clears them (see the PATCH handler in
   * settings/aiConfig.ts).
   *
   * Each key should belong to a separate provider project — two keys on one
   * project share a quota, so the second buys nothing.
   */
  fallbackApiKeys?: string[]
  /** @deprecated Superseded by {@link fallbackApiKeys}; still read, never written. */
  fallbackApiKey?: string
  /**
   * Whether this role's Google keys are on the free tier. Only affects what the
   * usage meter may assume: on, the shipped free-tier ceilings give the bars a
   * denominator; off, only limits Google has actually enforced are drawn.
   * Nothing throttles on it. Absent means free tier.
   */
  freeTier?: boolean
  /**
   * Models to try, in order, when the one above cannot be reached — a 429, a
   * 5xx, or the 404 a provider answers with once it has withdrawn an endpoint.
   * Each entry carries its own provider, so a cloud role can fall back to a
   * local server. Omitted from a save means "leave alone"; an empty array
   * clears the list.
   */
  fallbackModels?: FallbackModelConfig[]
  /**
   * Minimum seconds between calls on this role's provider; 0 or absent is off.
   * For free-tier credentials, whose limits are per minute as well as per day.
   */
  callSpacingSeconds?: number
  /**
   * Which retrieval space the Embeddings role embeds into. Absent = the
   * provider's default, where every vector written before this existed lives.
   *
   * Changing it is a NEW SET OF VECTORS, not a setting tweak: it rides in the
   * stored set identity, so the existing library stays untouched beside it and
   * a full re-embed is needed before anything reads the new space. `null`
   * clears it back to the default; omitting the field means "leave alone".
   *
   * The values are OpenRouter's; the server maps them to Google's native task
   * types on that provider. Only providers that can actually send one accept
   * it — the server rejects the rest rather than storing a mode that would
   * never reach the model.
   */
  embeddingInputType?: EmbeddingInputTypeValue | null
  /**
   * Pin OpenRouter routing for the Embeddings role to one upstream.
   *
   * Required when the chosen mode reaches the model as a request PARAMETER:
   * OpenRouter routes each call to whichever upstream it likes and they do not
   * all honour an undocumented field, so an unpinned parameter mode makes the
   * library a mixture of two spaces. Not needed for a text-prefix mode, which
   * conditions the input and so cannot be dropped by a route.
   */
  embeddingProviderOnly?: string | null
}

/** OpenRouter upstreams worth pinning to, base slugs (not region-scoped tags). */
export const OPENROUTER_UPSTREAMS = ['google-vertex', 'google-ai-studio'] as const

/**
 * The retrieval modes offered for the Embeddings role.
 *
 * Duplicated from core's `EMBEDDING_INPUT_TYPES` rather than imported — the web
 * bundle never imports `@aperture/core`. The server is authoritative and
 * rejects anything it does not recognise, so a drift here fails loudly at save
 * rather than silently mislabelling vectors.
 */
export const EMBEDDING_INPUT_TYPE_VALUES = [
  'semantic_similarity',
  'search_query',
  'search_document',
] as const

export type EmbeddingInputTypeValue = (typeof EMBEDDING_INPUT_TYPE_VALUES)[number]

/** Providers whose embeddings API can carry a retrieval mode. Mirrors core. */
export const PROVIDERS_WITH_INPUT_TYPE: readonly ProviderType[] = ['openrouter', 'google']

export interface FallbackModelConfig {
  provider: ProviderType
  model: string
}

export const PROVIDER_INFO: Record<ProviderType, ProviderInfo> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    type: 'cloud',
    requiresApiKey: true,
    requiresBaseUrl: false,
    website: 'https://platform.openai.com/api-keys',
    logoPath: '/openai.svg',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'cloud',
    requiresApiKey: true,
    requiresBaseUrl: false,
    website: 'https://console.anthropic.com',
    logoPath: '/claude.svg',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    type: 'cloud',
    requiresApiKey: true,
    requiresBaseUrl: false,
    website: 'https://console.groq.com',
    logoPath: '/groq.svg',
  },
  google: {
    id: 'google',
    name: 'Google AI',
    type: 'cloud',
    requiresApiKey: true,
    requiresBaseUrl: false,
    website: 'https://makersuite.google.com/app/apikey',
    logoPath: '/gemini.svg',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'cloud',
    requiresApiKey: true,
    requiresBaseUrl: false,
    website: 'https://platform.deepseek.com',
    logoPath: '/deepseek.svg',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    type: 'self-hosted',
    requiresApiKey: false,
    requiresBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434',
    website: 'https://ollama.ai',
    logoPath: '/ollama.svg',
  },
  'openai-compatible': {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',
    type: 'openai-compatible',
    requiresApiKey: false,
    requiresBaseUrl: true,
    defaultBaseUrl: 'http://localhost:1234/v1',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'cloud',
    requiresApiKey: true,
    requiresBaseUrl: false,
    website: 'https://openrouter.ai/keys',
    logoPath: '/openrouter.svg',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    type: 'cloud',
    requiresApiKey: true,
    requiresBaseUrl: false,
    website: 'https://huggingface.co/settings/tokens',
    logoPath: '/huggingface.svg',
  },
}
