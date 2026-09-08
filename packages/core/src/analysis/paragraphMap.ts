/**
 * Read the paragraph map the model wrote back, and decide whether to believe it.
 *
 * WHAT THE MAP IS FOR. Which paragraph of an analysis answers which question
 * was previously knowable only by counting, and counting is exactly what the
 * prompt makes unsafe: rule 3 tells the model to merge questions that belong
 * together and rule 6 tells it to drop the ones the sources cannot support.
 * Measured on a live analysis of The Voice Of Hind Rajab, the second paragraph
 * carried tradition AND critical dispute at once — so "the first two
 * paragraphs" would have put argumentation into an embedding meant to carry
 * style. With a map, the boundary is recorded rather than assumed.
 *
 * PURE, AND SPLIT OUT FOR THAT REASON — the same split as ./sourceFloor.ts,
 * ./pending.ts and ./response.ts. Deciding whether a map is trustworthy is a
 * judgement worth testing without a database or a model behind it.
 *
 * THE FAILURE MODE IT GUARDS IS MISCOUNTING, not disobedience. The map is
 * written after the prose is finished, so it cannot change the article; the one
 * thing it can get wrong is which paragraph it is pointing at. That is why an
 * out-of-range or repeated index discards the WHOLE map while an unrecognised
 * label discards only that label: a map that is wrong about which paragraph is
 * worse than no map at all, whereas a model writing "themes" where the prompt
 * said "work" has merely mislabelled one thing.
 */
import { questionIdsFor, type AnalysisQuestionId } from './prompt.js'

export interface ParagraphMapEntry {
  /** 1-based index into `splitAnalysisParagraphs(analysis)`. */
  paragraph: number
  /** The questions this paragraph answers. Never empty. */
  questions: AnalysisQuestionId[]
}

/** Stored as JSONB on `title_analysis.paragraph_map`. */
export type ParagraphMap = ParagraphMapEntry[]

/**
 * Split an analysis into the paragraphs the map's numbers refer to.
 *
 * MUST AGREE WITH THE PANEL, which splits on `/\n{2,}/` to render. If the two
 * disagree about what a paragraph is then every index is off by however many
 * they differ by, and the map would confidently point at the wrong prose.
 */
export function splitAnalysisParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
}

/**
 * `2: work, tradition` — tolerant about the separator, strict about the number.
 *
 * Bold and backticks are stripped before matching because a model told to emit
 * a plain list will still sometimes format it, and that is a wording slip
 * rather than a miscount.
 */
const MAP_LINE = /^\s*(\d{1,3})\s*[:.)-]\s*(.+?)\s*$/

export interface ParagraphMapContext {
  /** `splitAnalysisParagraphs(analysis).length` — what the indices must fit. */
  paragraphCount: number
  /** Decides the vocabulary: only a series is asked about `structure`. */
  mediaType: 'movie' | 'series'
}

/**
 * The map, or null when there isn't a usable one.
 *
 * Null is an ORDINARY outcome and every caller must treat it that way — the
 * analysis is stored either way. This is the same tolerance the SOURCES grade
 * has and the deliberate opposite of `ANALYSIS_BEGIN_MARKER`, which is a hard
 * failure: without the opening marker we do not know what the prose IS, whereas
 * without a map we merely do not know how it is divided.
 */
export function parseParagraphMap(
  mapText: string | null,
  context: ParagraphMapContext
): ParagraphMap | null {
  if (!mapText || context.paragraphCount < 1) return null

  const vocabulary = new Set<string>(questionIdsFor(context.mediaType))
  const claimed = new Set<number>()
  const map: ParagraphMap = []

  for (const line of mapText.split('\n')) {
    const match = MAP_LINE.exec(line.replace(/[*`_]/g, ''))
    // A blank line, a stray header, a closing remark. Skipped rather than
    // treated as a fault: none of them says anything about the numbering.
    if (!match) continue

    const paragraph = Number(match[1])
    // The two miscount tells. Out of range means the model counted paragraphs
    // that are not there; a repeat means it lost its place. Either way every
    // other index in the block is suspect, so the map goes rather than the line
    // — a wrong pointer is worse than no pointer.
    if (paragraph < 1 || paragraph > context.paragraphCount) return null
    if (claimed.has(paragraph)) return null
    claimed.add(paragraph)

    // Split on anything that is not a letter, so "work and tradition",
    // "work, tradition" and "work / tradition" all read the same, and any
    // commentary the model adds ("work (the opening)") drops out for free.
    const questions = [
      ...new Set(
        match[2]
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((word): word is AnalysisQuestionId => vocabulary.has(word))
      ),
    ]

    // No label we recognise. Dropped quietly, because this is also how a model
    // says "this paragraph answers none of them" — and a line saying nothing is
    // not evidence that the numbering is wrong.
    if (questions.length > 0) map.push({ paragraph, questions })
  }

  return map.length > 0 ? map : null
}

/**
 * The paragraphs answering any of `wanted`, in the order they were written.
 *
 * THIS IS WHAT THE MAP EXISTS FOR: the style-bearing half of an analysis, taken
 * structurally instead of by counting off the top. Sorted by paragraph rather
 * than trusting the map's own order, because the model wrote those lines and
 * nothing has promised they are in sequence.
 *
 * Returns an empty array for a null map, so a caller can concatenate the result
 * unconditionally and an unmapped analysis simply contributes nothing.
 */
export function selectMappedParagraphs(
  analysis: string,
  map: ParagraphMap | null,
  wanted: readonly AnalysisQuestionId[]
): string[] {
  if (!map || map.length === 0) return []

  const paragraphs = splitAnalysisParagraphs(analysis)
  const want = new Set(wanted)

  return [...map]
    .sort((a, b) => a.paragraph - b.paragraph)
    .filter((entry) => entry.questions.some((question) => want.has(question)))
    .map((entry) => paragraphs[entry.paragraph - 1])
    .filter((paragraph): paragraph is string => typeof paragraph === 'string' && paragraph.length > 0)
}
