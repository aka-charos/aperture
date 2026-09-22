/**
 * Prompt variants: alternative questions and rules that sit BESIDE a version
 * rather than after it.
 *
 * WHY THESE EXIST. A version is a decision about what every stored analysis in
 * the library should say, and bumping one retires all of them. A variant is a
 * different question: what to send a model that cannot hold the current prompt.
 *
 * SO A VARIANT IS NOT A DRAFT. A draft is the next version, benched before it
 * retires the library. A variant is never promoted and never becomes current:
 * it is a second prompt for a second class of model, and both stay.
 *
 * IT IS THE SAME SHAPE AS AN EDITION, deliberately - only questions and rules,
 * so everything above the TASK line and the whole output contract are byte-for
 * byte what every other prompt sends. That is what lets the bench put a variant
 * beside its base version on one retrieval and attribute the difference to the
 * prompt. `prompt.test.ts` pins it.
 *
 * IT KEEPS ITS BASE VERSION'S QUESTION IDS, which is not decoration: the
 * paragraph map is parsed against `questionIdsFor(mediaType, version)`, so a
 * variant that renamed a question would have every label discarded and every
 * label-derived signal read as unmeasured.
 *
 * THE LIBRARY MAY WRITE WITH ONE, UNDER TWO CONDITIONS. It is opt-in per
 * instance on the Title Analysis role (`ProviderConfig.analysisPromptVariant`),
 * and `title_analysis.prompt_variant` (0180) records which prompt wrote each
 * row - without that column the library holds two kinds of article under one
 * version number and nothing can tell them apart. The second condition is
 * `libraryVariantFor`'s: a variant may only write while its base IS the current
 * version, or a row would file one version's questions under another's number.
 *
 * ---------------------------------------------------------------------------
 *
 * THIS BUILD CARRIES NONE, AND THE MECHANISM STAYS ANYWAY.
 *
 * The one variant, `compact`, was written against `ornith-1.5-9b` on version
 * 15 and removed when 16 was promoted. Two reasons, and the first is that its
 * job is done: version 16 was BUILT from it, so the things compact was written
 * to fix - per-question budgets, the work question naming where to look, flat
 * counted rules instead of long conditionals - are in the current prompt for
 * every model. The second is that it did not work for the model it was for.
 * `ornith-1.5-9b` failed the OUTPUT CONTRACT on all four of its benched
 * answers - the paragraph map under version 15, the closing contract line and
 * the paragraph count under 16 - and the failure was never the prose rules a
 * variant can shorten. A second prompt is not the answer to a model that
 * cannot hold the format; another model is, which is what
 * `ProviderConfig.fallbackModels` is for.
 *
 * NOTHING STORED BREAKS. `variantFor` is only ever called for a variant
 * somebody selected, and the picker now offers none. `libraryVariantFor`
 * returns null for an id this build has dropped, which is the silent refusal it
 * was written for, so an instance still configured for `compact` falls back to
 * the version's own prompt instead of failing every title. Rows in
 * `title_analysis.prompt_variant` and `analysis_comparison_results.prompt_variant`
 * keep their label, and `promptChoiceLabel` formats it from the stored string
 * rather than looking it up - so an archived bench run still reads "v15
 * compact". The text itself is recoverable from git and from the `prompts`
 * column of any run that sent it.
 *
 * TO ADD ONE: put it in this array. Nothing else enumerates them.
 *
 * PURE AND DB-FREE, like ./promptEditions.ts beside it.
 */
import type { PromptVariant } from './prompt.js'

/**
 * Every variant this build carries, in the order the picker offers them.
 *
 * Empty is a supported state, not a gap: the bench simply offers versions.
 */
export const PROMPT_VARIANTS: readonly PromptVariant[] = []
