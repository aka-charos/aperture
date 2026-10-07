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
import { extractPromptSources } from './prompt.js'
import {
  measureProse,
  namesFromDocuments,
  writerNamesFromSources,
  type ProseSignals,
} from './proseSignals.js'

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
  /**
   * True when the curated criticism search supplied this document.
   *
   * Absent on every run stored before that search existed, so a report with
   * none cannot claim the search found nothing - see `criticismLine`.
   */
  curated?: boolean
  /**
   * What the scraper returned for this page, against `chars` - what the model
   * read. The gap is site furniture plus whatever the budget cut, and until
   * these sat beside each other the report could not say which.
   *
   * Absent on a replay (its documents come back out of a stored prompt) and on
   * every run stored before the measurement existed.
   */
  fetchedChars?: number
  /** What ./sourceCleanup.ts removed. Absent means none, or not measured. */
  strippedChars?: number
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
  /**
   * What the optional decision-model source filter did to this retrieval.
   *
   * ABSENT MEANS IT WAS NOT ASKED - the switch is off, the run predates it, or
   * there were too few documents for a drop to be possible. That is the normal
   * state and it is deliberately NOT rendered as "nothing was dropped", for
   * `criticismLine`'s reason one step over: the two are different facts, and
   * printing the second where the first is true sends an operator to debug a
   * filter that is switched off.
   */
  judgedSources?: JudgedSourceReport | null
}

export interface JudgedSourceReport {
  dropped: Array<{ domain: string; title: string; score: number; chars: number }>
  /**
   * Every document's score, kept and dropped alike. Absent on runs stored
   * before it was carried, which is why the renderer falls back to printing
   * the drops alone rather than claiming nothing was near the bar.
   */
  scores?: Array<{ domain: string; score: number | null; kept: boolean }>
  /** A rail stopped a drop the model asked for: this retrieval was mostly noise. */
  floored: boolean
}

/**
 * Read the stored column, or null.
 *
 * ANNOTATING A JSONB READ IS A CLAIM TYPESCRIPT CANNOT CHECK — the trap this
 * file already documents for `ComparisonEntry.sections` ("read back out of a
 * JSONB column: annotating them as the union would be a claim TypeScript
 * cannot check against a driver"). `judged_sources` was cast straight to this
 * interface, and the renderer calls `score.toFixed(2)`, so one malformed row
 * would throw inside `renderComparisonReport` and take the WHOLE report down —
 * every entry, every prompt — rather than losing one line. Only this app writes
 * the column today, which makes it a latent fault rather than a live one, and
 * the cost of being wrong is the whole deliverable.
 *
 * A row that fails to parse reads as NOT ASKED, which is the same answer an
 * older run gives and the one the report already renders as silence.
 */
export function readJudgedSourceReport(value: unknown): JudgedSourceReport | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { dropped?: unknown; scores?: unknown; floored?: unknown }
  if (!Array.isArray(raw.dropped)) return null
  const dropped: JudgedSourceReport['dropped'] = []
  for (const entry of raw.dropped) {
    if (!entry || typeof entry !== 'object') continue
    const d = entry as Record<string, unknown>
    // A number is required because the renderer formats it; the strings are
    // not, since a missing label costs a word and never a throw.
    if (typeof d.score !== 'number' || !Number.isFinite(d.score)) continue
    dropped.push({
      domain: typeof d.domain === 'string' ? d.domain : '(unknown host)',
      title: typeof d.title === 'string' ? d.title : '',
      score: d.score,
      chars: typeof d.chars === 'number' && Number.isFinite(d.chars) ? d.chars : 0,
    })
  }
  const scores = Array.isArray(raw.scores)
    ? raw.scores.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const s = entry as Record<string, unknown>
        const score = typeof s.score === 'number' && Number.isFinite(s.score) ? s.score : null
        return [{
          domain: typeof s.domain === 'string' ? s.domain : '(unknown host)',
          score,
          kept: s.kept === true,
        }]
      })
    : undefined
  return { dropped, ...(scores && scores.length > 0 ? { scores } : {}), floored: raw.floored === true }
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
function statLine(
  entry: ComparisonEntry,
  signals: ProseSignals | null,
  caps: LengthCaps | null
): string {
  const parts: string[] = []
  if (signals) parts.push(`${against(signals.words, caps?.words)} words`)
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
function signalsLine(signals: ProseSignals, caps: LengthCaps | null): string {
  const mapped = signals.mapped
  return [
    `${against(signals.paragraphs, caps?.paragraphs)} paragraphs (longest ${
      signals.longestParagraph
    } sentences, ${against(signals.longestParagraphWords, caps?.paragraphWords)} words)`,
    `points at the documents ${signals.pointsAtSources}`,
    // Printed like "told twice", and for the same reason: the names come from
    // this run's own source titles, so a reader has to be able to see whether
    // the match is a critic or a false positive.
    signals.namedWriters > 0
      ? `names a writer ${signals.namedWriters} (${signals.namedWriterMatches.join(', ')})`
      : 'names a writer 0',
    `labels left in the prose ${signals.inlineLabels}`,
    `answers split across non-adjacent paragraphs ${mapped ? signals.scattered : '—'}`,
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

/**
 * A rejected answer says it was rejected, EVEN WHEN IT HAS PROSE.
 *
 * The failure line below only ever printed when there was nothing else to
 * print, so a model that broke the contract and still wrote something
 * rendered identically to one that succeeded. Measured on the Suspiria
 * bench: ornith-1.5-9b failed BOTH its entries - one labelling six of ten
 * paragraphs, one running to 304 with no closing contract line - and both
 * read as answers, while the database had them as unusable all along. The
 * library would have thrown both and rotated to the next model, so a report
 * that does not say so is describing a different run from the one the job
 * would have made.
 */
function rejectedLine(entry: ComparisonEntry): string {
  return (
    `[UNUSABLE] the response broke the output contract: ${entry.problem}. The library would` +
    ` have rejected this and moved to the next model. The prose below is printed so the` +
    ` failure can be read, not because it is an answer.`
  )
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
// The writer names come from THIS RUN's source titles, which is what makes
// "names a writer" measurable at all: the names a model reaches for are the
// ones the retrieval just handed it. A replay's baseline answers were written
// from the same documents, so they take the same list.
const signalsOf = (
  entry: ComparisonEntry,
  writerNames: readonly string[]
): ProseSignals | null =>
  entry.analysis?.trim() ? measureProse(entry.analysis, entry.sections, writerNames) : null

/**
 * A count read from the model's paragraph labels is a dash, not a zero, when
 * there were no labels: GLM's unmapped Terminator 2 answer read as clean on
 * "twice" and "spill" when neither had been measured.
 */
const labelled =
  (read: (s: ProseSignals) => number | string) =>
  (s: ProseSignals): number | string =>
    s.mapped ? read(s) : '—'

// "rec/work" carries a "!" when reception ran longer than the work answer,
// which the prompt forbids.
const SIGNAL_COLUMNS: [
  string,
  (s: ProseSignals, caps: LengthCaps | null) => number | string,
][] = [
  ['words', (s, caps) => against(s.words, caps?.words)],
  ['paras', (s, caps) => against(s.paragraphs, caps?.paragraphs)],
  ['longest', (s) => s.longestParagraph],
  ['longest-w', (s, caps) => against(s.longestParagraphWords, caps?.paragraphWords)],
  ['sources', (s) => s.pointsAtSources],
  ['named', (s) => s.namedWriters],
  ['labels', (s) => s.inlineLabels],
  ['split', labelled((s) => s.scattered)],
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

/**
 * What each prompt version's length rule actually states, so the report can say
 * when an answer went over instead of printing a number nobody checks.
 *
 * Measured on the second Suspiria bench, where one answer ran to 9 paragraphs
 * and 684 words against version 16's 8 and 650, and the table printed "9" and
 * "684" beside a passing row.
 *
 * A TABLE RATHER THAN A PARSE of the rule text. Parsing prose would track a
 * rewording automatically and would also break on one, silently, which is worse
 * for an instrument than a stale number - and `comparisonReport.test.ts` asserts
 * every figure here still appears in that edition's own rules, so a reworded
 * length rule fails there rather than drifting.
 *
 * Versions 7 and 8 set no paragraph cap and 9 to 15 state theirs as "about ten
 * short paragraphs", which is an anchor and not a limit - so their counts are
 * flagged generously. Only version 16 states a word cap PER PARAGRAPH.
 */
interface LengthCaps {
  words: number
  paragraphs?: number
  /** The point at which one paragraph is carrying too much. */
  paragraphWords?: number
}

const LENGTH_CAPS: ReadonlyMap<number, LengthCaps> = new Map([
  [7, { words: 900 }],
  [8, { words: 900 }],
  [9, { words: 900, paragraphs: 10 }],
  [10, { words: 900, paragraphs: 10 }],
  [11, { words: 900, paragraphs: 10 }],
  [12, { words: 900, paragraphs: 10 }],
  [13, { words: 900, paragraphs: 10 }],
  [14, { words: 900, paragraphs: 10 }],
  [15, { words: 900, paragraphs: 10 }],
  [16, { words: 650, paragraphs: 8, paragraphWords: 150 }],
  // 17 carries 16's length rule unchanged.
  [17, { words: 650, paragraphs: 8, paragraphWords: 150 }],
  // Version 18 states "around 600 words" and "about eight paragraphs" and drops
  // the paragraph-word anchor, on the operator's call that length should drift.
  // So there is no paragraphWords entry to flag against: measured on 42 live
  // version-17 rows, a third ran over the 150 and the prose was not worse for
  // it. `longest-w` is still printed, and is now descriptive rather than a cap.
  [18, { words: 600, paragraphs: 8 }],
])

/**
 * The caps an entry answered under, or null when the build no longer carries
 * that version. A variant keeps its base version's length rule unless it
 * replaced it, which is not knowable from here - so a variant is flagged
 * against its base and the note above says so.
 */
export function lengthCapsFor(version: number): LengthCaps | null {
  return LENGTH_CAPS.get(version) ?? null
}

/** A count, with "!" when the prompt asked for fewer. */
const against = (value: number, cap: number | undefined): string =>
  cap != null && value > cap ? `${value}!` : String(value)

interface SignalRow {
  label: string
  signals: ProseSignals | null
  /** Null when this build no longer carries the version that answered. */
  caps: LengthCaps | null
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
function signalRows(report: ComparisonReport, writerNames: readonly string[]): SignalRow[] {
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
    .map(({ row }) => ({
      label: row.entry.problem ? `${row.label} [unusable]` : row.label,
      signals: signalsOf(row.entry, writerNames),
      caps: lengthCapsFor(row.entry.promptVersion),
    }))
}

/**
 * Which prompt an answer was written under: "15", or "15 compact".
 *
 * The same spelling as prompt.ts's promptChoiceLabel, which names a choice for
 * the logs and the picker. Repeated here rather than imported to keep this
 * module readable on its own, the way its own header asks for.
 */
/**
 * One line saying what the curated criticism search contributed.
 *
 * IT MUST NOT CLAIM THE SEARCH FOUND NOTHING when no source carries the flag.
 * Three different things produce a zero here - the search ran and the twenty
 * publications had nothing on this title, the run predates the curated search,
 * or the build being measured does not have it - and this list cannot tell them
 * apart. Saying "no criticism documents" would read as the first, which is the
 * reading that sends someone to debug a query that is working. The container
 * log is what separates them, and the line says so.
 */
export function criticismLine(sources: readonly ComparisonSource[]): string {
  const found = sources.filter((s) => s.curated === true).length
  if (found > 0) {
    return `Of these, ${found} came from the curated criticism search, marked [criticism] below.`
  }
  return 'None are marked as coming from the curated criticism search — either it found nothing on those publications for this title, or this run was made without it.'
}

/**
 * What the decision model took out of the retrieval, if it was asked.
 *
 * SILENT WHEN IT WAS NOT, which is `criticismLine`'s rule applied to a filter
 * rather than a search: absent and "asked, dropped nothing" are different
 * facts about this run, and only one of them says anything about the pages.
 * When it WAS asked and kept everything, that is worth a line of its own -
 * that is the operator's evidence the filter is not quietly eating documents.
 *
 * The scores are printed. A list of domains says what went; the probability
 * beside each is what makes the decision arguable, and this is the only place
 * outside the container log where it can be read.
 */
export function judgedSourcesLines(judged: JudgedSourceReport | null | undefined): string[] {
  if (!judged) return []
  if (judged.dropped.length === 0) {
    return ['A decision model read every document above and ruled none of them out.']
  }
  const chars = judged.dropped.reduce((sum, d) => sum + d.chars, 0)
  const lines = [
    `A decision model ruled out ${judged.dropped.length} further document(s), ${chars.toLocaleString(
      'en-US'
    )} characters, before the budget ran:`,
  ]
  for (const d of judged.dropped) {
    lines.push(`  - ${d.domain} — ${d.title} (${d.chars.toLocaleString('en-US')} chars, scored ${d.score.toFixed(2)})`)
  }
  if (judged.floored) {
    lines.push(
      '  It wanted to drop more and was stopped by the floor, so what survives includes pages it ruled out.'
    )
  }
  for (const line of scoreLines(judged)) lines.push(line)
  return lines
}

/**
 * Every document's score, worst first.
 *
 * THE NEAR-MISSES ARE THE POINT. With only the drops printed, a page that
 * survived left nothing to reason about: on the first live run `bfi.org.uk`
 * was kept and the report could not say whether it scored just over the bar or
 * nowhere near it, which are a bar problem and a criteria problem and have
 * opposite fixes. Worst first so the ones closest to going are read first.
 */
function scoreLines(judged: JudgedSourceReport): string[] {
  const scores = judged.scores
  if (!scores || scores.length === 0) return []
  const ranked = [...scores].sort((a, b) => (a.score ?? 2) - (b.score ?? 2))
  return [
    '  What it scored every document, worst first:',
    ...ranked.map(
      (s) =>
        `    ${s.score == null ? ' not answered' : s.score.toFixed(2).padStart(13)}  ` +
        `${s.kept ? 'kept   ' : 'dropped'}  ${s.domain}`
    ),
  ]
}

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

/**
 * What a document cost against what it delivered.
 *
 * "6,392 chars" alone cannot say whether a slot went on an article or on a
 * navigation menu, which is the question the second Requiem bench could not
 * answer about its own retrieval. Printed only where the numbers exist, so a
 * replay and every older run read exactly as they did before.
 */
function sourceSize(source: ComparisonSource): string {
  const n = (value: number) => value.toLocaleString('en-US')
  const parts = [`${n(source.chars)} chars`]
  if (source.fetchedChars != null) parts.push(`of ${n(source.fetchedChars)} fetched`)
  if (source.strippedChars) parts.push(`${n(source.strippedChars)} stripped`)
  return parts.join(', ')
}

/** A prompt from its TASK line on — the part that differs between versions. */
function fromTask(prompt: string): string {
  const at = prompt.lastIndexOf('\nTASK\n')
  return at >= 0 ? prompt.slice(at + 1) : prompt
}

function signalsTable(rows: SignalRow[]): string[] {
  const width = Math.max(5, ...rows.map((row) => row.label.length)) + 2
  // Ten, because 'longest-w' is nine characters and the header ran together.
  const cell = (value: string) => value.padStart(10)
  return [
    `${'answer'.padEnd(width)}${SIGNAL_COLUMNS.map(([name]) => cell(name)).join('')}`,
    ...rows.map(
      (row) =>
        `${row.label.padEnd(width)}${
          row.signals
            ? SIGNAL_COLUMNS.map(([, read]) => cell(String(read(row.signals!, row.caps)))).join('')
            : cell('—')
        }`
    ),
  ]
}

function pushEntry(
  out: string[],
  label: string,
  entry: ComparisonEntry,
  writerNames: readonly string[]
): void {
  const signals = signalsOf(entry, writerNames)
  const caps = lengthCapsFor(entry.promptVersion)
  out.push(THIN)
  out.push(`${label} ${entryName(entry)}`)
  out.push(statLine(entry, signals, caps))
  if (entry.problem && entry.analysis?.trim()) out.push(rejectedLine(entry))
  if (signals) out.push(signalsLine(signals, caps))
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
  const fetchedTotal = report.sources.reduce((sum, s) => sum + (s.fetchedChars ?? 0), 0)
  const strippedTotal = report.sources.reduce((sum, s) => sum + (s.strippedChars ?? 0), 0)
  if (fetchedTotal > 0) {
    out.push(
      `  The scraper returned ${fetchedTotal.toLocaleString('en-US')} characters; ${strippedTotal.toLocaleString(
        'en-US'
      )} were stripped as site furniture or plot sections, and the budget cut the rest.`
    )
  }
  out.push(`  ${criticismLine(report.sources)}`)
  for (const line of judgedSourcesLines(report.judgedSources)) out.push(`  ${line}`)
  for (const source of report.sources) {
    // The marker is what makes the curated search legible at all: without it
    // the only way to tell a film journal from a content farm in this list is
    // to recognise the domain by eye.
    const mark = source.curated === true ? ' [criticism]' : ''
    out.push(`  - ${source.domain} — ${source.title} (${sourceSize(source)})${mark}`)
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

  // The film's own name is excluded: a site puts it where a byline goes.
  //
  // The document BODIES are read too, because on an aggregator-heavy
  // retrieval the titles carry no critic at all and the bylines carry them
  // all. The texts come back out of the stored prompt, the way a replay
  // recovers them - they are not stored per source.
  const promptText = report.prompt ?? report.prompts?.[0]?.text ?? null
  const documentTexts = promptText
    ? (extractPromptSources(promptText, report.sources) ?? []).map((source) => source.text)
    : []
  const writerNames = [
    ...new Set([
      ...writerNamesFromSources(report.sources, [report.title]),
      ...namesFromDocuments(documentTexts),
    ]),
  ]
  const rows = signalRows(report, writerNames)
  if (rows.length > 0) {
    out.push('SIGNALS — counts of habits the prompt asks the model to avoid (see proseSignals.ts)')
    out.push(...signalsTable(rows))
    out.push('')
  }

  for (const [i, entry] of report.entries.entries()) {
    pushEntry(out, `[${i + 1}]`, entry, writerNames)
  }

  if (baseline) {
    out.push(RULE)
    out.push(`BASELINE — run ${baseline.runId}, prompt version ${baseline.promptVersion}`)
    out.push(RULE)
    out.push('')
    for (const [i, entry] of baseline.entries.entries()) {
      pushEntry(out, `[b${i + 1}]`, entry, writerNames)
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
