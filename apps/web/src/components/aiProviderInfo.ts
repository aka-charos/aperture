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
  /**
   * How hard this role's model is asked to think. Absent/null = the provider
   * default, which is what every role got before this existed.
   *
   * A plain string, because the accepted words belong to the MODEL rather than
   * to this app: OpenRouter publishes 21 distinct vocabularies over seven words
   * and no model takes all seven. The list for the chosen model rides in the
   * models response as `supportedEfforts`; the server validates against the
   * same list, so a value that saves is a value that reaches the wire.
   */
  reasoningEffort?: string | null
}

/**
 * Display order for effort words, weakest first, mirroring core's
 * `KNOWN_REASONING_EFFORTS`.
 *
 * An ORDER and a label-key set — never a filter. A model's own list is the
 * authority on what is offered; a word absent from here still appears (sorted
 * last, labelled with its own name) because filtering would hide a capability
 * the model genuinely has. Duplicated rather than imported: the web bundle
 * never imports `@aperture/core`.
 */
export const KNOWN_REASONING_EFFORTS: readonly string[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/**
 * The roles that read one, and therefore the only ones that may store one.
 * Mirrors core's `ROLES_WITH_REASONING_EFFORT`.
 */
export const ROLES_WITH_REASONING_EFFORT: readonly string[] = ['textGeneration', 'titleAnalysis']

/**
 * What to put in the effort dropdown: what THIS model accepts, plus whatever
 * this instance has already stored.
 *
 * The stored value is re-added for the same reason
 * {@link embeddingInputTypeOptions} does it: a MUI Select whose value is not
 * among its options renders blank, and the next save would write that blank
 * over a real setting for someone who only opened the page. That is not
 * hypothetical here — OpenRouter's catalog moves under stored settings, and
 * switching models is the ordinary way to end up off-list.
 */
export function reasoningEffortOptions(
  supported: readonly string[] | undefined,
  current: string
): readonly string[] {
  const offered = supported ?? []
  if (!current || offered.includes(current)) return offered
  return [...offered, current]
}

/**
 * The label key for an effort word, or null when there is no translation.
 *
 * A word OpenRouter adds after this ships has no key, and `t()` would render
 * the raw key path — so the caller falls back to the word itself, which is
 * already the vendor's own English name for it.
 */
export function reasoningEffortLabelKey(effort: string): string | null {
  return KNOWN_REASONING_EFFORTS.includes(effort)
    ? `aiFunctionCard.reasoningOptions.${effort}`
    : null
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
  'clustering',
] as const

export type EmbeddingInputTypeValue = (typeof EMBEDDING_INPUT_TYPE_VALUES)[number]

/**
 * The subset the dropdown OFFERS, which is deliberately not everything the
 * server accepts.
 *
 * `search_query` is withheld. Measured on `gemini-embedding-001` — the only
 * catalogued model that takes it — it returns the byte-identical vector to
 * sending nothing, because that model's default output space already IS
 * `RETRIEVAL_QUERY`; on `gemini-embedding-2` there is no verified prefix for it
 * and the settings route refuses it outright. So on every model available here
 * it is either a no-op or an error, and its one achievable effect is to
 * re-embed the whole library into a NEW set identity holding vectors that
 * already exist — full cost, doubled storage, zero difference.
 *
 * It stays in {@link EMBEDDING_INPUT_TYPE_VALUES} rather than being deleted,
 * because core still accepts it: an instance that already stored it must keep
 * resolving to the same set id. Dropping it from the vocabulary would make
 * `embeddingSetId` return the bare `provider:model`, every read would miss rows
 * written under `…~search_query`, and the library would read as permanently
 * empty AND permanently pending while silently re-embedding.
 */
export const EMBEDDING_INPUT_TYPES_OFFERED: readonly EmbeddingInputTypeValue[] = [
  'semantic_similarity',
  'clustering',
  'search_document',
]

/**
 * What to put in the mode dropdown: the offered set, plus whatever this
 * instance has already stored.
 *
 * A MUI Select whose `value` is absent from its options renders blank, and the
 * next save would then write that blank over a real setting — changing the set
 * identity and orphaning every vector, for someone who only opened the page.
 */
export function embeddingInputTypeOptions(current: string): readonly EmbeddingInputTypeValue[] {
  if (!current || EMBEDDING_INPUT_TYPES_OFFERED.includes(current as EmbeddingInputTypeValue)) {
    return EMBEDDING_INPUT_TYPES_OFFERED
  }
  return [...EMBEDDING_INPUT_TYPES_OFFERED, current as EmbeddingInputTypeValue]
}

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
