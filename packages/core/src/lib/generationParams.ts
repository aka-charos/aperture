/**
 * The two sampling knobs a role may set, and the rule for when they exist.
 *
 * WHY THIS EXISTS. Nothing in this app could change how a model samples. Every
 * generation ran at whatever temperature the provider defaults to, which for
 * most of them is 1.0 — a setting chosen for open-ended chat and applied
 * unchanged to a role that writes one structured document from source text it
 * was handed. The title-analysis writer is the case that made it visible: its
 * faults are comprehension faults (see ../analysis/prompt.ts, version 8), and
 * the only way to find out whether sampling has anything to do with adherence
 * at all is to be able to vary it and read the output. That is a measurement
 * this repo could not take.
 *
 * "EVERY MODEL ACCEPTS TEMPERATURE" IS FALSE, and it was this module's first
 * premise. Measured against OpenRouter's live `/api/v1/models` (439 entries,
 * 2026-09-11): **352 declare `temperature` and 87 do not**, and 334 declare
 * `top_p` against 105 that do not. The refusers are not obscure —
 * `anthropic/claude-sonnet-5`, `anthropic/claude-opus-5:batch`,
 * `anthropic/claude-fable-5.1`, `openai/gpt-6-astra`, the whole
 * `openai/gpt-5.6-*` family, every `google/gemini-3.x-flash:batch` variant and
 * `openrouter/fusion`. So a knob offered on the strength of "they all take it"
 * is a knob that does nothing on a fifth of the catalogue, which is the exact
 * failure ./reasoningEffort.ts was rebuilt to stop making.
 *
 * SO THE MODEL DECLARES IT, exactly as it declares its effort vocabulary.
 * OpenRouter publishes `supported_parameters` per model and
 * `openrouter-capabilities.ts` has cached it since CACHE_VERSION 3 — it is
 * already what answers "does this model support tools" — so this needs no new
 * fetch and no cache bump. A model that declares nothing is offered nothing:
 * absent is a positive fact here too.
 *
 * WHICH MEANS THIS IS OPENROUTER-ONLY TODAY, deliberately and not by oversight.
 * `temperature` is a plain top-level field on every OpenAI-compatible endpoint
 * and would almost certainly work against LM Studio, Z.AI or native Google —
 * but "almost certainly" is how F-097 shipped a mode that was sent, ignored,
 * and written into a stored identity anyway. A provider joins this list when
 * something has verified what it accepts, the way each `ReasoningMechanism`
 * did.
 *
 * ABSENT MEANS SEND NOTHING. No defaults and no rounding: a role that has never
 * been given a value builds the byte-identical request it built before this
 * module existed. The suggestions below are PLACEHOLDERS the UI shows in an
 * empty field, never values written on anyone's behalf — "unset" and "set to
 * the number we suggest" are different states and must stay distinguishable.
 *
 * Pure, so the mapping can be pinned without a provider, a key or a database.
 * The impure half — asking the catalogue what a model accepts — lives in
 * `ai-provider.ts`, which already owns that cache.
 */

/**
 * The parameters this module can deliver, spelled as the WIRE names.
 *
 * `temperature` and `top_p`, matching OpenRouter's `supported_parameters`
 * vocabulary, so a declaration can be read with `includes` and no mapping table
 * sits between what the catalogue says and what is offered. The AI SDK spells
 * the second one `topP`; that difference is handled once, at the boundary,
 * rather than becoming a second vocabulary.
 */
export type GenerationParameter = 'temperature' | 'top_p'

/**
 * Display order, which is also the order they are worth reaching for.
 *
 * Both are offered because both are declared, not because both should be set:
 * temperature and top_p are two ways to narrow one distribution, and vendor
 * guidance is uniformly to move one and leave the other alone. The card says
 * so; nothing enforces it, because "the operator set both" is a legible
 * configuration and refusing it would be this module inventing a rule the
 * provider does not have.
 *
 * DELIBERATELY NOT WIDER. `deepseek/deepseek-v4.1-flash` also declares
 * `top_k`, `min_p`, `seed`, and all three penalties, and each was considered.
 * The penalties are the wrong instrument for the faults that prompted this —
 * they punish every repeated token, including the crew names the analysis
 * prompt's specificity rule demands. `seed` is genuinely useful, but it belongs
 * to the bench rather than to a role: it buys a repeatable comparison and costs
 * a library pass its variety, and only 331 of 439 models take it.
 */
export const GENERATION_PARAMETERS = ['temperature', 'top_p'] as const

/**
 * What the parameters accept, and why these bounds rather than none.
 *
 * OpenRouter documents temperature as 0.0–2.0 and top_p as 0.0–1.0, and those
 * are the bounds enforced here. The check is at the EDGES only — nothing in
 * between is judged, because which value suits a given model and role is
 * precisely the unmeasured thing this feature exists to let someone measure,
 * and this repo does not threshold blind.
 *
 * `top_p: 0` is excluded rather than accepted: it is not a low setting, it is a
 * request for an empty nucleus, and endpoints disagree about what to do with
 * it. A temperature of 0 IS meaningful — greedy decoding — and is allowed.
 */
export const GENERATION_PARAM_RANGES: Record<
  GenerationParameter,
  { min: number; max: number; step: number }
> = {
  temperature: { min: 0, max: 2, step: 0.05 },
  top_p: { min: 0.01, max: 1, step: 0.01 },
}

/**
 * What to put in an empty field, per role. A HINT, never a stored value.
 *
 * These are this app's suggestions and the card labels them as such, because
 * the one place a vendor recommendation could have come from is empty:
 * OpenRouter publishes a `default_parameters` object per model — 271 of 439
 * entries carry one — and for `deepseek/deepseek-v4.1-flash`, the model this
 * was built to tune, it is `{}`. Reading it and finding nothing is worse than
 * not reading it, so it is not read.
 *
 * The shape of the suggestion follows the shape of the work rather than any
 * measurement, and the card states that: a role writing one document from
 * documents it was handed wants to be led by its sources, while a conversation
 * does not. Nothing here claims a number beats the provider default.
 */
export const SUGGESTED_GENERATION_PARAMS: Record<string, { temperature: number; topP: number }> = {
  titleAnalysis: { temperature: 0.3, topP: 0.9 },
  textGeneration: { temperature: 0.7, topP: 0.95 },
  chat: { temperature: 1, topP: 1 },
}

/** The facts a model declares about sampling. Structurally a `ModelMetadata`. */
export interface SamplingCapableModel {
  /**
   * Wire-name parameters the model accepts, live from the provider's catalogue.
   * Absent means nothing is known and therefore nothing is offered — not that
   * everything is accepted.
   */
  supportedParameters?: readonly string[]
}

/**
 * Which of the two this model accepts. Empty means offer no control.
 *
 * One function so the offered fields, the saved values and the sent fields
 * cannot disagree: the settings card, the save route's validation and the
 * request builder all ask this and get the same answer.
 */
export function generationParamsFor(
  model: SamplingCapableModel | null | undefined
): readonly GenerationParameter[] {
  const declared = model?.supportedParameters
  if (!declared?.length) return []
  return GENERATION_PARAMETERS.filter((p) => declared.includes(p))
}

/** A number that is really a number, in range, or undefined. */
function readParam(raw: unknown, param: GenerationParameter): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const { min, max } = GENERATION_PARAM_RANGES[param]
  if (raw < min || raw > max) return undefined
  return raw
}

/**
 * The sampling values stored on a config, normalised. Out of range reads as
 * unset rather than being clamped.
 *
 * CLAMPING WOULD BE THE WRONG REPAIR, for `resolveReasoningOptions`' reason one
 * module over: a value silently moved makes the settings page and the wire
 * disagree about what was asked for, and the direction of that error is a
 * request nobody chose. Refusing leaves the provider default, which is the
 * state every role was in before this existed and the one an operator can
 * reason about.
 */
export function resolveGenerationParams(
  config: { temperature?: number; topP?: number } | null | undefined
): { temperature?: number; topP?: number } {
  const temperature = readParam(config?.temperature, 'temperature')
  const topP = readParam(config?.topP, 'top_p')
  return {
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { topP } : {}),
  }
}

export interface GenerationParamsDelivery {
  /** Spread into the call's options; an absent key means send nothing. */
  params: { temperature?: number; topP?: number }
  /**
   * Values that WERE set and are not being sent, by wire name. Empty when
   * everything set is being sent, and also when nothing was set — the caller
   * logs only the first, and the two are not the same event.
   */
  undeliverable: GenerationParameter[]
}

/**
 * The one place a stored number becomes a request field.
 *
 * A value the model does not declare is dropped and reported, never sent on the
 * chance that it works. OpenRouter's own behaviour makes that the cheap choice
 * rather than the strict one: it drops parameters an upstream does not support
 * instead of erroring, so sending `temperature` to a model that refuses it
 * produces a setting an operator can see, save, and never observe — which is
 * indistinguishable from the setting having no effect on that model's writing.
 * Reporting it is the only way the difference reaches anyone.
 */
export function resolveGenerationDelivery(input: {
  model: SamplingCapableModel | null | undefined
  params: { temperature?: number; topP?: number }
}): GenerationParamsDelivery {
  const { model, params } = input
  const supported = generationParamsFor(model)

  const out: { temperature?: number; topP?: number } = {}
  const undeliverable: GenerationParameter[] = []

  if (params.temperature != null) {
    if (supported.includes('temperature')) out.temperature = params.temperature
    else undeliverable.push('temperature')
  }
  if (params.topP != null) {
    if (supported.includes('top_p')) out.topP = params.topP
    else undeliverable.push('top_p')
  }

  return { params: out, undeliverable }
}

/**
 * The roles that actually READ these, and therefore the only ones allowed to
 * store them.
 *
 * ONE ROLE, and the reason is coverage rather than caution. A sampling value is
 * a top-level option on the generation call, so it reaches a model only at the
 * call sites that pass it — and `textGeneration` has eight of them
 * (`channels/reasons.ts`, `channels/ai.ts`, `ai-playlist-generation.ts`, both
 * taste synopses, both explanation generators, the discovery structuring pass),
 * three of which choose between `textGeneration` and `chat` at runtime, so the
 * role whose value should apply is not even known to the caller. Wiring some of
 * them would ship a knob that works on recommendation explanations and silently
 * does nothing on playlists — a control that appears to work, which is worse
 * than an absent one.
 *
 * `titleAnalysis` has exactly two call sites, both already resolving reasoning
 * per attempt, so it can be covered completely today. The others join when
 * their call sites are wired, in one change each, not by widening this list.
 */
export const ROLES_WITH_GENERATION_PARAMS = ['titleAnalysis'] as const

export function roleReadsGenerationParams(fn: string): boolean {
  return (ROLES_WITH_GENERATION_PARAMS as readonly string[]).includes(fn)
}
