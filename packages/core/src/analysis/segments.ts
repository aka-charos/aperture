/**
 * Cut a stored analysis into the labelled runs the panel renders.
 *
 * WHAT THE LABELS ARE. Since prompt version 6 the model writes a short index
 * after its prose saying which paragraph answered which question — see
 * ./paragraphMap.ts. That index was built so the structure of an analysis could
 * be known without the model writing headings into the article (rule 4 forbids
 * them, and for good reason: a named empty section is an invitation to pad).
 * This turns it into the thing the reader sees, so each part of the piece says
 * what it is answering.
 *
 * IT USED TO HIDE ONE OF THEM AND NO LONGER DOES. The first version of this
 * module gated `tradition` behind a disclosure, because for a work whose
 * revelation is its antecedent that paragraph gives the ending away (measured
 * on Incendies — see TRADITION_QUESTION in ./prompt.ts). Removed on the
 * operator's call after seeing it: a control that collapses part of a short
 * article costs every reader a click on every title to protect a minority of
 * them, and labelling the parts is what they actually wanted the index for.
 * The prompt-side instruction stays and is now the only protection, which is
 * worth knowing rather than rediscovering — it is an instruction, so it will
 * eventually fail on some title.
 *
 * THE SPLIT HAPPENS HERE, ON THE SERVER. The panel does NOT divide paragraphs
 * the way the map counts them: its `toParagraphs` reflows by sentence count on
 * a row the model wrote as one unbroken block. Resolving an index in the
 * browser would therefore label the wrong prose on exactly those rows, so what
 * ships is resolved text with its labels attached and there is no index left to
 * disagree about.
 *
 * TOLERANT, LIKE EVERYTHING DOWNSTREAM OF THE MAP. No map, or an unusable one,
 * yields a single unlabelled segment holding the analysis exactly as stored —
 * which is what the panel rendered before any of this existed.
 */
import { splitAnalysisParagraphs, type ParagraphMap } from './paragraphMap.js'
import type { AnalysisQuestionId } from './prompt.js'

export interface AnalysisSegment {
  /** One or more consecutive paragraphs, blank-line separated, as written. */
  text: string
  /**
   * The questions this run answers, in the prompt's own order. Empty for a
   * paragraph the model labelled with nothing, and for every row with no map.
   *
   * The ids travel rather than finished label text, the way `sourceGrade` and
   * `declineReason` already do: the vocabulary is small, closed and stable, and
   * the panel has 15 locales to render it into.
   */
  questions: AnalysisQuestionId[]
}

/**
 * The analysis, in order, each run labelled with what it answers.
 *
 * Consecutive paragraphs carrying the SAME labels are joined into one segment,
 * so a two-paragraph answer gets one heading rather than the same heading
 * twice. Order within a run follows the map as written, since the model lists
 * the questions in the order it was asked them.
 */
export function buildAnalysisSegments(
  analysis: string,
  map: ParagraphMap | null
): AnalysisSegment[] {
  const whole = analysis.trim()
  if (!whole) return []

  const byParagraph = new Map<number, AnalysisQuestionId[]>()
  for (const entry of map ?? []) byParagraph.set(entry.paragraph, entry.questions)
  // Nothing to label. Returned verbatim rather than re-joined from the split,
  // so an unmapped row reaches the panel byte-identical to storage.
  if (byParagraph.size === 0) return [{ text: whole, questions: [] }]

  const segments: AnalysisSegment[] = []
  splitAnalysisParagraphs(whole).forEach((paragraph, i) => {
    const questions = byParagraph.get(i + 1) ?? []
    const previous = segments[segments.length - 1]
    if (previous && sameQuestions(previous.questions, questions)) {
      previous.text = `${previous.text}\n\n${paragraph}`
      return
    }
    segments.push({ text: paragraph, questions })
  })

  return segments
}

/** Order-sensitive on purpose: two runs labelled differently are two runs. */
function sameQuestions(a: AnalysisQuestionId[], b: AnalysisQuestionId[]): boolean {
  return a.length === b.length && a.every((question, i) => question === b[i])
}
