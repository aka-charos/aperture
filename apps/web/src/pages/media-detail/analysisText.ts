/**
 * Pure helpers for the Film Analysis panel's header and tabs, split out of the
 * component so they can be pinned without rendering it.
 */

/** Average silent reading speed, for the "N min read" line. */
const WORDS_PER_MINUTE = 220
const CJK_CHARS_PER_MINUTE = 450
// Kana, CJK ideographs (with extension A) and Hangul syllables.
const CJK_CHAR = /[぀-ヿ㐀-鿿가-힯]/g

/**
 * Minutes to read a text. Whitespace words undercount Japanese and Chinese,
 * which are written without spaces, so those characters are timed separately.
 */
export function readMinutes(text: string): number {
  const cjk = text.match(CJK_CHAR)?.length ?? 0
  const words = text.replace(CJK_CHAR, ' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE + cjk / CJK_CHARS_PER_MINUTE))
}

/**
 * The heading for a run: what it answers.
 *
 * Both labels survive when a paragraph answers two questions, in the order the
 * model listed them on its own map line: rule 3 tells it to merge what belongs
 * together, so that is a normal shape and dropping one would misdescribe the
 * run. An id the caller cannot label (an empty string) contributes nothing.
 */
export function sectionHeading(questions: string[], label: (question: string) => string): string {
  return questions.map(label).filter(Boolean).join(' · ')
}
