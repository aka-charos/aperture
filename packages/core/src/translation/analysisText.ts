/**
 * How a film analysis is cut up for translation — pure, pinned by
 * `analysisText.test.ts`.
 *
 * ONE REQUEST WHEN IT FITS, BECAUSE CONTEXT IS WHAT A SPLIT COSTS. Measured
 * 2026-10-11 on Index-Translate into Greek: a 12-paragraph analysis translated
 * in one streamed call took the right gender for the film throughout, while
 * the same paragraphs translated one at a time wrote "its influence" as
 * «Η επιρροή του» — the paragraph opens on "its" and never names the film, so
 * nothing told the model it was η ταινία. So the whole analysis goes as one
 * request whenever it fits {@link TRANSLATION_CHUNK_CHARS}, which a full-length
 * analysis does (5,035 characters, 18.3s).
 *
 * THE PARAGRAPH COUNT IS THE CONTRACT. An analysis carries a paragraph index
 * (`title_analysis.paragraph_map`) that says which paragraph answers which
 * question; the panel turns it into section headings. A translation that comes
 * back with the same number of paragraphs reuses that index unchanged, so its
 * headings land on the same prose. One that does not is retranslated section by
 * section ({@link analysisTranslationGroups}), and a group that still miscounts
 * paragraph by paragraph — never stored with a count that would put a heading
 * over the wrong paragraph.
 */
import { splitAnalysisParagraphs, type ParagraphMap } from '../analysis/paragraphMap.js'
import { TRANSLATION_CHUNK_CHARS } from './rules.js'

/** The paragraphs of an analysis, exactly as the paragraph index counts them. */
export function analysisParagraphs(text: string): string[] {
  return splitAnalysisParagraphs(text)
}

/** The whole analysis travels as one request. */
export function analysisFitsOneRequest(paragraphs: readonly string[], maxChars = TRANSLATION_CHUNK_CHARS): boolean {
  return joinAnalysisParagraphs(paragraphs).length <= maxChars
}

/** Paragraphs back into one text, the separator `splitAnalysisParagraphs` reads. */
export function joinAnalysisParagraphs(paragraphs: readonly string[]): string {
  return paragraphs.join('\n\n')
}

/**
 * Which section each paragraph belongs to, as a key: paragraphs labelled with
 * the same questions in a row are one section, the rule `buildAnalysisSegments`
 * uses to put one heading over them. A row with no map is one section.
 */
export function analysisSectionKeys(count: number, map: ParagraphMap | null): string[] {
  const byParagraph = new Map<number, string>()
  for (const entry of map ?? []) byParagraph.set(entry.paragraph, entry.questions.join(','))
  return Array.from({ length: count }, (_, i) => byParagraph.get(i + 1) ?? '')
}

/**
 * The requests for an analysis translated section by section: runs of
 * consecutive paragraph indexes that never cross a section boundary, packed up
 * to `maxChars` so a section of short paragraphs is still one request. A
 * paragraph longer than `maxChars` is a group on its own (`translateText`
 * splits it further, joining the pieces back into one paragraph).
 */
export function analysisTranslationGroups(
  paragraphs: readonly string[],
  map: ParagraphMap | null,
  maxChars = TRANSLATION_CHUNK_CHARS
): number[][] {
  const keys = analysisSectionKeys(paragraphs.length, map)
  const groups: number[][] = []
  let current: number[] = []
  let size = 0
  paragraphs.forEach((paragraph, i) => {
    const crossesSection = current.length > 0 && keys[i] !== keys[i - 1]
    const overflows = current.length > 0 && size + 2 + paragraph.length > maxChars
    if (crossesSection || overflows) {
      groups.push(current)
      current = []
      size = 0
    }
    size += (current.length > 0 ? 2 : 0) + paragraph.length
    current.push(i)
  })
  if (current.length > 0) groups.push(current)
  return groups
}
