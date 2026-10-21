/**
 * When a pick's explanation can be reused instead of written again.
 *
 * A regeneration lands mostly on the picks it had before (the ranking is
 * deterministic, and a regenerate with nothing new to go on has nothing to move
 * it), and the explanations are the slow, paid part of a run. An explanation is
 * a function of what the model was shown, so when everything it was shown for a
 * pick is unchanged, the stored text is still the right answer for it.
 *
 * "Everything it was shown" is taken literally: the fingerprint hashes the
 * rendered prompt pieces, not a list of fields chosen to stand for them. A
 * field-list fingerprint goes quietly stale the first time someone adds a line
 * to the prompt and forgets to add it here; the rendered text cannot, and a
 * field that never reaches the prompt cannot change the answer, so leaving it
 * out is correct rather than an oversight.
 *
 * What it deliberately does not cover: the OTHER picks sharing the batch. A
 * model writing ten explanations at once sees all ten, but which ten share a
 * batch is an accident of list order, and reusing text across different
 * neighbours is the same text a different batching would have produced.
 *
 * Pure, no DB; pinned by explanationReuse.test.ts.
 */

import { createHash } from 'node:crypto'

/** The pieces of a prompt that one pick's explanation was written from. */
export interface ExplanationInputs {
  /**
   * Who wrote it: provider, model and reasoning setting. Changing the model is
   * an operator asking for a different writer, so it must not hand back the
   * previous writer's text.
   */
  writer: string
  /** The whole system prompt, including the AI-language instruction. */
  system: string
  /** The viewer's taste block, which every pick in the run is written against. */
  userContext: string
  /** The pick's own block, without its position in the batch. */
  pick: string
}

/**
 * sha256 over the four pieces, each length-prefixed so no piece can run into
 * the next and make two different prompts hash alike.
 */
export function explanationFingerprint(inputs: ExplanationInputs): string {
  const hash = createHash('sha256')
  for (const part of [inputs.writer, inputs.system, inputs.userContext, inputs.pick]) {
    hash.update(`${part.length}:`)
    hash.update(part)
  }
  return hash.digest('hex')
}

/** One pick ready to explain: its rendered block and that block's fingerprint. */
export interface PreparedPick<T> {
  item: T
  id: string
  /** The pick's block WITHOUT its batch number; see numberBlocks. */
  block: string
  fingerprint: string
}

/**
 * An explanation and where it came from. `fingerprint` is set only on text a
 * model wrote (now or on an earlier run); a template written after a failed call
 * carries none, which is what keeps it from ever being remembered and reused.
 */
export interface WrittenExplanation {
  id: string
  explanation: string
  fingerprint?: string
}

/**
 * A batch's pick list as the prompt shows it. The number is added here and
 * never inside a block, so a pick hashes alike whichever batch it lands in.
 */
export function numberBlocks(batch: readonly PreparedPick<unknown>[]): string {
  return batch.map((p, i) => `${i + 1}. ${p.block}`).join('\n\n')
}

/**
 * Read a batch's answers back onto its picks. The model numbers them from 1,
 * as the prompt does; a pick it left out gets the template, without a
 * fingerprint.
 */
export function readBatchAnswers<T>(
  batch: readonly PreparedPick<T>[],
  byIndex: ReadonlyMap<number, string>,
  fallback: (item: T) => string
): WrittenExplanation[] {
  return batch.map((p, i) => {
    const written = byIndex.get(i + 1)
    return written !== undefined
      ? { id: p.id, explanation: written, fingerprint: p.fingerprint }
      : { id: p.id, explanation: fallback(p.item) }
  })
}

/** Every pick of a failed batch gets the template, without a fingerprint. */
export function templateAnswers<T>(
  batch: readonly PreparedPick<T>[],
  fallback: (item: T) => string
): WrittenExplanation[] {
  return batch.map((p) => ({ id: p.id, explanation: fallback(p.item) }))
}

/**
 * How a run's explanations were produced, for the job log: reused, written by
 * the model now, or the template. Counting templates as written is what made a
 * failed run read as a paid one.
 */
export function explanationTally(
  results: readonly WrittenExplanation[],
  reusedIds: ReadonlySet<string>
): { reused: number; written: number; templates: number } {
  let reused = 0
  let written = 0
  let templates = 0
  for (const r of results) {
    if (reusedIds.has(r.id)) reused++
    else if (r.fingerprint) written++
    else templates++
  }
  return { reused, written, templates }
}

/** A stored explanation and the fingerprint it was written under. */
export interface StoredExplanation {
  fingerprint: string
  explanation: string
}

/**
 * Split picks into those whose stored explanation still applies and those that
 * need writing. A stored row is reused only on an exact fingerprint match and
 * only when it holds text; anything else is written, which is the safe side --
 * a wrong reuse shows a reason written for other inputs, a missed one only
 * costs a model call.
 */
export function splitReusable<P>(
  picks: readonly P[],
  idOf: (pick: P) => string,
  fingerprintOf: (pick: P) => string,
  stored: ReadonlyMap<string, StoredExplanation>
): { reused: Array<{ pick: P; explanation: string }>; toWrite: P[] } {
  const reused: Array<{ pick: P; explanation: string }> = []
  const toWrite: P[] = []
  for (const pick of picks) {
    const row = stored.get(idOf(pick))
    if (row && row.fingerprint === fingerprintOf(pick) && row.explanation.trim().length > 0) {
      reused.push({ pick, explanation: row.explanation })
    } else {
      toWrite.push(pick)
    }
  }
  return { reused, toWrite }
}
