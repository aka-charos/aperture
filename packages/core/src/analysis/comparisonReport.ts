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
  /** The prompt version this answer was written under (0172). */
  promptVersion: number
  /**
   * The variant that answered, or null for the version's own questions and
   * rules (0179). Absent on entries built before variants existed.
   */
  promptVariant?: string | null
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
  /**
   * The map block exactly as the model wrote it, stored whether or not it was
   * readable. Printed only when no labels came out of it, so a rejected map
   * can be read in the report instead of fetched from the database. Absent on
   * entries built without it.
   */
  mapText?: string | null
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
  /** The newest version the run answered; see `prompts` for all of them. */
  promptVersion: number
  sources: ComparisonSource[]
  retrievedChars: number
  prompt: string | null
  /**
   * One prompt per version, oldest first, when the run answered more than the
   * single `prompt` (0172). Absent or null on older runs.
   */
  prompts?: { version: number; variant?: string | null; text: string }[] | null
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
  const mapped = signals.mapped
  return [
    `${signals.paragraphs} paragraphs (longest ${signals.longestParagraph} sentences)`,
    `"the sources" ${signals.pointsAtSources}`,
    `unattributed ${signals.unattributed}`,
    `"rather than" ${signals.ratherThan}`,
    `left open ${signals.leftOpen}`,
    `question echoes ${signals.questionEchoes}`,
    // The phrases are printed, not just counted: this is the one signal whose
    // matches a reader has to judge (a critic cited twice is not a repeat).
    !mapped
      ? 'told twice — (no map)'
      : signals.repeatedAcrossSections > 0
      ? `told twice ${signals.repeatedAcrossSections} (${signals.repeatedPhrases.slice(0, 4).join(', ')}${
          signals.repeatedAcrossSections > 4 ? ', …' : ''
        })`
      : 'told twice 0',
    `writers outside reception ${mapped ? signals.spill : '—'}`,
    `quality words outside reception ${mapped ? signals.praise : '—'}`,
    `awards named ${signals.awards}`,
    `semicolons ${signals.semicolons}`,
    mapped
      ? `reception ${signals.receptionWords} words, work ${signals.workWords}${
          signals.receptionWords > signals.workWords ? ' (reception longer)' : ''
        }`
      : 'reception vs work —',
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

/** Longest rejected map printed, so a long block cannot swamp the report. */
const MAP_TEXT_LIMIT = 240

/**
 * Why an answer carries no section labels: the model wrote no map, or wrote
 * one that could not be read. The two have different fixes - a missing map is
 * the prompt, a rejected one is usually a miscount - and GLM's two unmapped
 * answers could only be told apart with a database query.
 */
function unmappedLine(entry: ComparisonEntry): string {
  const text = entry.mapText?.trim()
  if (!text) return 'map: none written'
  const oneLine = text.split('\n').map((line) => line.trim()).filter(Boolean).join(' | ')
  const clipped = oneLine.length > MAP_TEXT_LIMIT ? '…' : ''
  return `map not read: ${oneLine.slice(0, MAP_TEXT_LIMIT)}${clipped}`
}

/** Why this entry has no prose, in a sentence a reader can act on. */
function failureLine(entry: ComparisonEntry): string {
  if (entry.status === 'pending') return '[not run]'
  if (entry.error) return `[failed] ${entry.error}`
  if (entry.problem) return `[unusable] the response broke the output contract: ${entry.problem}`
  return '[no output]'
}

// The sections are the model's own paragraph labels, which is what lets the
// "told twice" count tell a repeated fact from one question's long answer.
const signalsOf = (entry: ComparisonEntry): ProseSignals | null =>
  entry.analysis?.trim() ? measureProse(entry.analysis, entry.sections) : null

/**
 * A count read from the model's paragraph labels is a dash, not a zero, when
 * there were no labels: GLM's unmapped Terminator 2 answer read as clean on
 * "twice" and "spill" when neither had been measured.
 */
const labelled = (read: (s: ProseSignals) => number | string) => (s: ProseSignals) =>
  s.mapped ? read(s) : '—'

// "rec/work" carries a "!" when reception ran longer than the work answer,
// which the prompt forbids.
const SIGNAL_COLUMNS: [string, (s: ProseSignals) => number | string][] = [
  ['words', (s) => s.words],
  ['paras', (s) => s.paragraphs],
  ['longest', (s) => s.longestParagraph],
  ['sources', (s) => s.pointsAtSources],
  ['unattrib', (s) => s.unattributed],
  ['rather', (s) => s.ratherThan],
  ['open', (s) => s.leftOpen],
  ['echoes', (s) => s.questionEchoes],
  ['twice', labelled((s) => s.repeatedAcrossSections)],
  ['spill', labelled((s) => s.spill)],
  ['praise', labelled((s) => s.praise)],
  ['awards', (s) => s.awards],
  ['semi', (s) => s.semicolons],
  [
    'rec/work',
    labelled((s) => `${s.receptionWords}/${s.workWords}${s.receptionWords > s.workWords ? '!' : ''}`),
  ],
]

interface SignalRow {
  label: string
  signals: ProseSignals | null
}

/**
 * One row per answer, every answer a model gave on adjacent rows.
 *
 * Grouped by provider AND model (two providers can serve one id), in the order
 * each model first appears, and stable inside a group - so a model's prompt
 * versions read oldest to newest, and a replay's baseline answers follow this
 * run's. A baseline model this run did not repeat still gets its rows, for the
 * same reason a failed entry does: omitting it misreports the run.
 */
function signalRows(report: ComparisonReport): SignalRow[] {
  const labelled = [
    ...report.entries.map((entry, i) => ({ entry, label: `[${i + 1}] ${entryName(entry)}` })),
    ...(report.replayOf?.entries ?? []).map((entry, i) => ({
      entry,
      label: `[b${i + 1}] ${entryName(entry)}`,
    })),
  ]

  const groupOf = new Map<string, number>()
  for (const { entry } of labelled) {
    const key = `${entry.provider}::${entry.model}`
    if (!groupOf.has(key)) groupOf.set(key, groupOf.size)
  }

  return labelled
    .map((row, index) => ({ row, index, group: groupOf.get(`${row.entry.provider}::${row.entry.model}`)! }))
    .sort((a, b) => a.group - b.group || a.index - b.index)
    .map(({ row }) => ({ label: row.label, signals: signalsOf(row.entry) }))
}

/**
 * Which prompt an answer was written under: "15", or "15 compact".
 *
 * The same spelling as prompt.ts's promptChoiceLabel, which names a choice for
 * the logs and the picker. Repeated here rather than imported to keep this
 * module readable on its own, the way its own header asks for.
 */
function promptName(entry: { promptVersion: number; promptVariant?: string | null }): string {
  return entry.promptVariant
    ? `${entry.promptVersion} ${entry.promptVariant}`
    : String(entry.promptVersion)
}

/** How an answer is named everywhere in the report: model, then prompt. */
function entryName(entry: ComparisonEntry): string {
  return `${entry.provider} / ${entry.model} · v${promptName(entry)}`
}

/**
 * The distinct prompts this run answered, oldest first, a variant after the
 * version it varies.
 */
function versionsOf(report: ComparisonReport): string[] {
  const seen = new Map<string, { version: number; variant: string; name: string }>()
  for (const entry of report.entries) {
    const variant = entry.promptVariant ?? ''
    const key = `${entry.promptVersion}:${variant}`
    if (!seen.has(key)) {
      seen.set(key, { version: entry.promptVersion, variant, name: promptName(entry) })
    }
  }
  if (seen.size === 0) return [String(report.promptVersion)]
  return [...seen.values()]
    .sort((a, b) => a.version - b.version || a.variant.localeCompare(b.variant))
    .map((prompt) => prompt.name)
}

/** A prompt from its TASK line on — the part that differs between versions. */
function fromTask(prompt: string): string {
  const at = prompt.lastIndexOf('\nTASK\n')
  return at >= 0 ? prompt.slice(at + 1) : prompt
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
  out.push(`${label} ${entryName(entry)}`)
  out.push(statLine(entry, signals))
  if (signals) out.push(signalsLine(signals))
  const sections = sectionLine(entry)
  if (sections) out.push(`sections: ${sections}`)
  else if (signals) out.push(unmappedLine(entry))
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
  const versions = versionsOf(report)
  out.push(
    versions.length > 1
      ? `Prompt versions: ${versions.join(', ')}`
      : `Prompt version: ${versions[0]}`
  )
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
  out.push(
    versions.length > 1
      ? 'Every answer below was written from those same documents, retrieved once. The prompt versions differ only in their questions and rules - everything above the TASK line is identical.'
      : 'Every model below answered the SAME prompt built from those documents.'
  )
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

  // Several versions: the newest in full, then each older one from its TASK
  // line only. Everything above TASK is the same documents, and printing the
  // source block once per version would bury the part that actually differs.
  // Newest first, and a version's own prompt ahead of its variants: the one
  // printed in full has to be the one the others are said to match above TASK.
  const prompts =
    report.prompts && report.prompts.length > 1
      ? [...report.prompts].sort(
          (a, b) => b.version - a.version || (a.variant ?? '').localeCompare(b.variant ?? '')
        )
      : null
  if (prompts) {
    const [newest, ...older] = prompts
    const nameOf = (prompt: { version: number; variant?: string | null }) =>
      promptName({ promptVersion: prompt.version, promptVariant: prompt.variant })
    out.push(RULE)
    out.push('THE PROMPTS')
    out.push(RULE)
    out.push('')
    out.push(`--- PROMPT VERSION ${nameOf(newest)}, in full ---`)
    out.push('')
    out.push(newest.text)
    out.push('')
    for (const prompt of older) {
      out.push(
        `--- PROMPT VERSION ${nameOf(prompt)}, from TASK on (everything above it is identical to version ${nameOf(newest)}) ---`
      )
      out.push('')
      out.push(fromTask(prompt.text))
      out.push('')
    }
  } else if (report.prompt) {
    out.push(RULE)
    out.push('THE PROMPT EVERY MODEL RECEIVED')
    out.push(RULE)
    out.push('')
    out.push(report.prompt)
    out.push('')
  }

  return out.join('\n')
}
