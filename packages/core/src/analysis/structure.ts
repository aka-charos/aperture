/**
 * Whether an answer is SECTIONED, and therefore usable as an article.
 *
 * WHAT A SECTION IS HERE. The model writes a paragraph map (`===MAP===`)
 * labelling each paragraph with the question it answers, and ./segments.ts
 * turns those labels into the headings a reader sees - Context, Form and
 * Style, Making, Critical Reception. So an answer with no usable map is not a
 * short article, it is ONE UNHEADED SLAB: the panel renders it without a single
 * heading, ./grounding.ts can select nothing from it, and the assistant cannot
 * find the spoiler-shaped run to gate.
 *
 * WHY THIS IS NOW A CONTRACT BREAK. It used to be tolerated - "a missing or
 * broken map costs the map, never the analysis" - on the reasoning that the
 * prose was still good. Measured across the benches, that reasoning does not
 * survive: `ornith-1.5-9b` wrote FIVE map lines for a FOUR paragraph answer, so
 * `parseParagraphMap` refused the whole block (an out-of-range index means the
 * model lost count, and a wrong pointer is worse than no pointer), and the
 * stored article would have had no headings at all while reading as a complete
 * success everywhere else. A miscount is also the single most retry-able fault
 * there is: the prose is finished and the model has only to count what it
 * already wrote, which is why this joins the output contract rather than
 * becoming a new kind of decline.
 *
 * THE COST IS A RETRY, THEN THE TITLE. A structure problem is an ordinary
 * `ResponseProblem`, so ./generate.ts retries the same model, then rotates to
 * the next one, and finally throws - which stores NOTHING and leaves the title
 * pending for the next run. It never stores a decline: a decline is permanent
 * until the prompt version moves, and "this model cannot count its paragraphs"
 * is a fact about the model, not about the title.
 *
 * PURE AND DB-FREE, like ./response.ts whose union it extends and ./budget.ts
 * beside it. The `ResponseProblem` union has ONE home, in ./response.ts; this
 * module only decides which of its members to return.
 */
import type { ResponseProblem } from './response.js'

/**
 * Below this, an answer is not expected to be sectioned.
 *
 * The prompt's own escape hatch is "if no question has an answer, say so in two
 * sentences and stop", and the source floor is what judges that. Demanding
 * headings on a two-paragraph refusal would turn a legitimate thin answer into
 * three model calls and a thrown title.
 */
export const MIN_PARAGRAPHS_FOR_STRUCTURE = 3
/**
 * Paragraphs past which the answer is a BROKEN GENERATION, not a long one.
 *
 * Measured on the Suspiria bench: ornith-1.5-9b answered draft 16 with 5,674
 * words in 304 paragraphs - chunks of one source document reproduced
 * verbatim, then a single sentence repeated about eighty times - and stopped
 * of its own accord, so finishReason was "stop" and the truncation check
 * could not see it. Every prompt version since 9 caps the piece at eight to
 * ten paragraphs, and nothing compared what came back against that.
 *
 * A GROSS overrun, deliberately, at roughly three times the largest cap any
 * version has set. Rejecting a 10% overrun would fail a title permanently
 * over a model writing slightly long, which is the asymmetry this whole file
 * is built on; 304 against 8 is not a judgement call.
 *
 * Checked FIRST, because a runaway also has no usable map and no closing
 * contract line, and naming those instead sends an operator to fix the
 * labelling of an answer that was never an answer.
 */
export const MAX_PARAGRAPHS = 30

/** Spelled once, so the union in ./response.ts and the check below agree. */
const MAX_PARAGRAPHS_PROBLEM = 'runaway' as const

/**
 * How much of the answer must carry a label.
 *
 * Not all of it, deliberately: the contract says "leave out any paragraph that
 * answers none of the questions", so one unlabelled paragraph is the model
 * using an allowance rather than losing its place. Two thirds is the point at
 * which the headings stop describing the article.
 */
export const MIN_MAPPED_SHARE = 2 / 3

/**
 * Sections, plural. One label over the whole piece is not a breakdown - it is
 * the same unheaded slab with a name on top - and every title that supports an
 * analysis at all supports at least two of the four questions.
 */
export const MIN_QUESTIONS = 2

/** The shape ./paragraphMap.ts returns, and nothing more, so this stays pure. */
export interface MappedParagraph {
  paragraph: number
  questions: readonly string[]
}

/**
 * The structural fault in an answer, or null when it is properly sectioned.
 *
 * Takes the map ALREADY PARSED rather than the raw block, because deciding
 * whether to believe a map is ./paragraphMap.ts's job and this module must not
 * grow a second, more forgiving copy of that judgement.
 */
export function findStructureProblem(input: {
  /** `splitAnalysisParagraphs(text).length`. */
  paragraphs: number
  /** `parseParagraphMap(...)` - null when the model wrote none or wrote one that was refused. */
  map: readonly MappedParagraph[] | null
}): ResponseProblem | null {
  if (input.paragraphs > MAX_PARAGRAPHS) {
    return { kind: MAX_PARAGRAPHS_PROBLEM, paragraphs: input.paragraphs }
  }

  if (input.paragraphs < MIN_PARAGRAPHS_FOR_STRUCTURE) return null

  if (!input.map || input.map.length === 0) return { kind: 'no_sections' }

  // Counted from the map's own entries rather than from the paragraph list,
  // since parseParagraphMap has already refused anything pointing out of range.
  const mapped = new Set(input.map.map((entry) => entry.paragraph)).size
  if (mapped < input.paragraphs * MIN_MAPPED_SHARE) {
    return { kind: 'thin_sections', mapped, paragraphs: input.paragraphs }
  }

  const questions = new Set(input.map.flatMap((entry) => entry.questions)).size
  if (questions < MIN_QUESTIONS) return { kind: 'one_section', questions }

  return null
}
