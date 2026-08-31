/**
 * The identity of a stored embedding set, and the retrieval mode that produced
 * it.
 *
 * WHY THIS MODULE EXISTS. Embedding rows are keyed `UNIQUE(<item>_id, model)`
 * inside a per-dimension table and every read filters `WHERE model = $n`, so
 * that one string is what separates one set of vectors from another. It used to
 * be built inline as `${provider}:${model}` in nineteen places across five
 * files — the duplicated-predicate shape this repo keeps paying for.
 *
 * It became urgent rather than merely untidy once the embedding *mode* turned
 * out to be reachable. OpenRouter's embeddings endpoint takes an `input_type`,
 * and for `google/gemini-embedding-001` the semantic-similarity mode returns a
 * genuinely different vector from the default — measured cosine 0.867 against
 * the default for the same text, which is a different space, not rounding. Two
 * modes of one model therefore have to be storable side by side, and with the
 * identity built from provider and model alone they collide: the second pass
 * upserts straight over the first, destroying the baseline it was supposed to
 * be compared against and leaving one set where the report should show two.
 *
 * THE ABSENT CASE IS LOAD-BEARING. With no mode set, this must return the exact
 * legacy string. Every row already in every embedding table was written under
 * `provider:model`, so any decoration at all — a trailing separator, a `~none`,
 * a normalised case — makes the entire existing library invisible to the
 * staleness join and to the recommender's `WHERE model = $n`, which presents as
 * a library that has silently lost its embeddings. Pinned by
 * `embeddingIdentity.test.ts`.
 */

/**
 * The separator between the model id and the mode.
 *
 * `~` rather than the more obvious `#` or `:`. It is unreserved in RFC 3986, so
 * it survives a URL path untouched — and the set id *is* a URL path segment, in
 * `DELETE /api/settings/ai/embeddings/sets/:model`. `#` would work while every
 * caller remembers `encodeURIComponent`, and the one that forgets would have
 * everything after it silently dropped, quietly addressing the semantic set's
 * id to the default set and deleting the wrong vectors. `:` and `/` are both
 * already inside model ids (`google/gemini-embedding-001`, and OpenRouter's
 * `:free` / `:extended` variants), so neither can delimit anything.
 */
export const EMBEDDING_MODE_SEPARATOR = '~'

/** What a row's `model` column says when the embeddings role is unconfigured. */
export const UNKNOWN_EMBEDDING_SET = 'unknown'

/**
 * The retrieval modes worth offering, in OpenRouter's vocabulary.
 *
 * This is the canonical spelling stored in config; Google's native enum is
 * mapped from it at call time by {@link googleTaskTypeFor}. One vocabulary,
 * because the alternative is a setting whose meaning depends on which provider
 * happens to be selected — and the provider can be changed without touching it.
 *
 * Deliberately a *list*, not a union assembled by hand somewhere else: the
 * settings card iterates it, and the same-list-not-a-union rule that governs
 * `AI_FUNCTIONS` applies for the same reason.
 */
export const EMBEDDING_INPUT_TYPES = [
  'semantic_similarity',
  'search_query',
  'search_document',
] as const

export type EmbeddingInputType = (typeof EMBEDDING_INPUT_TYPES)[number]

/** Whether a value is one of the modes this system knows how to store. */
export function isEmbeddingInputType(value: unknown): value is EmbeddingInputType {
  return (
    typeof value === 'string' &&
    (EMBEDDING_INPUT_TYPES as readonly string[]).includes(value)
  )
}

/**
 * The subset of a role config that decides which set its vectors belong to.
 *
 * Structural rather than an import of `ProviderConfig`, so this module stays
 * free of the provider layer and can be tested without a database.
 */
export interface EmbeddingIdentityConfig {
  provider: string
  model: string
  embeddingInputType?: string
  /**
   * The single OpenRouter upstream this role is pinned to, if any.
   *
   * Part of the identity ONLY when the mode is delivered as a parameter,
   * because that is the only case where the pin decides the space. Measured on
   * `gemini-embedding-001`: pinned to `google-vertex`, `input_type` is honoured
   * (cosine 0.841 from default); pinned to `google-ai-studio` it is dropped and
   * the default vector comes back. Both upstreams agree when no mode is sent,
   * so an unmoded set is the same population either way and takes no suffix —
   * which is what keeps every existing row's id unchanged.
   */
  embeddingProviderOnly?: string
}

/**
 * Separator between the mode and the upstream it was delivered by.
 *
 * `@` is a legal `pchar` in RFC 3986, so like `~` it survives a URL path
 * segment intact — and the set id is one, in the delete route.
 */
export const EMBEDDING_PIN_SEPARATOR = '@'

/**
 * The mode on a config, normalised — or `undefined` for "send nothing".
 *
 * Trimmed and lower-cased because it reaches both a stored identity and an
 * outgoing request body: ` Semantic_Similarity ` and `semantic_similarity` must
 * not become two sets holding the same vectors. An unrecognised value is
 * dropped rather than forwarded. That is the asymmetric-failure choice — a
 * typo'd mode forwarded verbatim would be accepted by OpenRouter (the field is
 * an unconstrained string), silently ignored by the provider, and stored under
 * an identity claiming a mode the vectors were never embedded in, which is a
 * confident number that means nothing. Dropping it merely falls back to the
 * default space, which is where every existing row already lives.
 */
export function resolveEmbeddingInputType(
  config: Pick<EmbeddingIdentityConfig, 'embeddingInputType'> | null | undefined
): EmbeddingInputType | undefined {
  const raw = config?.embeddingInputType
  if (typeof raw !== 'string') return undefined
  const normalized = raw.trim().toLowerCase()
  return isEmbeddingInputType(normalized) ? normalized : undefined
}

/**
 * The value written to (and matched against) every embedding row's `model`
 * column.
 *
 * `provider:model` when no mode is set — byte-identical to what this repo has
 * always written, which is what keeps existing libraries visible. See the
 * module comment.
 */
export function embeddingSetId(
  config: EmbeddingIdentityConfig | null | undefined,
  /**
   * How the mode is being delivered. Only a `parameter` mode makes the upstream
   * pin part of the identity — see {@link EmbeddingIdentityConfig.embeddingProviderOnly}.
   * Callers that do not know pass nothing, and get the un-pinned id.
   */
  mechanism?: 'parameter' | 'textPrefix' | 'none'
): string {
  if (!config?.provider || !config?.model) return UNKNOWN_EMBEDDING_SET

  const base = `${config.provider}:${config.model}`
  const mode = resolveEmbeddingInputType(config)
  if (!mode) return base

  const withMode = `${base}${EMBEDDING_MODE_SEPARATOR}${mode}`

  const pin = config.embeddingProviderOnly?.trim()
  if (mechanism !== 'parameter' || !pin) return withMode

  return `${withMode}${EMBEDDING_PIN_SEPARATOR}${pin}`
}

/**
 * A set id split back into the model it names and the mode it was embedded in.
 *
 * For display only — the admin panel shows "gemini-embedding-001 (semantic
 * similarity)" rather than a string with a tilde in it. Nothing in the data
 * path parses a set id; every consumer treats it as opaque, which is why a mode
 * suffix could be added without touching `embeddingSets.ts` at all.
 *
 * A tilde inside the model id itself would mis-split here. No provider uses one
 * today, and the consequence is a cosmetic label rather than a wrong query.
 */
export function describeEmbeddingSetId(setId: string): {
  base: string
  mode?: EmbeddingInputType
  pin?: string
} {
  // The pin comes off first: it is appended after the mode, and a model id can
  // contain neither separator.
  let rest = setId
  let pin: string | undefined
  const pinAt = rest.lastIndexOf(EMBEDDING_PIN_SEPARATOR)
  if (pinAt !== -1) {
    pin = rest.slice(pinAt + EMBEDDING_PIN_SEPARATOR.length)
    rest = rest.slice(0, pinAt)
  }

  const at = rest.lastIndexOf(EMBEDDING_MODE_SEPARATOR)
  if (at === -1) return { base: setId }

  const candidate = rest.slice(at + EMBEDDING_MODE_SEPARATOR.length)
  if (!isEmbeddingInputType(candidate)) return { base: setId }

  return { base: rest.slice(0, at), mode: candidate, ...(pin ? { pin } : {}) }
}

/**
 * Whether this configuration would silently produce a MIXTURE of two spaces.
 *
 * True when a mode is delivered as a request parameter on OpenRouter with no
 * upstream pinned. OpenRouter routes each call independently between upstreams
 * that need not treat an undocumented field the same way — measured on
 * `gemini-embedding-001`, five identical requests returned two different
 * vectors, one of them the unmoded one. A library pass in that state writes an
 * unpredictable blend of two populations into one set, and nothing downstream
 * can detect it.
 *
 * A `textPrefix` mode is exempt because it conditions the TEXT: every upstream
 * receives a different input and computes the same answer for it, so routing
 * cannot drop it.
 */
export function requiresProviderPin(input: {
  provider: string
  mechanism: 'parameter' | 'textPrefix' | 'none'
  pin?: string
}): boolean {
  if (input.provider !== 'openrouter') return false
  if (input.mechanism !== 'parameter') return false
  return !input.pin?.trim()
}

/**
 * Google's native task type for a mode, for the `google` provider's
 * `providerOptions.google.taskType`.
 *
 * Google exposes a wider taxonomy (CLASSIFICATION, CLUSTERING,
 * QUESTION_ANSWERING, FACT_VERIFICATION, CODE_RETRIEVAL_QUERY) that OpenRouter
 * does not, and mapping only these three keeps the two providers describing the
 * same three spaces. Adding a Google-only mode would make the setting mean
 * different things on different providers while looking like one setting.
 */
export function googleTaskTypeFor(
  mode: EmbeddingInputType | undefined
): 'SEMANTIC_SIMILARITY' | 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' | undefined {
  switch (mode) {
    case 'semantic_similarity':
      return 'SEMANTIC_SIMILARITY'
    case 'search_query':
      return 'RETRIEVAL_QUERY'
    case 'search_document':
      return 'RETRIEVAL_DOCUMENT'
    default:
      return undefined
  }
}

/**
 * How a mode reaches a given model, and the prefix to prepend if it is text.
 *
 * Pure, because the decision has three ways to be silently wrong and none of
 * them raises anything: sending a parameter a model ignores, prepending a
 * prefix a model does not expect, or believing a byte-identical response proves
 * a mode was honoured rather than dropped.
 *
 * `'none'` covers both "no mode was asked for" and "a mode was asked for that
 * this model has no verified way to deliver". The caller logs the second; from
 * here they are the same instruction — embed the text unconditioned, which is
 * the space every other row of a fresh set will be in.
 */
export function resolveInputTypeDelivery(input: {
  inputType?: EmbeddingInputType
  mechanism?: 'parameter' | 'textPrefix'
  prefixes?: Partial<Record<EmbeddingInputType, string>>
}): { mechanism: 'parameter' | 'textPrefix' | 'none'; prefix?: string } {
  const { inputType, mechanism = 'parameter', prefixes } = input

  if (!inputType) return { mechanism: 'none' }

  if (mechanism === 'parameter') return { mechanism: 'parameter' }

  const prefix = prefixes?.[inputType]
  return prefix ? { mechanism: 'textPrefix', prefix } : { mechanism: 'none' }
}

/**
 * Which providers can actually carry a mode.
 *
 * `openrouter` puts it in the request body as `input_type` (the provider's
 * `extraBody` is spread into the outgoing JSON verbatim); `google` sends its
 * native `taskType` through `providerOptions`. Everything else has nowhere to
 * put it, and a mode selected there would be stored in the set identity while
 * never reaching the model — the exact "identity claims a mode the vectors were
 * never embedded in" failure that {@link resolveEmbeddingInputType} refuses.
 */
export const PROVIDERS_SUPPORTING_INPUT_TYPE = ['openrouter', 'google'] as const

export function providerSupportsInputType(provider: string): boolean {
  return (PROVIDERS_SUPPORTING_INPUT_TYPE as readonly string[]).includes(provider)
}
