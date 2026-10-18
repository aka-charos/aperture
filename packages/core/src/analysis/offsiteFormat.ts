/**
 * The two files of an offsite analysis batch, as text: what goes out, and what
 * comes back.
 *
 * Pure and DB-free so the format is pinned by a test without a database — the
 * file crosses a machine boundary, is read by a script nobody here controls
 * once it is downloaded, and is written back by that script, so the shape is a
 * contract in both directions and must not drift by accident.
 *
 * WHAT GOES OUT: one JSON object per line, each complete on its own, so a
 * runner can stream the file, skip lines it has already answered and never hold
 * the whole batch in memory. `custom_id` is the item's id and is the only key
 * the import trusts.
 *
 * WHAT COMES BACK: one line per answered title, `{ custom_id, model, text,
 * finish_reason }`, or `{ custom_id, error }` when the runner could not get an
 * answer. `text` is the model's RAW reply — reasoning blocks and all — because
 * every check is made here, on import, by the same code a normal run uses. A
 * runner that tidied the text would be a second, unpinned reader of the output
 * contract.
 */

/** Written into every exported line, so a file from a future format is recognisable. */
export const OFFSITE_FORMAT = 'aperture-analysis-offsite/1'

export interface OffsiteExportItem {
  id: string
  mediaType: 'movie' | 'series'
  title: string
  year: number | null
  /**
   * How many answers for this title the import has rejected. The runner keys
   * its resume on (id, attempt), so a rejected title is run again on the next
   * pass instead of being skipped because the results file already holds an
   * answer for its id.
   */
  attempt: number
  prompt: string
}

export interface OffsiteExportSettings {
  promptVersion: number
  promptVariant: string | null
  /** Null means no ceiling. */
  maxOutputTokens: number | null
}

/** One exported line, without its trailing newline. */
export function buildExportLine(item: OffsiteExportItem, settings: OffsiteExportSettings): string {
  return JSON.stringify({
    custom_id: item.id,
    attempt: item.attempt,
    format: OFFSITE_FORMAT,
    media_type: item.mediaType,
    title: item.title,
    year: item.year,
    prompt_version: settings.promptVersion,
    prompt_variant: settings.promptVariant,
    max_tokens: settings.maxOutputTokens,
    prompt: item.prompt,
  })
}

/** The whole batch file. Ends in a newline so appending to it stays line-safe. */
export function buildExportFile(items: OffsiteExportItem[], settings: OffsiteExportSettings): string {
  return items.map((item) => buildExportLine(item, settings) + '\n').join('')
}

export type OffsiteResult =
  | {
      kind: 'answer'
      customId: string
      /** The attempt the runner answered; 0 when a line does not say. */
      attempt: number
      model: string | null
      text: string
      /** Normalised to the OpenAI spelling, which the response checks read. */
      finishReason: string | null
      outputTokens: number | null
    }
  | { kind: 'error'; customId: string; attempt: number; error: string }

export interface ParsedOffsiteResults {
  /** One per custom_id, in the order each id first appeared. */
  results: OffsiteResult[]
  /** 1-based line numbers that were not a result line, for the import summary. */
  badLines: number[]
}

/**
 * Another runner's spelling of "the output limit was hit". `findResponseProblem`
 * reads `length`, and an answer cut off at the ceiling must be reported as
 * truncated rather than as a format fault, because the fix is a setting.
 */
function normaliseFinishReason(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const reason = value.trim()
  return reason === 'max_tokens' ? 'length' : reason
}

function readTokens(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null
  const n = (usage as Record<string, unknown>).completion_tokens
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
}

function readAttempt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

/**
 * Read a results file.
 *
 * Tolerant of what a resumed run leaves behind: blank lines, a half-written
 * last line from a killed process, and the same id more than once. For a
 * repeated id the NEWEST ATTEMPT wins (a rejected answer, then the rerun's
 * answer to the next attempt); within one attempt the later line wins, except
 * that an answer is never replaced by an error — a runner skips what it has
 * answered, so an error after an answer can only be a file stitched together by
 * hand, and the answer is the line worth keeping.
 */
export function parseOffsiteResults(jsonl: string): ParsedOffsiteResults {
  const byId = new Map<string, OffsiteResult>()
  const badLines: number[] = []

  const lines = jsonl.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (line.trim() === '') return
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      badLines.push(index + 1)
      return
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      badLines.push(index + 1)
      return
    }
    const r = row as Record<string, unknown>
    const customId = typeof r.custom_id === 'string' ? r.custom_id.trim() : ''
    if (!customId) {
      badLines.push(index + 1)
      return
    }
    const attempt = readAttempt(r.attempt)

    let result: OffsiteResult
    if (typeof r.text === 'string') {
      result = {
        kind: 'answer',
        customId,
        attempt,
        model: typeof r.model === 'string' && r.model.trim() ? r.model.trim() : null,
        text: r.text,
        finishReason: normaliseFinishReason(r.finish_reason),
        outputTokens: readTokens(r.usage),
      }
    } else if (typeof r.error === 'string' && r.error.trim()) {
      result = { kind: 'error', customId, attempt, error: r.error.trim() }
    } else {
      badLines.push(index + 1)
      return
    }

    const previous = byId.get(customId)
    if (previous) {
      if (previous.attempt > attempt) return
      if (previous.attempt === attempt && previous.kind === 'answer' && result.kind === 'error') return
    }
    // A replaced entry keeps its FIRST position: set() on an existing key does
    // not move it in a Map's order.
    byId.set(customId, result)
  })

  return { results: [...byId.values()], badLines }
}

/** What happened to one line of an imported results file. */
export type OffsiteImportOutcome =
  /** Kept: the analysis is in the library. */
  | 'stored'
  /** Read fine, and the floor declined it: a stored decline, as a normal run would write. */
  | 'declined'
  /** The answer broke the output contract. The title stays in the batch to run again. */
  | 'rejected'
  /** The runner wrote an error instead of an answer. The title stays in the batch. */
  | 'runnerError'
  /** Something else analysed this title after the batch was made; the newer row stays. */
  | 'superseded'
  /** This title's answer was already imported. */
  | 'duplicate'
  /** An answer to an earlier attempt, already judged and rejected; the rerun is what counts. */
  | 'olderAttempt'
  /** The id names a title that never made it into the file (its retrieval failed). */
  | 'notExported'
  /** The batch was built under a prompt older than the staleness floor. */
  | 'stale'
  /** No such item: another instance's file, or a deleted batch. */
  | 'unknown'
  /** The title has left the library since the batch was made. */
  | 'gone'
  /** Saving it failed (a database fault). Nothing changed; import the file again. */
  | 'importFailed'

/**
 * What to do with one result BEFORE reading its text — every reason an answer
 * is not even looked at.
 *
 * Ordered so the most informative reason wins: a re-imported file reports
 * "already imported" rather than "superseded" for titles it stored itself,
 * because `analysedAt` for those is the import's own write.
 */
export function importPrecheck(input: {
  itemStatus: string
  batchPromptVersion: number
  staleBelow: number
  /** When `title_analysis` was last written for this title, or null for never. */
  analysedAt: Date | null
  batchCreatedAt: Date
  resultKind: OffsiteResult['kind']
  /** The attempt the answer was written for, and the one the item is on now. */
  resultAttempt: number
  itemAttempt: number
}): { action: 'read' } | { action: 'skip'; outcome: OffsiteImportOutcome } {
  if (['stored', 'declined', 'skipped'].includes(input.itemStatus)) {
    return { action: 'skip', outcome: 'duplicate' }
  }
  if (input.itemStatus !== 'ready' && input.itemStatus !== 'rejected') {
    return { action: 'skip', outcome: 'notExported' }
  }
  // Already judged: that answer was rejected and the item moved on. Judging it
  // again would only reject it again, and could overwrite the rejection of
  // the newer attempt with an older reason.
  if (input.resultAttempt < input.itemAttempt) {
    return { action: 'skip', outcome: 'olderAttempt' }
  }
  // Stored under a version below the floor, the row would be stale the moment
  // it was written and the library job would queue the title straight back.
  if (input.batchPromptVersion < input.staleBelow) {
    return { action: 'skip', outcome: 'stale' }
  }
  // Strictly after the batch was made: a row written BEFORE it is the stale
  // one the batch exists to replace (that is why the title was pending).
  if (input.analysedAt && input.analysedAt.getTime() > input.batchCreatedAt.getTime()) {
    return { action: 'skip', outcome: 'superseded' }
  }
  if (input.resultKind === 'error') return { action: 'skip', outcome: 'runnerError' }
  return { action: 'read' }
}

/** "aperture-analysis-<first 8 of the id>.jsonl" — names one batch on disk. */
export function exportFileName(batchId: string): string {
  return `aperture-analysis-${batchId.slice(0, 8)}.jsonl`
}
