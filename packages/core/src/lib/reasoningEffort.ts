/**
 * How hard a model is asked to think, for the roles that pay for thinking twice.
 *
 * WHY THIS EXISTS. A reasoning model bills its scratchpad from the SAME output
 * allowance as the prose it finally writes, so on a batch role the budget is
 * spent silently and the visible symptom is a truncation. Measured on the
 * explanations path: reasoning swung between 0 and 2,283 tokens against a 3,000
 * ceiling, which is why `explanationBatchSettings` now hands large-context
 * models 16,000 — headroom bought to survive a scratchpad nobody asked for. The
 * title-analysis writer hit the identical failure and answers it the same way,
 * with `analysisMaxOutputTokens` defaulting to 8,000. Raising the ceiling treats
 * the symptom; capping the scratchpad treats the cause.
 *
 * THE VOCABULARY IS DATA, NOT A TYPE. This module shipped once with a fixed
 * `minimal | low | medium | high` union and that was wrong in three directions
 * at once. Measured against OpenRouter's live catalog (418 models): 124 models
 * do not reason at all; 140 reason but expose no effort parameter (deepseek-r1
 * among them); the 147 that do draw on **21 distinct vocabularies** built from
 * seven words, and no model offers all seven. Anthropic's take `max` and reject
 * `minimal`. OpenAI's take `xhigh` and `none`. Google's take `minimal` and
 * neither of the others. So a union offers words the model rejects, hides words
 * it accepts, and cannot grow when a vendor adds one.
 *
 * Instead every answer here is derived from what the MODEL declares:
 *
 *   - OpenRouter publishes `reasoning.supported_efforts` per model, refreshed
 *     daily by `openrouter-capabilities.ts`. Live data, exact-id match.
 *   - Native Google declares {@link ReasoningMechanism} `thinkingLevel` per
 *     model in the catalog JSON, and the vocabulary is then fixed by the SDK
 *     (see {@link THINKING_LEVELS}).
 *   - Everything else declares nothing and gets no control. Absent is a
 *     positive fact, exactly as it is for `inputTypeMechanism`.
 *
 * ABSENT MEANS SEND NOTHING. Every role stored before this field existed, and
 * every role whose operator has not chosen, must produce byte-identical
 * requests to what shipped before it — so the resolver returns `undefined`
 * rather than a default effort. That is not timidity: which effort suits a
 * given model is unmeasured here, and this repo does not threshold blind.
 *
 * Pure, so the mapping can be pinned without a provider, a key or a database.
 * The one impure part — asking the catalog what a given OpenRouter model
 * accepts — lives in `ai-provider.ts`, which already owns the cache.
 */

/**
 * HOW an effort instruction reaches a model. Absent means it takes none.
 *
 * `effort` — a provider-level unified parameter (OpenRouter's
 * `reasoning.effort`). Normalising this across a catalog is what OpenRouter is
 * *for*, and the accepted words come from the catalog per model.
 *
 * `thinkingLevel` — Google's `thinkingConfig.thinkingLevel`, which the SDK puts
 * on the wire as `thinking_level`. A **Gemini 3.x** field: Gemini 2.5 uses a
 * different one (`thinkingBudget`, a token count, deliberately not mapped here
 * — turning an effort word into a token count is a number nobody has measured)
 * and 1.5 has no thinking at all. Sending `thinking_level` to either is a 400,
 * which is exactly what a provider-level guard would have shipped for three of
 * the seven models in `google.json`.
 */
export type ReasoningMechanism = 'effort' | 'thinkingLevel'

/**
 * The provider that owns each mechanism's `providerOptions` namespace.
 *
 * Spelled as a table rather than inferred, because the namespace key MUST be
 * the provider id — the SDK hands `providerOptions.<id>` to that provider and
 * silently ignores every other key, so a mismatch is not an error, it is a
 * setting that saves, displays and does nothing.
 */
const MECHANISM_PROVIDER: Record<ReasoningMechanism, string> = {
  effort: 'openrouter',
  thinkingLevel: 'google',
}

/**
 * The vocabulary for `thinkingLevel`, fixed by `@ai-sdk/google`.
 *
 * Not read from anywhere because there is nowhere to read it from: the SDK
 * validates this field against a zod `enum(['minimal','low','medium','high'])`
 * before the request is built, so an off-list value throws locally rather than
 * reaching Google. That makes this a hard boundary rather than a guess — and it
 * is why the Google path needs no live lookup while the OpenRouter one does.
 */
export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value)
}

/**
 * Every effort word seen in the live catalog, weakest first.
 *
 * This is a DISPLAY ORDER and a label key set — never a filter. Nothing is
 * dropped for being absent from it: OpenRouter's field is an open string and a
 * vendor may add a word tomorrow, so an unrecognised value is offered as-is and
 * labelled with its own name. Filtering here would hide a capability the model
 * genuinely has, which is the failure this module was rebuilt to stop making.
 */
export const KNOWN_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

/** The facts a model declares about reasoning. Structurally a `ModelMetadata`. */
export interface ReasoningCapableModel {
  reasoningMechanism?: ReasoningMechanism
  /** Live, per model, for the `effort` mechanism. Ignored for `thinkingLevel`. */
  supportedEfforts?: readonly string[]
}

/**
 * What this model actually accepts. Empty means "offer no control".
 *
 * One function so the offered list, the saved value and the sent field cannot
 * disagree: the settings dropdown, the settings route's validation and the
 * request builder all ask this same question and get the same answer.
 */
export function reasoningEffortsFor(
  model: ReasoningCapableModel | null | undefined
): readonly string[] {
  const mechanism = model?.reasoningMechanism
  if (!mechanism) return []
  // The SDK's enum is the authority here, not the catalog: a `thinkingLevel`
  // model's list is fixed and any wider claim would throw before the wire.
  if (mechanism === 'thinkingLevel') return THINKING_LEVELS
  return model?.supportedEfforts ?? []
}

/** Sort a model's own list into the familiar weak→strong order for display. */
export function orderReasoningEfforts(efforts: readonly string[]): readonly string[] {
  const rank = (e: string) => {
    const i = (KNOWN_REASONING_EFFORTS as readonly string[]).indexOf(e)
    // An unrecognised word sorts after every known one rather than being
    // dropped — see KNOWN_REASONING_EFFORTS.
    return i === -1 ? KNOWN_REASONING_EFFORTS.length : i
  }
  return [...efforts].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/**
 * The effort stored on a config, trimmed and lower-cased — or `undefined`.
 *
 * Normalisation only. Whether the value is *acceptable* depends on the model
 * and is decided by {@link resolveReasoningOptions}, which has the model's list;
 * deciding it here would need a vocabulary, which is the thing this module no
 * longer has.
 */
export function resolveReasoningEffort(
  config: { reasoningEffort?: string } | null | undefined
): string | undefined {
  const raw = config?.reasoningEffort
  if (typeof raw !== 'string') return undefined
  const normalized = raw.trim().toLowerCase()
  return normalized === '' ? undefined : normalized
}

/**
 * What to put in `providerOptions`, keyed by the provider's own namespace.
 *
 * OpenRouter's `effort` is typed `'high' | 'medium' | 'low'` by
 * `@openrouter/ai-sdk-provider@1.5.4`, which is a stale narrow annotation
 * rather than an enforcement: `doGenerate` spreads `providerOptions.openrouter`
 * verbatim into the request body with no schema in the way (the same mechanism
 * F-038 records for `extraBody` on the embeddings side), so `xhigh`, `max`,
 * `minimal` and `none` all reach the wire. Typed as the open string the wire
 * takes, since narrowing to the annotation would drop words the catalog says
 * the model accepts.
 */
export type ReasoningProviderOptions =
  | { openrouter: { reasoning: { effort: string } } }
  | { google: { thinkingConfig: { thinkingLevel: ThinkingLevel } } }

export interface ReasoningDelivery {
  /** Spread into the call's `providerOptions`; absent means send nothing. */
  providerOptions?: ReasoningProviderOptions
  /**
   * Why an effort that WAS asked for is not being sent. `null` when it is being
   * sent, and also when none was asked for — the caller logs only the first,
   * and the two are not the same event.
   *
   * `model` — this model declares no mechanism, so it takes no effort.
   * `provider` — the mechanism belongs to a different provider's namespace.
   * `effort` — the model has a vocabulary and this word is not in it.
   */
  undeliverable: 'model' | 'provider' | 'effort' | null
}

/**
 * The one place an effort becomes a request field.
 *
 * NOTHING IS ROUNDED. An effort the model does not list is reported
 * undeliverable and nothing is sent, leaving the provider's own default. Mapping
 * `minimal` onto `low` for a model that lacks `minimal` would make the settings
 * page and the wire disagree about what was asked for — the same class of fault
 * as an embedding set id naming a mode the vectors were never embedded in — and
 * the silent direction of that error is *cheaper thinking than asked for*, which
 * shows up as quality nobody can trace. Falling back to the default errs toward
 * more thinking, which shows up as cost an operator can see.
 *
 * The model's own list is the authority for BOTH providers, which is what makes
 * this safe to call without knowing which of OpenRouter's 418 models an operator
 * typed in.
 */
export function resolveReasoningOptions(input: {
  provider: string
  model: ReasoningCapableModel | null | undefined
  effort: string | undefined
}): ReasoningDelivery {
  const { provider, model, effort } = input

  if (!effort) return { undeliverable: null }

  const mechanism = model?.reasoningMechanism
  if (!mechanism) return { undeliverable: 'model' }
  if (MECHANISM_PROVIDER[mechanism] !== provider) return { undeliverable: 'provider' }

  const supported = reasoningEffortsFor(model)
  if (!supported.includes(effort)) return { undeliverable: 'effort' }

  if (mechanism === 'thinkingLevel') {
    // Unreachable given the check above, since `reasoningEffortsFor` returns
    // exactly THINKING_LEVELS for this mechanism. Kept because it is what
    // narrows the type, and because the SDK throws rather than ignoring an
    // off-list value — a guard whose absence would be a crash, not a no-op.
    if (!isThinkingLevel(effort)) return { undeliverable: 'effort' }
    return {
      providerOptions: { google: { thinkingConfig: { thinkingLevel: effort } } },
      undeliverable: null,
    }
  }

  return {
    providerOptions: { openrouter: { reasoning: { effort } } },
    undeliverable: null,
  }
}

/**
 * The roles that actually READ this, and therefore the only ones allowed to
 * store it.
 *
 * Both write short structured prose from data already assembled for them — the
 * shape of work needing the least deliberation, and the shape whose failure mode
 * is a truncated answer rather than a slow one. `chat` is deliberately absent:
 * it is interactive, a reader is watching, and thinking is often the point.
 *
 * A role that stored an effort nothing reads would be a setting an operator can
 * see, save and believe in while no request changes — the same fault the
 * mechanism check above refuses one level down.
 */
export const ROLES_WITH_REASONING_EFFORT = ['textGeneration', 'titleAnalysis'] as const

export function roleReadsReasoningEffort(fn: string): boolean {
  return (ROLES_WITH_REASONING_EFFORT as readonly string[]).includes(fn)
}
