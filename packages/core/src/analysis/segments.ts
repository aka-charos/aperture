/**
 * Cut a stored analysis into the runs the panel renders, and say which of them
 * the reader has to ask for.
 *
 * WHY THIS EXISTS. The prompt's spoiler defence is structural — it asks only
 * pre-viewing questions — and the `tradition` question turned out not to be one
 * of them. For a work whose revelation is its antecedent, naming the antecedent
 * names the ending, and the model is answering the question correctly when it
 * does. See TRADITION_QUESTION in ./prompt.ts for the measurement. The prompt
 * now asks the model not to, which is an instruction and therefore a rule that
 * only has to fail once; this is the half that holds when it does.
 *
 * THE SPLIT HAPPENS HERE, ON THE SERVER, AND SHIPS AS TEXT PLUS A BOOLEAN. Two
 * reasons, and the second is the one that would have bitten.
 *
 *  * The web bundle never imports core, so which questions are spoiler-prone
 *    cannot live in it — otherwise retuning that set means redeploying the
 *    client, and the panel's 15 locales, to change a decision core made.
 *
 *  * The panel does NOT split paragraphs the way the map counts them. Its
 *    `toParagraphs` honours blank lines when the model wrote any and otherwise
 *    reflows the prose by sentence count, because some rows arrive as one
 *    unbroken block. Handing the client a map and letting it index into its own
 *    reflow would, on exactly those rows, gate a paragraph that is not the one
 *    the model labelled — hiding good prose AND showing the leak. Shipping
 *    ordered segments removes the question: there is no index to disagree
 *    about.
 *
 * TOLERANT, LIKE EVERYTHING DOWNSTREAM OF THE MAP. No map, an unusable map, or
 * a map naming nothing gated all produce a single ungated segment holding the
 * analysis exactly as stored — which is what the panel rendered before this
 * existed. The gate is a mitigation and not a guarantee, and that is why the
 * prompt-side instruction is not redundant with it.
 */
import { splitAnalysisParagraphs, type ParagraphMap } from './paragraphMap.js'
import type { AnalysisQuestionId } from './prompt.js'

/**
 * The questions whose answers can give away what the work withholds.
 *
 * Only `tradition` so far, and the reason no other question qualifies is worth
 * keeping: `work`, `intent` and `circumstances` are about how and why the thing
 * was made, `structure` is about the shape of a run, and `dispute` is about
 * what was written afterwards. None of them has an answer that is the ending.
 * Tradition does, whenever the tradition is one specific earlier work.
 */
export const GATED_QUESTIONS: readonly AnalysisQuestionId[] = ['tradition']

export interface AnalysisSegment {
  /** One or more consecutive paragraphs, blank-line separated, as written. */
  text: string
  /**
   * Whether the panel must put this behind a disclosure the reader opens.
   *
   * A DECIDED VALUE, never the label it was decided from. The client renders a
   * control and nothing else — it does not know which question this answers and
   * must not, or the rule above has a second home.
   */
  gated: boolean
}

/**
 * The analysis, in order, with the gated runs marked.
 *
 * A PARAGRAPH ANSWERING TWO QUESTIONS IS GATED IF EITHER IS GATED, and that is
 * the asymmetric direction on purpose. Rule 3 of the prompt actively encourages
 * merging questions that belong together, so a paragraph carrying `tradition`
 * alongside `work` is a normal and desirable shape rather than a fault. Gating
 * it costs the reader a click to see a craft observation. Not gating it ships
 * the leak, which is the thing that cannot be taken back once read.
 *
 * Consecutive paragraphs on the same side are joined into one segment, so the
 * common case — nothing gated — is a single segment carrying the whole
 * analysis, and the panel's existing rendering path is unchanged.
 */
export function buildAnalysisSegments(
  analysis: string,
  map: ParagraphMap | null
): AnalysisSegment[] {
  const whole = analysis.trim()
  if (!whole) return []

  const gatedParagraphs = gatedParagraphNumbers(map)
  // Nothing to hide. Returned verbatim rather than re-joined from the split, so
  // a row the map does not divide reaches the panel byte-identical to storage.
  if (gatedParagraphs.size === 0) return [{ text: whole, gated: false }]

  const segments: AnalysisSegment[] = []
  splitAnalysisParagraphs(whole).forEach((paragraph, i) => {
    const gated = gatedParagraphs.has(i + 1)
    const previous = segments[segments.length - 1]
    if (previous && previous.gated === gated) {
      previous.text = `${previous.text}\n\n${paragraph}`
      return
    }
    segments.push({ text: paragraph, gated })
  })

  return segments
}

/** The 1-based paragraph numbers the map assigns to a gated question. */
function gatedParagraphNumbers(map: ParagraphMap | null): Set<number> {
  const numbers = new Set<number>()
  if (!map) return numbers

  const gated = new Set<AnalysisQuestionId>(GATED_QUESTIONS)
  for (const entry of map) {
    if (entry.questions.some((question) => gated.has(question))) {
      numbers.add(entry.paragraph)
    }
  }
  return numbers
}
