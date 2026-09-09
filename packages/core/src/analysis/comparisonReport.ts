/**
 * Render a bench run as one plain-text document.
 *
 * THIS IS THE DELIVERABLE. The point of a comparison is to read several models'
 * prose about one film side by side and decide, and that decision is made by
 * reading — not by scrolling a grid of cards. So the report is one string that
 * can be copied whole into a notes file, pasted into a message, or diffed
 * against last month's, and the UI renders the same string it hands over.
 *
 * PURE AND DB-FREE, like ./sourceFloor.ts and ./paragraphMap.ts, because the
 * ordering rules below are the kind that break silently: a report that drops a
 * failed model, or prints the wrong model's name over an answer, reads as a
 * clean result rather than as a bug.
 *
 * WHAT IT LEADS WITH IS THE CONTROL, and that ordering is the argument. The
 * header states the sources every model was given and the prompt version they
 * answered — because the only thing that makes the answers comparable is that
 * those were identical, and a reader who cannot see that has to take it on
 * trust. The prompt itself goes at the END: it is long, it is the same on every
 * run, and burying the answers under it would defeat the document.
 *
 * FAILURES ARE PRINTED, NEVER OMITTED. "This model could not hold the output
 * contract" and "this model wrote nothing about this film" are results, and
 * they are often the finding — a model that truncates on a 20k-token prompt has
 * told you what you needed to know. A report listing only the models that
 * succeeded would present a four-model bench as a two-model one.
 */
/** One model's turn at the shared prompt. */
export interface ComparisonEntry {
  provider: string
  model: string
  /** pending | ok | unusable | error — see the 0169 comment. */
  status: string
  analysis: string | null
  grade: string | null
  /** Which contract check rejected it, when one did. */
  problem: string | null
  finishReason: string | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  durationMs: number | null
  error: string | null
  /**
   * Labels the model gave its own paragraphs, in order.
   *
   * Plain strings rather than AnalysisQuestionId, because these are read back
   * out of a JSONB column: annotating them as the union would be a claim
   * TypeScript cannot check against a driver, and the renderer only prints
   * them. Validation already happened at write time, in parseParagraphMap.
   */
  sections: string[][]
}

export interface ComparisonSource {
  title: string
  domain: string
  chars: number
}

export interface ComparisonReport {
  title: string
  year: number | null
  mediaType: 'movie' | 'series'
  promptVersion: number
  sources: ComparisonSource[]
  retrievedChars: number
  prompt: string | null
  entries: ComparisonEntry[]
  startedAt: string
  finishedAt: string | null
}

const RULE = '='.repeat(72)
const THIN = '-'.repeat(72)

/**
 * Words per entry, because "which is better" is often decided on length before
 * anything else and counting it by eye is exactly the tedium this replaces.
 *
 * Whitespace-split rather than a locale-aware segmenter: it is a rough measure
 * printed beside the prose it describes, and over-precision here would imply
 * the number means more than it does.
 */
function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 90) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

/**
 * The per-entry stat line.
 *
 * Reasoning tokens are named separately whenever the provider reported any,
 * because a model that spent its whole allowance thinking produces a short or
 * truncated analysis and the total alone cannot say so — the failure this
 * repo has already paid for twice.
 */
function statLine(entry: ComparisonEntry): string {
  const parts: string[] = []
  if (entry.analysis) parts.push(`${wordCount(entry.analysis)} words`)
  parts.push(formatDuration(entry.durationMs))
  if (entry.inputTokens != null) parts.push(`${entry.inputTokens} in`)
  if (entry.outputTokens != null) parts.push(`${entry.outputTokens} out`)
  if (entry.reasoningTokens != null && entry.reasoningTokens > 0) {
    parts.push(`${entry.reasoningTokens} reasoning`)
  }
  if (entry.grade) parts.push(`sources: ${entry.grade}`)
  if (entry.finishReason) parts.push(`finish: ${entry.finishReason}`)
  return parts.join('  ·  ')
}

/**
 * The headings the model claimed, as one line.
 *
 * Ids rather than the panel's English labels: this file has no i18n and the
 * report is a working document, so the vocabulary the prompt uses is the least
 * ambiguous thing to print. A model that merged two questions shows both, which
 * is precisely the structural difference worth comparing.
 */
function sectionLine(entry: ComparisonEntry): string | null {
  if (entry.sections.length === 0) return null
  return entry.sections
    .map((questions, i) => `${i + 1}. ${questions.length ? questions.join('+') : '—'}`)
    .join('   ')
}

/** Why this entry has no prose, in a sentence a reader can act on. */
function failureLine(entry: ComparisonEntry): string {
  if (entry.status === 'pending') return '[not run]'
  if (entry.error) return `[failed] ${entry.error}`
  if (entry.problem) return `[unusable] the response broke the output contract: ${entry.problem}`
  return '[no output]'
}

export function renderComparisonReport(report: ComparisonReport): string {
  const out: string[] = []
  const heading = report.year ? `${report.title} (${report.year})` : report.title

  out.push(RULE)
  out.push(`TITLE ANALYSIS — MODEL COMPARISON`)
  out.push(`${heading}  [${report.mediaType}]`)
  out.push(RULE)
  out.push('')

  // The control, stated before any answer. Every entry below answered one
  // prompt built from these documents, which is the only reason the answers can
  // be read against each other at all.
  out.push(`Prompt version: ${report.promptVersion}`)
  out.push(`Started: ${report.startedAt}${report.finishedAt ? `   Finished: ${report.finishedAt}` : ''}`)
  out.push(
    `Sources: ${report.sources.length} document(s), ${report.retrievedChars.toLocaleString('en-US')} characters retrieved`
  )
  for (const source of report.sources) {
    out.push(`  - ${source.domain} — ${source.title} (${source.chars.toLocaleString('en-US')} chars)`)
  }
  out.push('')
  out.push('Every model below answered the SAME prompt built from those documents.')
  out.push('')

  for (const [i, entry] of report.entries.entries()) {
    out.push(THIN)
    out.push(`[${i + 1}] ${entry.provider} / ${entry.model}`)
    const stats = statLine(entry)
    if (stats) out.push(stats)
    const sections = sectionLine(entry)
    if (sections) out.push(`sections: ${sections}`)
    out.push(THIN)
    out.push('')
    out.push(entry.analysis?.trim() || failureLine(entry))
    out.push('')
  }

  if (report.prompt) {
    out.push(RULE)
    out.push('THE PROMPT EVERY MODEL RECEIVED')
    out.push(RULE)
    out.push('')
    out.push(report.prompt)
    out.push('')
  }

  return out.join('\n')
}
