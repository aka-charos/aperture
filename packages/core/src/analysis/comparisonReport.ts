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
 *
 * A REPLAY PRINTS TWO RUNS. When a run replays another run's sources under a
 * newer prompt (see `replayComparison`), the older run's answers follow in a
 * BASELINE section, and the signals table pairs each model's two answers on
 * adjacent rows. The prose is still read in full; the table is what says
 * whether a named habit went down across models, which reading cannot.
 */
import { measureProse, type ProseSignals } from './proseSignals.js'

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

/** The run a replay took its sources from, with that run's answers. */
export interface ComparisonBaseline {
  runId: string
  promptVersion: number
  startedAt: string
  entries: ComparisonEntry[]
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
  /**
   * Set when this run replayed another run's sources. Absent or null means the
   * run retrieved its own, which is every run made before 0171.
   */
  replayOf?: ComparisonBaseline | null
}

const RULE = '='.repeat(72)
const THIN = '-'.repeat(72)

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
 * Words per entry, because "which is better" is often decided on length before
 * anything else and counting it by eye is exactly the tedium this replaces.
 * Reasoning tokens are named separately whenever the provider reported any,
 * because a model that spent its whole allowance thinking produces a short or
 * truncated analysis and the total alone cannot say so — the failure this
 * repo has already paid for twice.
 */
function statLine(entry: ComparisonEntry, signals: ProseSignals | null): string {
  const parts: string[] = []
  if (signals) parts.push(`${signals.words} words`)
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
 * The habit counts, spelled out under each answer so a reader can check what
 * matched against the prose directly below. See ./proseSignals.ts.
 */
function signalsLine(signals: ProseSignals): string {
  return [
    `${signals.paragraphs} paragraphs (longest ${signals.longestParagraph} sentences)`,
    `"the sources" ${signals.pointsAtSources}`,
    `unattributed ${signals.unattributed}`,
    `"rather than" ${signals.ratherThan}`,
    `left open ${signals.leftOpen}`,
    `question echoes ${signals.questionEchoes}`,
  ].join('  ·  ')
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

const signalsOf = (entry: ComparisonEntry): ProseSignals | null =>
  entry.analysis?.trim() ? measureProse(entry.analysis) : null

const SIGNAL_COLUMNS: [string, (s: ProseSignals) => number][] = [
  ['words', (s) => s.words],
  ['paras', (s) => s.paragraphs],
  ['longest', (s) => s.longestParagraph],
  ['sources', (s) => s.pointsAtSources],
  ['unattrib', (s) => s.unattributed],
  ['rather', (s) => s.ratherThan],
  ['open', (s) => s.leftOpen],
  ['echoes', (s) => s.questionEchoes],
]

interface SignalRow {
  label: string
  signals: ProseSignals | null
}

/**
 * One row per answer, a replay's pair on adjacent rows.
 *
 * Paired by provider AND model, since two providers can serve one id. A
 * baseline answer with no partner in this run is still printed, after the
 * pairs, for the same reason a failed entry is: omitting it misreports the run.
 */
function signalRows(report: ComparisonReport): SignalRow[] {
  const baseline = report.replayOf
  const current = report.entries.map((entry, i) => ({
    entry,
    label: `${baseline ? `v${report.promptVersion} ` : ''}[${i + 1}] ${entry.provider} / ${entry.model}`,
  }))
  if (!baseline) return current.map(({ entry, label }) => ({ label, signals: signalsOf(entry) }))

  const baseRows = baseline.entries.map((entry, i) => ({
    entry,
    label: `v${baseline.promptVersion} [b${i + 1}] ${entry.provider} / ${entry.model}`,
    used: false,
  }))

  const rows: SignalRow[] = []
  for (const { entry, label } of current) {
    rows.push({ label, signals: signalsOf(entry) })
    const partner = baseRows.find(
      (row) => !row.used && row.entry.provider === entry.provider && row.entry.model === entry.model
    )
    if (partner) {
      partner.used = true
      rows.push({ label: partner.label, signals: signalsOf(partner.entry) })
    }
  }
  for (const row of baseRows) {
    if (!row.used) rows.push({ label: row.label, signals: signalsOf(row.entry) })
  }
  return rows
}

function signalsTable(rows: SignalRow[]): string[] {
  const width = Math.max(5, ...rows.map((row) => row.label.length)) + 2
  const cell = (value: string) => value.padStart(9)
  return [
    `${'answer'.padEnd(width)}${SIGNAL_COLUMNS.map(([name]) => cell(name)).join('')}`,
    ...rows.map(
      (row) =>
        `${row.label.padEnd(width)}${
          row.signals
            ? SIGNAL_COLUMNS.map(([, read]) => cell(String(read(row.signals!)))).join('')
            : cell('—')
        }`
    ),
  ]
}

function pushEntry(out: string[], label: string, entry: ComparisonEntry): void {
  const signals = signalsOf(entry)
  out.push(THIN)
  out.push(`${label} ${entry.provider} / ${entry.model}`)
  out.push(statLine(entry, signals))
  if (signals) out.push(signalsLine(signals))
  const sections = sectionLine(entry)
  if (sections) out.push(`sections: ${sections}`)
  out.push(THIN)
  out.push('')
  out.push(entry.analysis?.trim() || failureLine(entry))
  out.push('')
}

export function renderComparisonReport(report: ComparisonReport): string {
  const out: string[] = []
  const heading = report.year ? `${report.title} (${report.year})` : report.title
  const baseline = report.replayOf ?? null

  out.push(RULE)
  out.push(baseline ? `TITLE ANALYSIS — PROMPT REPLAY` : `TITLE ANALYSIS — MODEL COMPARISON`)
  out.push(`${heading}  [${report.mediaType}]`)
  out.push(RULE)
  out.push('')

  // The control, stated before any answer. Every entry below answered one
  // prompt built from these documents, which is the only reason the answers can
  // be read against each other at all.
  out.push(`Prompt version: ${report.promptVersion}`)
  if (baseline) {
    out.push(
      `Replaying run ${baseline.runId} (prompt version ${baseline.promptVersion}, started ${baseline.startedAt})`
    )
  }
  out.push(`Started: ${report.startedAt}${report.finishedAt ? `   Finished: ${report.finishedAt}` : ''}`)
  out.push(
    baseline
      ? `Sources: ${report.sources.length} document(s), ${report.retrievedChars.toLocaleString('en-US')} characters, retrieved for that run and reused unchanged — nothing was retrieved again`
      : `Sources: ${report.sources.length} document(s), ${report.retrievedChars.toLocaleString('en-US')} characters retrieved`
  )
  for (const source of report.sources) {
    out.push(`  - ${source.domain} — ${source.title} (${source.chars.toLocaleString('en-US')} chars)`)
  }
  out.push('')
  out.push('Every model below answered the SAME prompt built from those documents.')
  if (baseline) {
    out.push(
      `The BASELINE section after them holds that run's answers to prompt version ${baseline.promptVersion}, built from the same documents.`
    )
  }
  out.push('')

  const rows = signalRows(report)
  if (rows.length > 0) {
    out.push('SIGNALS — counts of habits the prompt asks the model to avoid (see proseSignals.ts)')
    out.push(...signalsTable(rows))
    out.push('')
  }

  for (const [i, entry] of report.entries.entries()) {
    pushEntry(out, `[${i + 1}]`, entry)
  }

  if (baseline) {
    out.push(RULE)
    out.push(`BASELINE — run ${baseline.runId}, prompt version ${baseline.promptVersion}`)
    out.push(RULE)
    out.push('')
    for (const [i, entry] of baseline.entries.entries()) {
      pushEntry(out, `[b${i + 1}]`, entry)
    }
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
