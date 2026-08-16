/**
 * Whether a grounded analysis response is worth keeping.
 *
 * This is the epistemic half of the feature. An UNGROUNDED model will happily
 * analyse a film it has never heard of, at length and with total confidence,
 * and nothing downstream can tell that apart from a good answer. A GROUNDED one
 * comes back with two sources instead of seven — so grounding's value here is
 * as much about knowing when to shut up as about what it retrieves.
 *
 * Pure and DB-free on purpose, same as `pending.ts` and `watchedExclusion.ts`:
 * the decision that governs what reaches the page should be testable without a
 * database.
 *
 * THE ASYMMETRY THAT SETS THE THRESHOLDS. A decline is *stored* (analysis NULL
 * in `title_analysis`), which retires the title until `ANALYSIS_PROMPT_VERSION`
 * is bumped. Storing a mediocre analysis is recoverable — raise the floor and
 * re-run. Declining a good one is not. So every threshold here errs toward
 * keeping, and the live decline rate is the number to tune against:
 *
 *   SELECT source_grade, count(*), count(analysis) AS kept
 *   FROM title_analysis GROUP BY 1
 */
import type { SourceGrade } from './prompt.js'

/**
 * Below this, the model took the exit the prompt offers ("if none of the
 * questions have real answers, say so in two sentences and stop") and we should
 * record a decline rather than render two sentences of apology.
 *
 * 400 characters sits in a wide measured gap, not on a guess: a genuinely short
 * but real answer ran ~250 words (~1,500 characters) for Love Actually, while
 * the exit is two sentences (~200). There is an order of magnitude between
 * them, so the exact value is not load-bearing.
 */
export const MIN_ANALYSIS_CHARS = 400

/**
 * Below this many grounding chunks the model was mostly working from its own
 * pretrained knowledge, which is the case this whole module exists to catch.
 *
 * Deliberately low. Nobody has measured the distribution of chunk counts on a
 * real library yet, and per the asymmetry above the safe direction while
 * unmeasured is to keep. Note this measures OBSCURITY, not depth — a
 * blockbuster returns plenty of chunks and may still carry no analytical
 * writing at all, which is what `source_grade` is for.
 */
export const MIN_GROUNDING_CHUNKS = 2

export type DeclineReason = 'thin_sources' | 'no_distinctive_craft'

export type FloorDecision =
  | { store: true }
  | { store: false; reason: DeclineReason }

export interface FloorInput {
  /** Prose with the SOURCES line already stripped. */
  text: string
  /** The model's own verdict, or null when it omitted / garbled the line. */
  grade: SourceGrade | null
  /** How many web sources grounding actually returned. */
  groundingChunks: number
}

export function decideAnalysisFloor(input: FloorInput): FloorDecision {
  const text = input.text.trim()

  // The model said outright that the web has almost nothing. Trust it: this is
  // the one signal that reflects what was *read* rather than how much.
  if (input.grade === 'almost-nothing') {
    return { store: false, reason: 'thin_sources' }
  }

  if (input.groundingChunks < MIN_GROUNDING_CHUNKS) {
    return { store: false, reason: 'thin_sources' }
  }

  // Short means the model took the exit — which is a correct answer about the
  // work, not a failure of retrieval, so it gets the other reason. Checked
  // after the grounding tests so a short AND ungrounded response is reported as
  // the retrieval problem it more likely is.
  if (text.length < MIN_ANALYSIS_CHARS) {
    return { store: false, reason: 'no_distinctive_craft' }
  }

  return { store: true }
}
