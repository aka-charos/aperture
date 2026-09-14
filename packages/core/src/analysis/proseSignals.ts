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
 * EVERY PATTERN WAS MEASURED, not imagined - each comes from a version-8
 * analysis read on 2026-09-14 (Im Westen Nichts Neues, Fantozzi, Possession,
 * Tuner, Affeksjonsverdi). A new habit gets a pattern when it has been seen, the
 * way the prompt's named phrasings do.
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

export function measureProse(text: string | null | undefined): ProseSignals {
  const trimmed = (text ?? '').trim()
  const paragraphs = trimmed ? splitAnalysisParagraphs(trimmed) : []
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    paragraphs: paragraphs.length,
    longestParagraph: paragraphs.reduce((max, p) => Math.max(max, sentenceCount(p)), 0),
    pointsAtSources: count(trimmed, POINTS_AT_SOURCES),
    unattributed: count(trimmed, UNATTRIBUTED),
    ratherThan: count(trimmed, RATHER_THAN),
    leftOpen: count(trimmed, LEFT_OPEN),
    questionEchoes: paragraphs.filter((p) => QUESTION_ECHO.test(p)).length,
  }
}
