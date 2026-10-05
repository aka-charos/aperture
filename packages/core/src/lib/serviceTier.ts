/**
 * OpenRouter's flex service tier: which models have one, and when to ask for it.
 *
 * WHAT FLEX IS. Some upstreams sell one model at more than one grade of
 * capacity. OpenRouter's `service_tier` request field picks one: `default` is
 * the provider's regular capacity and price, `flex` is cheaper (OpenAI's flex is
 * half price) in exchange for higher latency and lower availability. Only those
 * two are offered here, on the operator's call — `priority`/`fast` and
 * `ultrafast` cost MORE, and nothing in this app is latency-bound enough to
 * want them.
 *
 * WHERE THE ANSWER IS, which the guide does not say. The bulk catalogue at
 * `/api/v1/models` — what `openrouter-capabilities.ts` already caches daily —
 * carries no tier information at all: not in `supported_parameters` (which
 * names `service_tier` for no model, since the field is OpenRouter's, not the
 * upstream's), not in `pricing`, not as a variant id. The per-model endpoints
 * listing does: `GET /api/v1/models/{author}/{slug}/endpoints` "lists tier
 * endpoints alongside standard endpoints. Each appears as its own entry with a
 * tier-suffixed `tag` (e.g. `openai/fast`) and its own tier pricing (the same
 * pricing used for billing)" (service-tiers guide, "Tier Endpoints in the
 * API"). `PublicEndpoint` in OpenRouter's OpenAPI spec has no `service_tier`
 * property, so the TAG is the only marker: `openai/flex`, `google-vertex/flex`,
 * `google-ai-studio/flex`. A model has flex exactly when one of its endpoints
 * carries that suffix.
 *
 * A TAG ALSO CARRIES REGIONS, which is why this reads segments rather than
 * matching a suffix loosely. `google-vertex/us-central1` is a region-scoped
 * DEFAULT endpoint (see the embeddings provider pin, F-038), so "has a second
 * segment" means nothing; only a segment that names a tier does.
 *
 * WHY SENDING IT BLIND IS SAFE, AND WHY THIS STILL GATES IT. The guide states
 * that a `flex` request to a model whose pool has no flex endpoint "routes
 * normally at standard rates" — so a wrong guess cannot produce a wrong request,
 * only the request the operator would have had anyway. The gate exists for the
 * opposite reason it exists in ./generationParams.ts: not to stop a bad request
 * but to stop a setting that saves, displays, and silently costs full price. An
 * operator who chose flex for a model without it is told so at save, and warned
 * at send if the model loses it later.
 *
 * FLEX HAS NO FALLBACK. With `service_tier: "flex"` OpenRouter restricts routing
 * to flex endpoints and "never falls back to a default-tier endpoint, since that
 * would cost more than the tier you requested, so a flex capacity error surfaces
 * instead". That is the price of the discount and it is the operator's to pay —
 * which is why the connection test sends a real flex request and reports what
 * came back, rather than trusting the listing alone.
 *
 * Pure, so the tag reading and the send decision can be pinned without a key, a
 * network or a database. The fetch and its cache live in
 * `openrouter-capabilities.ts`, beside the catalogue cache.
 */

/**
 * What the settings card offers, in display order. `default` is never STORED —
 * absent means default, which is what every role had before this existed and
 * what keeps their requests byte-identical.
 */
export const SERVICE_TIER_OPTIONS = ['default', 'flex'] as const

export type ServiceTierOption = (typeof SERVICE_TIER_OPTIONS)[number]

/** The only value a config ever holds; its absence is the default tier. */
export type StoredServiceTier = 'flex'

export function isServiceTierOption(value: unknown): value is ServiceTierOption {
  return typeof value === 'string' && (SERVICE_TIER_OPTIONS as readonly string[]).includes(value)
}

/**
 * Every tier an endpoint can belong to. Wider than what is offered on purpose:
 * reading a priority endpoint as `default` would count it as standard capacity
 * in the price comparison, and it is the most expensive endpoint a model has.
 */
export type EndpointTier = 'default' | 'flex' | 'priority' | 'ultrafast'

/**
 * Tag suffixes, per the guide: "formed by appending the tier to the provider
 * slug". `fast` and `priority` are one tier with two names.
 */
const TIER_SEGMENTS: Record<string, EndpointTier> = {
  flex: 'flex',
  priority: 'priority',
  fast: 'priority',
  ultrafast: 'ultrafast',
}

/**
 * The tier an endpoint serves, read from its tag.
 *
 * The first segment is the provider slug and is never a tier (a provider could
 * one day be called `fast`); any later segment naming a tier decides it, so a
 * region-scoped tier tag would be read correctly too. Anything else — a bare
 * slug, a region — is the default tier.
 */
export function endpointTier(tag: string): EndpointTier {
  const segments = tag.trim().toLowerCase().split('/')
  for (const segment of segments.slice(1)) {
    const tier = TIER_SEGMENTS[segment]
    if (tier) return tier
  }
  return 'default'
}

/**
 * OpenRouter prices in USD per token, as strings; convert to USD per 1M.
 *
 * The one copy: the catalogue reader and the endpoints reader both price from
 * the same wire format, and two converters is how a model comes to show two
 * prices. Null when there is no parseable price — never 0, which would read as
 * free.
 */
export function pricePerMillion(perToken: unknown): number | null {
  if (perToken == null || perToken === '') return null
  const n = Number(perToken)
  if (!Number.isFinite(n) || n < 0) return null
  // Round away float noise (0.15000000000000002 → 0.15)
  return Math.round(n * 1_000_000 * 10_000) / 10_000
}

/** One endpoint of a model, as much of it as the tier decision needs. */
export interface TierEndpoint {
  tag: string
  /** Display name, e.g. "Google Vertex". Null when the listing omits it. */
  providerName: string | null
  tier: EndpointTier
  /** USD per 1M tokens, this endpoint's own price — tier endpoints are billed at it. */
  inputCostPerMillion: number | null
  outputCostPerMillion: number | null
  /** Null = the endpoint declares nothing (unknown), never "supports nothing". */
  supportedParameters: string[] | null
}

/**
 * What the endpoints listing says about one model.
 *
 * `null` where this type is expected means UNKNOWN — the listing could not be
 * read — and is deliberately a different value from `{ endpoints: [] }`, which
 * is a model OpenRouter answered for and lists nothing (or does not know: a
 * 404). The send decision treats the two oppositely.
 */
export interface ServiceTierFacts {
  endpoints: TierEndpoint[]
}

/**
 * Read the endpoints response. Null when the body is not the documented shape,
 * which the caller treats as unknown rather than as "no flex".
 */
export function parseEndpointsResponse(json: unknown): ServiceTierFacts | null {
  const data = (json as { data?: { endpoints?: unknown } } | null)?.data
  const raw = data?.endpoints
  if (!Array.isArray(raw)) return null

  const endpoints: TierEndpoint[] = []
  for (const entry of raw) {
    const e = entry as {
      tag?: unknown
      provider_name?: unknown
      pricing?: { prompt?: unknown; completion?: unknown }
      supported_parameters?: unknown
    }
    if (typeof e?.tag !== 'string' || e.tag.trim() === '') continue
    endpoints.push({
      tag: e.tag,
      providerName: typeof e.provider_name === 'string' && e.provider_name ? e.provider_name : null,
      tier: endpointTier(e.tag),
      inputCostPerMillion: pricePerMillion(e.pricing?.prompt),
      outputCostPerMillion: pricePerMillion(e.pricing?.completion),
      supportedParameters: Array.isArray(e.supported_parameters)
        ? e.supported_parameters.filter((p): p is string => typeof p === 'string')
        : null,
    })
  }
  return { endpoints }
}

export function flexEndpoints(facts: ServiceTierFacts | null | undefined): TierEndpoint[] {
  return facts?.endpoints.filter((e) => e.tier === 'flex') ?? []
}

/**
 * The tiers this model can be offered. Empty means offer no choice.
 *
 * One function so the card's control, the save route's validation and the
 * request builder cannot disagree — `reasoningEffortsFor`'s rule.
 */
export function serviceTierOptionsFor(
  facts: ServiceTierFacts | null | undefined
): readonly ServiceTierOption[] {
  return flexEndpoints(facts).length > 0 ? SERVICE_TIER_OPTIONS : []
}

/**
 * The parameters this app may put on a request, which are the only ones whose
 * absence on a flex endpoint is worth reporting.
 *
 * The guide warns that "a flex tier with fewer supported parameters declares
 * those differences in its own document", and routing under `service_tier:
 * "flex"` is confined to flex endpoints — so a chat role whose model takes
 * `tools` on its standard endpoints and not on its flex one would lose tool
 * calling the moment flex is chosen. Reporting every missing parameter would
 * bury that under `logprobs` and `top_logprobs`, which nothing here sends.
 */
export const APP_SENT_PARAMETERS = [
  'tools',
  'reasoning',
  'temperature',
  'top_p',
  'response_format',
  'structured_outputs',
] as const

/** The cheapest endpoint by input price, then output — what price-sorted routing tries first. */
function cheapest(endpoints: TierEndpoint[]): TierEndpoint | null {
  const priced = endpoints.filter((e) => e.inputCostPerMillion != null)
  if (priced.length === 0) return null
  return [...priced].sort(
    (a, b) =>
      (a.inputCostPerMillion as number) - (b.inputCostPerMillion as number) ||
      (a.outputCostPerMillion ?? Number.POSITIVE_INFINITY) -
        (b.outputCostPerMillion ?? Number.POSITIVE_INFINITY)
  )[0]
}

/**
 * What the card and the connection test say about flex for one model.
 *
 * `status` carries the three-way distinction the facts do: `unknown` is not
 * `unavailable`, and a card that collapsed them would tell an operator a model
 * has no flex tier when the truth is that OpenRouter did not answer.
 */
export interface FlexSummary {
  status: 'available' | 'unavailable' | 'unknown'
  /** Who serves flex, by display name, de-duplicated, in listing order. */
  providers: string[]
  /** The cheapest flex endpoint's price. Flex routing is sorted by price. */
  inputCostPerMillion: number | null
  outputCostPerMillion: number | null
  /** The cheapest standard endpoint's price, for the comparison. */
  standardInputCostPerMillion: number | null
  standardOutputCostPerMillion: number | null
  /**
   * Of {@link APP_SENT_PARAMETERS}: declared by a standard endpoint and by no
   * flex endpoint. Empty when nothing is missing AND when a flex endpoint
   * declares no list at all — unknown is not missing.
   */
  missingParameters: string[]
}

export function summarizeFlex(facts: ServiceTierFacts | null | undefined): FlexSummary {
  const empty = {
    providers: [],
    inputCostPerMillion: null,
    outputCostPerMillion: null,
    standardInputCostPerMillion: null,
    standardOutputCostPerMillion: null,
    missingParameters: [],
  }
  if (!facts) return { status: 'unknown', ...empty }

  const flex = flexEndpoints(facts)
  if (flex.length === 0) return { status: 'unavailable', ...empty }

  const standard = facts.endpoints.filter((e) => e.tier === 'default')
  const flexCheapest = cheapest(flex)
  const standardCheapest = cheapest(standard)

  let missingParameters: string[] = []
  if (flex.every((e) => e.supportedParameters != null)) {
    const onFlex = new Set(flex.flatMap((e) => e.supportedParameters ?? []))
    const onStandard = new Set(standard.flatMap((e) => e.supportedParameters ?? []))
    missingParameters = APP_SENT_PARAMETERS.filter((p) => onStandard.has(p) && !onFlex.has(p))
  }

  return {
    status: 'available',
    providers: [...new Set(flex.map((e) => e.providerName ?? e.tag.split('/')[0]))],
    inputCostPerMillion: flexCheapest?.inputCostPerMillion ?? null,
    outputCostPerMillion: flexCheapest?.outputCostPerMillion ?? null,
    standardInputCostPerMillion: standardCheapest?.inputCostPerMillion ?? null,
    standardOutputCostPerMillion: standardCheapest?.outputCostPerMillion ?? null,
    missingParameters,
  }
}

/**
 * The tier stored on a config, or undefined for the default.
 *
 * Unrecognised is DROPPED here and refused at the save route, the split
 * `apiKeyScopes.ts` makes: right for a value already stored (a hand-edited
 * `priority` must not start costing more), wrong for one somebody is asking
 * for. A stored `default` also reads as undefined — it is the absence of a
 * tier, not a tier to send.
 */
export function resolveServiceTier(
  config: { serviceTier?: unknown } | null | undefined
): StoredServiceTier | undefined {
  const raw = config?.serviceTier
  if (typeof raw !== 'string') return undefined
  return raw.trim().toLowerCase() === 'flex' ? 'flex' : undefined
}

/**
 * The response's report of which tier served the call, normalised.
 *
 * The guide: the Chat Completions response carries `service_tier` at the top
 * level, `null` "when no service tier is available from upstream", and Google's
 * `standard` is normalised to `default` — except on the Messages API, which
 * keeps `standard`. Both spellings land on `default` here so the caller has one
 * word to compare against.
 */
export function normalizeServedTier(value: unknown): EndpointTier | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (v === 'default' || v === 'standard') return 'default'
  return TIER_SEGMENTS[v] ?? null
}

export interface ServiceTierDelivery {
  /**
   * Merged into the model instance's `extraBody`, which `@openrouter/ai-sdk-provider`
   * spreads into every request body that instance builds — streamed or not.
   * Absent means send nothing.
   */
  extraBody?: { service_tier: StoredServiceTier }
  /**
   * Why a tier that WAS asked for is not being sent. Null when it is being
   * sent, and also when none was asked for — the caller warns only on the
   * first, and the two are not the same event.
   *
   * `provider` — only OpenRouter takes this field.
   * `model` — the listing was read and names no flex endpoint.
   */
  undeliverable: 'provider' | 'model' | null
  /**
   * Sent although the listing could not be read. The caller logs it, because it
   * is the one case where the request carries a field nothing confirmed.
   */
  unverified: boolean
}

/**
 * The one place a stored tier becomes a request field.
 *
 * The asymmetry is the INVERSE of ./generationParams.ts, and deliberately so.
 * There, a parameter the model does not declare is dropped, because OpenRouter
 * drops it too and a hopeful send buys a setting that does nothing. Here, when
 * the listing could not be read at all, the tier is SENT: OpenRouter documents
 * that a flex request with no flex endpoint "routes normally at standard rates",
 * so the hopeful send cannot produce a request the operator did not choose —
 * while dropping it would turn a transient lookup failure into a silent doubling
 * of the bill for as long as the outage lasts. A listing that WAS read and names
 * no flex endpoint is a fact, and then nothing is sent.
 */
export function resolveServiceTierDelivery(input: {
  provider: string
  tier: StoredServiceTier | undefined
  facts: ServiceTierFacts | null
}): ServiceTierDelivery {
  const { provider, tier, facts } = input
  if (!tier) return { undeliverable: null, unverified: false }
  if (provider !== 'openrouter') return { undeliverable: 'provider', unverified: false }
  if (facts == null) return { extraBody: { service_tier: tier }, undeliverable: null, unverified: true }
  if (!serviceTierOptionsFor(facts).includes(tier)) return { undeliverable: 'model', unverified: false }
  return { extraBody: { service_tier: tier }, undeliverable: null, unverified: false }
}

/**
 * The roles that apply a tier, and therefore the only ones allowed to store one.
 *
 * EVERY language role, which is a wider list than the reasoning effort's or the
 * sampling knobs' — and the difference is coverage, not enthusiasm. Those two
 * are call options, so each reaches a model only at the call sites that pass
 * it, and `ROLES_WITH_GENERATION_PARAMS` is one role long because the others
 * have call sites nobody wired. The tier is attached to the MODEL INSTANCE at
 * construction (`extraBody`, below the call options), and every one of these
 * roles builds its model in exactly one getter — so every call the role makes
 * carries it, by construction, with no call site to forget.
 *
 * Not `embeddings`: tiers are documented for the Chat Completions, Responses
 * and Messages APIs, and an embedding set's identity would need to know about
 * it (F-093) for no measured gain. Not `webSearch`: it is Google-only.
 */
export const ROLES_WITH_SERVICE_TIER = ['chat', 'textGeneration', 'exploration', 'titleAnalysis'] as const

export function roleReadsServiceTier(fn: string): boolean {
  return (ROLES_WITH_SERVICE_TIER as readonly string[]).includes(fn)
}
