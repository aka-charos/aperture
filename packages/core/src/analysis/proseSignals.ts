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
  /**
   * Mentions of a critic, scholar, reviewer or viewer in paragraphs the model
   * did not label as reception. Zero without a paragraph map, like the count
   * above.
   */
  spill: number
  /** Semicolons. The prompt asks for none. */
  semicolons: number
  /**
   * Words in paragraphs labelled `work`, and in paragraphs labelled reception
   * (or version 8's `dispute`). The prompt asks for reception never to run
   * longer than the work answer. Zero without a map.
   */
  workWords: number
  receptionWords: number
  /**
   * Whether the answer carried a usable paragraph map. The counts that read the
   * model's labels are zero without one, and that zero means "not measured",
   * not "none found" - the report prints a dash for them.
   */
  mapped: boolean
}

const POINTS_AT_SOURCES = [
  /\b(?:the|these|those|its|available|retrieved) sources\b/gi,
  /\bsource (?:documents?|material)\b/gi,
  // Withnail & I under version 13: "one fan-adjacent source credits it". A
  // source of tension, or a source novel, is not the retrieval.
  /\b(?:one|another|several|some)\s+(?:[a-z]+(?:-[a-z]+)?\s+)?sources?\b(?!\s+(?:of|material|novel|text|book|play|story)\b)/gi,
]

const UNATTRIBUTED = [
  // Passive voice that hides whose view it is. "has been traced to" is
  // Possession's; "is described as" is the commonest.
  /\b(?:is|are|was|were|has been|have been|had been)\s+(?:widely\s+|often\s+|variously\s+|also\s+)?(?:described|called|characteri[sz]ed|regarded|considered|labell?ed|dubbed|hailed|traced|seen|recogni[sz]ed)\s+(?:as|to)\b/gi,
  // The Wretches Are Still Singing under version 13: "has been credited with
  // influencing independent film-making".
  /\b(?:is|are|was|were|has been|have been|had been)\s+(?:widely\s+|often\s+|also\s+)?credited\s+with\b/gi,
  /\baccording to (?:one|some|a|an)\b/gi,
  /\b(?:one|a) critical (?:read|reading)\b/gi,
  /\breportedly\b/gi,
  // Terminator 2 under version 12: "are said to have changed how blockbusters
  // were made".
  /\b(?:is|are|was|were)\s+said\s+to\b/gi,
  // A holder that is not a person: "a philosophical reading takes it as", "one
  // retrospective account holds" under version 13, and "The retrospective
  // account is explicit", "the retrospective press placed" under 14. "One
  // critical reading" is already counted above.
  /\b(?:one|a|another|the)\s+(?!critical\s)(?:[a-z]+\s+)?(?:account|reading|press)\s+(?:is|was|holds|takes|reads|sees|argues|suggests|finds|calls|notes|treats|places|placed)\b/gi,
]

/**
 * A writer's view named outside the reception answer.
 *
 * Version 13 keeps every critic, scholar and viewer in reception, after The
 * Zero Years' form answer ran "one Italian critic ... the same critic ...
 * another viewer" for three paragraphs. Viewers count only with a determiner,
 * because "the viewer" is how the prompt itself asks for an effect to be
 * described. Reception and its version-8 predecessor are where these belong.
 */
const WRITER_MENTIONS = [
  /\b(?:critics?|reviewers?|scholars?|commentators?)\b/gi,
  /\b(?:one|a|another|some|several|other|many|most)\s+viewers?\b/gi,
  /\bwriting (?:in|for)\b/gi,
]
const WRITER_SECTIONS = new Set(['reception', 'dispute'])
const WORK_SECTIONS = new Set(['work'])

/** Words in the paragraphs whose labels include one of the wanted ones. */
function wordsIn(
  paragraphs: string[],
  sections: readonly (readonly string[])[] | null | undefined,
  wanted: ReadonlySet<string>
): number {
  if (!sections || sections.length === 0) return 0
  return paragraphs.reduce(
    (sum, paragraph, i) =>
      sections[i]?.some((label) => wanted.has(label)) ? sum + paragraph.split(/\s+/).length : sum,
    0
  )
}

function writersOutsideReception(
  paragraphs: string[],
  sections: readonly (readonly string[])[] | null | undefined
): number {
  if (!sections || sections.length === 0) return 0
  return paragraphs.reduce((sum, paragraph, i) => {
    const labels = sections[i]
    if (!labels || labels.length === 0 || labels.some((label) => WRITER_SECTIONS.has(label))) {
      return sum
    }
    return sum + count(paragraph, WRITER_MENTIONS)
  }, 0)
}

const RATHER_THAN = [/\brather than\b/gi, /\binstead of\b/gi]

const LEFT_OPEN = [
  /\b(?:remains?|remained|is left|are left|stays?|left) (?:open|unresolved|unsettled)\b/gi,
  /\bnot resolved\b/gi,
  /\bdo(?:es)? not cancel (?:each other|one another) out\b/gi,
]

/** Matched against the start of a paragraph only. */
const QUESTION_ECHO =
  /^(?:the (?:film|series|show) sits in\b|in tradition terms\b|(?:the )?critics (?:genuinely |also |sharply )?(?:disagree|divide|split|differ)\b|what critics (?:and viewers )?(?:genuinely )?(?:disagree|argue)\b|the (?:most consequential )?circumstances? of (?:its |the film's )?(?:making|production)\b|the people who made it\b|the making of the film left\b|the (?:film|series)'s (?:governing|organi[sz]ing|central) (?:formal )?(?:idea|choice)\b)/i

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
  // The genre and the people writing about it are the subject's vocabulary:
  // "science fiction" and "action cinema" matched on every Terminator 2 bench
  // without anything being told twice.
  'action', 'cinema', 'science', 'fiction', 'genre', 'critic', 'critics', 'reviewer', 'reviewers',
  'review', 'reviews',
])

/**
 * A capitalised pair is a name - "Brian Eggert", "James Cameron", "Deep Focus"
 * - and a name recurs whenever the person does something else. Those pairs
 * were most of what the signal printed on the version-10 and version-11
 * benches, burying the genuine repeats.
 */
const isCapitalised = (word: string) => /^\p{Lu}/u.test(word)

function count(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0)
}

/**
 * Sentences in a paragraph, roughly: a full stop, question or exclamation mark
 * followed by space and a capital. A lone capital before the stop is an
 * initial, not a sentence end - "Richard E. Grant" made a four-sentence
 * paragraph read as five on Withnail & I, a rule break that did not happen.
 * "Dr." still over-counts slightly, the right direction against a ceiling.
 */
function sentenceCount(paragraph: string): number {
  return paragraph
    .split(/(?<=[.!?])(?<!(?:^|[\s(])\p{Lu}\.)["'”’)\]]*\s+(?=["'“‘(]?[A-Z0-9À-ÖØ-Þ])/u)
    .filter((s) => s.trim()).length
}

/**
 * Two adjacent distinctive words, hyphens read as spaces ("liquid-metal"),
 * skipping names.
 */
function distinctivePairs(paragraph: string): Set<string> {
  const words = paragraph
    .replace(/[-–—]/g, ' ')
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)
  const pairs = new Set<string>()
  for (let i = 0; i + 1 < words.length; i++) {
    if (isCapitalised(words[i]) && isCapitalised(words[i + 1])) continue
    const [a, b] = [words[i].toLowerCase(), words[i + 1].toLowerCase()]
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
    spill: writersOutsideReception(paragraphs, sections),
    semicolons: (trimmed.match(/;/g) ?? []).length,
    workWords: wordsIn(paragraphs, sections, WORK_SECTIONS),
    receptionWords: wordsIn(paragraphs, sections, WRITER_SECTIONS),
    mapped: Boolean(sections?.some((labels) => labels.length > 0)),
  }
}
