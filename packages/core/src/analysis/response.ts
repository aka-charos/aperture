/**
 * Decide whether the writing model actually answered.
 *
 * THIS MODULE EXISTS BECAUSE A REASONING MODEL SPENT THE WHOLE OUTPUT BUDGET
 * THINKING AND WE STORED THE THOUGHTS. Measured live on the first real pass:
 * the `titleAnalysis` role pointed at `nvidia/nemotron-3.5-lightning:free`,
 * which emits its chain of thought as ordinary content rather than as a
 * separate reasoning part. For *Spring, Summer, Fall, Winter... And Spring* it
 * produced 8,852 characters beginning "Here's a thinking process:", walking
 * through the task and each source in turn, and ran out of tokens mid-sentence
 * in the middle of source [5]. It never wrote a word of the analysis. That text
 * was stored, and the detail page rendered it under "About this Film".
 *
 * Every guard let it through, and the reason each one did is worth keeping:
 *
 *  * `writeFromSources` never looked at `finishReason`, so the direct tell that
 *    the answer was cut off — `'length'` — was returned by the SDK and dropped.
 *  * `parseAnalysisResponse` looked for the closing `SOURCES:` line, did not
 *    find one, and FELL BACK to returning the entire raw string with a null
 *    grade. The contract's own failure signal was computed and then discarded.
 *  * `decideAnalysisFloor` measures whether the text is too SHORT
 *    (`MIN_ANALYSIS_CHARS`). A runaway is invisible to a floor, and 8,852 sails
 *    over 400.
 *
 * This is the `explanationParsing` incident in a second module: there too a
 * reasoning model's thinking was billed from the same ceiling as the prose, and
 * there too the failure produced confident-looking output rather than an error.
 * The lesson did not travel because the two modules share no code — so the
 * checks live here, pure and pinned, rather than inline in `generate.ts`.
 *
 * WHY THESE FAILURES THROW RATHER THAN DECLINE. A decline is stored and
 * permanent (the title is retired until `ANALYSIS_PROMPT_VERSION` moves). "The
 * model did not follow the output contract" is a fact about the MODEL, not
 * about the film — point the role at a model that can and the same title
 * succeeds. Storing it would retire a library over a settings mistake, which is
 * the exact shape of the OMDb-401 and `enrichment_version` incidents. So these
 * leave the row unwritten and the title pending, and the operator gets a loud
 * repeated failure naming the model, which is the thing that actually needs
 * changing.
 */

/** Why a response cannot be read as an answer. */
export type ResponseProblem =
  | { kind: 'truncated' }
  | { kind: 'reasoning_only' }
  | { kind: 'no_contract_line' }

/**
 * Remove reasoning the model wrapped in explicit tags.
 *
 * DELIBERATELY ONLY THE DELIMITED FORM. Several models emit `<think>…</think>`
 * around their scratchpad, which is unambiguous and safe to cut. A prose
 * preamble ("Here's a thinking process:") is NOT handled here and must not be:
 * guessing where thinking stops and the answer starts is precisely the salvage
 * regex that shipped in `explanationParsing` and produced a worse failure than
 * the one it fixed — sentence fragments stored as finished explanations. The
 * contract check below rejects those instead, which costs a retry and cannot
 * invent an answer.
 *
 * An UNCLOSED opening tag means the model was still thinking when it ran out of
 * room, so everything after it is scratchpad and the result is empty — which
 * `findResponseProblem` reports as `reasoning_only` rather than as an answer.
 */
export function stripReasoningBlocks(raw: string): string {
  return raw
    .replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*$/i, '')
    .trim()
}

export interface ResponseCheckInput {
  /** The prose, after reasoning tags are stripped and the SOURCES line removed. */
  text: string
  /** The parsed closing grade, or null when the model omitted or garbled it. */
  grade: string | null
  /** The SDK's own account of why generation stopped. */
  finishReason?: string
}

/**
 * The response's problem, or null when it can be read as an answer.
 *
 * Ordered by how directly each one names the cause, so the log line an operator
 * reads is about the real fault rather than a downstream symptom.
 */
export function findResponseProblem(input: ResponseCheckInput): ResponseProblem | null {
  // A cut-off answer is incomplete by definition, whatever it happens to
  // contain — including the case where the model got far enough to write a
  // plausible paragraph before running out. Checked first because it is a
  // cause, and the two below are things it produces.
  if (input.finishReason === 'length') return { kind: 'truncated' }

  // Nothing survived the strip: the entire budget went on a scratchpad.
  if (!input.text.trim()) return { kind: 'reasoning_only' }

  // The prompt requires the answer to end with a single `SOURCES: <grade>`
  // line. Its absence means the model was not writing to the contract — it was
  // narrating, refusing, or still thinking — and its presence is the one cheap
  // proof that the thing we are about to store forever is the thing we asked
  // for. This alone would have caught the incident above.
  if (!input.grade) return { kind: 'no_contract_line' }

  return null
}

/** An operator-facing sentence naming the model, because the model is the fix. */
export function describeResponseProblem(
  problem: ResponseProblem,
  context: { title: string; modelId: string }
): string {
  const suffix =
    ` Model: ${context.modelId}. If this repeats for every title, the Title Analysis role is` +
    ` pointed at a model that cannot follow the prompt's output format — a reasoning model that` +
    ` writes its scratchpad as ordinary text is the usual cause.`

  switch (problem.kind) {
    case 'truncated':
      return (
        `The analysis for "${context.title}" was cut off before it finished` +
        ` (the model hit the output limit).${suffix}`
      )
    case 'reasoning_only':
      return (
        `The model returned only reasoning for "${context.title}" and no analysis.${suffix}`
      )
    case 'no_contract_line':
      return (
        `The response for "${context.title}" did not end with the required SOURCES line,` +
        ` so it is not an answer to the prompt.${suffix}`
      )
  }
}
