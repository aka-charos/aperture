/**
 * Count the habits a prompt change is meant to remove, so a bench can say
 * whether it did.
 *
 * WHY A COUNT AND NOT A READING. Every correction to the analysis prompt so far
 * was judged by reading a handful of answers, and version 8 showed how that
 * misleads: a rule that looked settled on one title was met with a synonym on
 * the next. Reading decides whether an analysis is good; these numbers decide
 * whether a named habit went down across models, which reading five answers
 * cannot.
 *
 * THIS IS AN INSTRUMENT, NEVER A VALIDATOR. Nothing rejects, retries or scores
 * an analysis on these, and nothing should: each pattern also matches innocent
 * prose ("rather than" is sometimes exactly right), so a threshold would punish
 * good writing. They are printed beside the prose they describe, where a reader
 * can see what matched.
 *
 * ZERO IS NOT CLEAN. The Terminator 2 bench showed the limit: version 9 scored
 * zero "unattributed" while stating one blog's readings as plain fact, because
 * the column counts hedges ("is described as") and a flat assertion has none.
 * An opinion with no holder and no hedge is invisible to any pattern here and
 * has to be read.
 *
 * EVERY PATTERN WAS MEASURED, not imagined - each comes from a version-8 or
 * version-9 analysis read on the bench. A new habit gets a pattern when it has
 * been seen, the way the prompt's named phrasings do.
 *
 * PURE AND DB-FREE, like ./comparisonReport.ts which prints it.
 */
import { splitAnalysisParagraphs } from './paragraphMap.js'

export interface ProseSignals {
  words: number
  paragraphs: number
  /** Sentences in the longest paragraph. The prompt asks for four at most. */
  longestParagraph: number
  /** "the sources carry", "the source documents" — pointing at the retrieval. */
  pointsAtSources: number
  /** A view with no holder: "is described as", "according to one reading". */
  unattributed: number
  /** "rather than" / "instead of". */
  ratherThan: number
  /** "These disagreements remain unresolved" — announcing a question is open. */
  leftOpen: number
  /** Paragraphs that open by restating their question: "The film sits in". */
  questionEchoes: number
  /**
   * Phrases told under two different questions — `repeatedPhrases.length`.
   * Zero whenever the answer carried no usable paragraph map, since without
   * labels there are no questions to repeat across.
   */
  repeatedAcrossSections: number
  /** The phrases behind that count, so a reader can check what matched. */
  repeatedPhrases: string[]
}

const POINTS_AT_SOURCES = [/\b(?:the|these|those|its|available|retrieved) sources\b/gi, /\bsource (?:documents?|material)\b/gi]

const UNATTRIBUTED = [
  // Passive voice that hides whose view it is. "has been traced to" is
  // Possession's; "is described as" is the commonest.
  /\b(?:is|are|was|were|has been|have been|had been)\s+(?:widely\s+|often\s+|variously\s+|also\s+)?(?:described|called|characteri[sz]ed|regarded|considered|labell?ed|dubbed|hailed|traced|seen)\s+(?:as|to)\b/gi,
  /\baccording to (?:one|some|a|an)\b/gi,
  /\b(?:one|a) critical (?:read|reading)\b/gi,
  /\breportedly\b/gi,
]

const RATHER_THAN = [/\brather than\b/gi, /\binstead of\b/gi]

const LEFT_OPEN = [
  /\b(?:remains?|remained|is left|are left|stays?|left) (?:open|unresolved|unsettled)\b/gi,
  /\bnot resolved\b/gi,
  /\bdo(?:es)? not cancel (?:each other|one another) out\b/gi,
]

/** Matched against the start of a paragraph only. */
const QUESTION_ECHO =
  /^(?:the (?:film|series|show) sits in\b|in tradition terms\b|(?:the )?critics (?:genuinely |also |sharply )?(?:disagree|divide|split|differ)\b|what critics (?:and viewers )?(?:genuinely )?(?:disagree|argue)\b|the circumstances of its making\b|the (?:most consequential )?circumstances? of its making\b|the people who made it\b|the making of the film left\b|the (?:film|series)'s (?:governing|organi[sz]ing|central) (?:formal )?(?:idea|choice)\b)/i

/**
 * Words too common to make a two-word phrase distinctive. Everything under four
 * letters is already excluded by length, so this list only has to cover the
 * longer function words and the words every analysis uses about its subject.
 */
const COMMON_WORDS = new Set([
  'about', 'after', 'also', 'before', 'being', 'between', 'both', 'each', 'even', 'film', 'films',
  'from', 'have', 'into', 'just', 'like', 'many', 'more', 'most', 'much', 'only', 'other', 'over',
  'series', 'show', 'some', 'still', 'such', 'than', 'that', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'under', 'very', 'were', 'what', 'when', 'where',
  'which', 'while', 'whose', 'with', 'work', 'would',
])

function count(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0)
}

/**
 * Sentences in a paragraph, roughly: a full stop, question or exclamation mark
 * followed by space and a capital. Initials and "Dr." over-count slightly,
 * which is the right direction for a number printed against a ceiling.
 */
function sentenceCount(paragraph: string): number {
  return paragraph.split(/(?<=[.!?])["'”’)\]]*\s+(?=["'“‘(]?[A-Z0-9À-ÖØ-Þ])/).filter((s) => s.trim()).length
}

/** Two adjacent distinctive words, hyphens read as spaces ("liquid-metal"). */
function distinctivePairs(paragraph: string): Set<string> {
  const words = paragraph
    .toLowerCase()
    .replace(/[-–—]/g, ' ')
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)
  const pairs = new Set<string>()
  for (let i = 0; i + 1 < words.length; i++) {
    const [a, b] = [words[i], words[i + 1]]
    if (a.length >= 4 && b.length >= 4 && !COMMON_WORDS.has(a) && !COMMON_WORDS.has(b)) {
      pairs.add(`${a} ${b}`)
    }
  }
  return pairs
}

/**
 * Phrases that appear under two questions that share no label.
 *
 * Measured on Terminator 2 under version 9: the early screenplay's liquid-metal
 * idea was told under Context and again under Making, and "say each fact once"
 * was in the prompt both times. Two paragraphs labelled `work` and
 * `work+tradition` share a question, so a phrase in both is not counted — only a
 * phrase whose occurrences include two DISJOINT label sets is.
 *
 * A phrase in half the paragraphs or more is the subject's own vocabulary (a
 * character, the premise), not a fact told twice, and is left out once there
 * are enough paragraphs for "half" to mean something.
 */
function repeatsAcrossSections(
  paragraphs: string[],
  sections: readonly (readonly string[])[] | null | undefined
): string[] {
  if (!sections || sections.length === 0) return []

  const seen = new Map<string, { labels: string[][]; paragraphs: number }>()
  paragraphs.forEach((paragraph, i) => {
    const labels = sections[i]
    if (!labels || labels.length === 0) return
    for (const pair of distinctivePairs(paragraph)) {
      const entry = seen.get(pair) ?? { labels: [], paragraphs: 0 }
      entry.labels.push([...labels])
      entry.paragraphs += 1
      seen.set(pair, entry)
    }
  })

  const disjoint = (a: string[], b: string[]) => !a.some((label) => b.includes(label))
  const repeated: string[] = []
  for (const [pair, entry] of seen) {
    if (paragraphs.length >= 4 && entry.paragraphs * 2 >= paragraphs.length) continue
    const crosses = entry.labels.some((a, i) => entry.labels.slice(i + 1).some((b) => disjoint(a, b)))
    if (crosses) repeated.push(pair)
  }
  return repeated.sort()
}

export function measureProse(
  text: string | null | undefined,
  sections?: readonly (readonly string[])[] | null
): ProseSignals {
  const trimmed = (text ?? '').trim()
  const paragraphs = trimmed ? splitAnalysisParagraphs(trimmed) : []
  const repeatedPhrases = repeatsAcrossSections(paragraphs, sections)
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    paragraphs: paragraphs.length,
    longestParagraph: paragraphs.reduce((max, p) => Math.max(max, sentenceCount(p)), 0),
    pointsAtSources: count(trimmed, POINTS_AT_SOURCES),
    unattributed: count(trimmed, UNATTRIBUTED),
    ratherThan: count(trimmed, RATHER_THAN),
    leftOpen: count(trimmed, LEFT_OPEN),
    questionEchoes: paragraphs.filter((p) => QUESTION_ECHO.test(p)).length,
    repeatedAcrossSections: repeatedPhrases.length,
    repeatedPhrases,
  }
}
