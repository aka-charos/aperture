/**
 * Offsite title analysis: build the prompts here, run the model on another
 * machine, import the answers.
 *
 * WHY. Retrieval needs this server — fastCRW, the source filters, the budget —
 * but the model call does not, and the fastest hardware an operator owns is not
 * always the one Aperture runs on. A batch takes N pending titles, retrieves
 * and builds each prompt exactly as the library job would, and stores them. The
 * file goes to the other machine, a runner (./offsiteRunner.ts) sends each
 * prompt to a local model, and the results file comes back through
 * `importOffsiteResults`.
 *
 * THE ONE RULE IS THAT AN IMPORTED ANSWER IS JUDGED EXACTLY LIKE A LOCAL ONE.
 * `readAnalysis` holds it to the output contract and `storeAnalysisOutcome`
 * applies the floor, the map check and the insert — the same two functions the
 * library job calls, never copies. What differs is only what happens to an
 * answer that broke the contract: the library job retries and falls back to
 * another model, an import has nobody to ask, so it reports the title and keeps
 * it in the batch to run again.
 *
 * RESERVATION. While a batch is open its unanswered titles sit in the
 * `analysis_offsite_reservations` view, which the pending predicate joins
 * (./pending.ts), so the library job and the next batch leave them alone — a
 * title is not paid for twice. A batch is open until it is closed, deleted, or
 * `OFFSITE_RESERVATION_DAYS` pass.
 *
 * GROUNDING MODE IS REFUSED, as on the bench: there the model searches for
 * itself, so there is no prompt to hand to another machine.
 */
import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getCrwConfig } from '../lib/crw.js'
import { getGenerationParamsForRole } from '../lib/ai-provider.js'
import { getRetrievalMode } from './mode.js'
import { getAnalysisPromptVariant } from './promptSetting.js'
import { loadAnalysisSubject, selectPendingTitles } from './titles.js'
import {
  readAnalysis,
  retrieveSources,
  storeAnalysisOutcome,
  type AnalysisSourceRef,
} from './generate.js'
import { ANALYSIS_PROMPT_VERSION, ANALYSIS_STALE_BELOW, buildAnalysisPrompt } from './prompt.js'
import { describeResponseProblem } from './response.js'
import type { RetrievedSource } from './sourceFloor.js'
import {
  buildExportFile,
  exportFileName,
  importPrecheck,
  parseOffsiteResults,
  type OffsiteImportOutcome,
} from './offsiteFormat.js'

const logger = createChildLogger('analysis-offsite')

export const OFFSITE_BATCH_DEFAULT_SIZE = 100
/** Retrieval is minutes per title, so a batch is capped at about a day of preparing. */
export const OFFSITE_BATCH_MAX_SIZE = 500
/** How long an open batch holds its titles away from the library job. */
export const OFFSITE_RESERVATION_DAYS = 14

/** Titles fetched from the pending selection at a time; small, as in ./job.ts. */
const SELECT_BATCH = 25

/**
 * Retrieval failures in a row that mean the retrieval service is down, not the
 * titles. Same number and reasoning as ./job.ts's limit: an outage fails every
 * title in milliseconds, and a batch should stop and say so rather than walk
 * the whole library recording the same failure.
 */
const CONSECUTIVE_FAILURE_LIMIT = 5

/** Batches being prepared in this process, and the ones asked to stop. */
const preparing = new Set<string>()
const stopRequested = new Set<string>()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface BatchRow {
  id: string
  status: string
  error: string | null
  requested: number
  media_types: Array<'movie' | 'series'>
  prompt_version: number
  prompt_variant: string | null
  max_output_tokens: number | null
  temperature: string | null
  top_p: string | null
  created_at: Date
  prepared_at: Date | null
  expires_at: Date
  last_import_at: Date | null
}

/** pg returns NUMERIC as text; null stays null rather than becoming 0. */
function numeric(value: string | number | null): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

export interface StartOffsiteBatchOptions {
  count: number
  mediaTypes: Array<'movie' | 'series'>
  userId?: string | null
}

/**
 * Create a batch and prepare it in the background.
 *
 * Returns as soon as the row exists; preparing 100 titles is the better part
 * of an hour of retrieval, and the page polls. One batch prepares at a time:
 * two would race each other for the same pending titles and double the load on
 * the retrieval service, which serialises its searches anyway.
 */
export async function startOffsiteBatch(options: StartOffsiteBatchOptions): Promise<string> {
  await recoverInterruptedBatches()

  const mode = await getRetrievalMode()
  if (mode !== 'crw') {
    throw new Error(
      'Offsite analysis needs retrieval mode "crw". Under grounding the model searches for itself, so there is no prompt to send to another machine.'
    )
  }
  if (preparing.size > 0) {
    throw new Error('A batch is already being prepared. Wait for it to finish, or stop it.')
  }

  const count = Math.trunc(options.count)
  if (!Number.isFinite(count) || count < 1 || count > OFFSITE_BATCH_MAX_SIZE) {
    throw new Error(`A batch holds between 1 and ${OFFSITE_BATCH_MAX_SIZE} titles.`)
  }
  const mediaTypes = (['movie', 'series'] as const).filter((t) => options.mediaTypes.includes(t))
  if (mediaTypes.length === 0) throw new Error('Pick movies, series, or both.')

  // Everything the file promises the other machine is resolved ONCE, here, and
  // stored on the batch: the prompt is built under these, and the import files
  // the answers under them however the settings move in between.
  const promptVariant = await getAnalysisPromptVariant()
  const crwConfig = await getCrwConfig()
  const sampling = await getGenerationParamsForRole('titleAnalysis')
  const maxOutputTokens =
    crwConfig.analysisMaxOutputTokens > 0 ? crwConfig.analysisMaxOutputTokens : null

  const row = await queryOne<{ id: string }>(
    `INSERT INTO analysis_offsite_batches
       (status, requested, media_types, prompt_version, prompt_variant, max_output_tokens,
        temperature, top_p, created_by, expires_at)
     VALUES ('preparing', $1, $2, $3, $4, $5, $6, $7, $8, NOW() + make_interval(days => $9))
     RETURNING id`,
    [
      count,
      mediaTypes,
      ANALYSIS_PROMPT_VERSION,
      promptVariant,
      maxOutputTokens,
      sampling.temperature ?? null,
      sampling.topP ?? null,
      options.userId ?? null,
      OFFSITE_RESERVATION_DAYS,
    ]
  )
  if (!row) throw new Error('Could not create the batch.')

  preparing.add(row.id)
  // Not awaited: the caller answers 202 and the page polls.
  void prepareBatch(row.id, count, mediaTypes, promptVariant).catch((err) => {
    logger.error({ err, batchId: row.id }, 'Offsite batch preparation threw outside its own handler')
  })
  return row.id
}

/** Ask a preparing batch to stop after the title in hand. */
export function stopOffsiteBatch(batchId: string): boolean {
  if (!preparing.has(batchId)) return false
  stopRequested.add(batchId)
  return true
}

async function prepareBatch(
  batchId: string,
  requested: number,
  mediaTypes: Array<'movie' | 'series'>,
  promptVariant: string | null
): Promise<void> {
  const shouldStop = () => stopRequested.has(batchId)
  let position = 0
  let prepared = 0
  let consecutiveFailures = 0
  let error: string | null = null

  try {
    outer: for (const mediaType of mediaTypes) {
      // Retrieval failures release their title back to the pending set, so the
      // selection would hand the same title back forever without this.
      const attempted = new Set<string>()

      while (prepared < requested) {
        if (shouldStop()) break outer
        const titles = await selectPendingTitles(
          mediaType,
          Math.min(SELECT_BATCH, requested - prepared),
          [...attempted]
        )
        if (titles.length === 0) break

        for (const title of titles) {
          if (prepared >= requested) break
          if (shouldStop()) break outer
          attempted.add(title.mediaId)

          // Written BEFORE retrieval so the title is reserved from the first
          // second: the library job could otherwise select it while its
          // retrieval runs here.
          const item = await queryOne<{ id: string }>(
            `INSERT INTO analysis_offsite_items (batch_id, position, media_type, media_id, title, year)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [batchId, position++, mediaType, title.mediaId, title.subject.title, title.subject.year]
          )
          if (!item) continue

          try {
            const retrieval = await retrieveSources(title.subject, { shouldCancel: shouldStop })
            const prompt = buildAnalysisPrompt(title.subject, {
              mode: 'crw',
              sources: retrieval.sources,
              variant: promptVariant,
            })
            const sources: AnalysisSourceRef[] = retrieval.sources.map((s) => ({
              title: s.title,
              domain: s.domain,
              ...(s.url ? { url: s.url } : {}),
            }))
            await query(
              `UPDATE analysis_offsite_items
                  SET status = 'ready', prompt = $2, sources = $3::jsonb, evidence = $4::jsonb,
                      source_count = $5, retrieved_chars = $6
                WHERE id = $1`,
              [
                item.id,
                prompt,
                JSON.stringify(sources),
                JSON.stringify(retrieval.evidence satisfies RetrievedSource[]),
                retrieval.sources.length,
                retrieval.retrievedChars,
              ]
            )
            prepared++
            consecutiveFailures = 0
            logger.info(
              { batchId, title: title.subject.title, sources: retrieval.sources.length, prepared, requested },
              'Offsite prompt prepared'
            )
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err)
            // Released at once: no prompt, so nothing for the other machine to
            // run, and the title goes back to the pending set for a later run.
            await query(
              `UPDATE analysis_offsite_items SET status = 'retrieval_failed', error = $2 WHERE id = $1`,
              [item.id, reason]
            )
            logger.warn({ err, batchId, title: title.subject.title }, 'Offsite retrieval failed')
            if (shouldStop()) break outer
            consecutiveFailures++
            if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
              error =
                `Stopped after ${consecutiveFailures} retrieval failures in a row — the retrieval ` +
                `service, not these titles. Last error: ${reason}`
              break outer
            }
          }
        }
      }
    }

    if (shouldStop() && !error) error = `Stopped with ${prepared} of ${requested} prepared.`
    else if (!error && prepared < requested) {
      error = `Only ${prepared} title(s) were pending.`
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    logger.error({ err, batchId }, 'Offsite batch preparation failed')
  } finally {
    // A stopped or failed batch is still a usable one: every prompt already
    // built is as good as any. It becomes `ready` with what it has.
    await query(
      `UPDATE analysis_offsite_batches SET status = 'ready', prepared_at = NOW(), error = $2 WHERE id = $1`,
      [batchId, error]
    ).catch((err) => logger.error({ err, batchId }, 'Could not finish the offsite batch row'))
    preparing.delete(batchId)
    stopRequested.delete(batchId)
  }
}

/**
 * A batch left `preparing` by a restart is finished as `ready` with what it
 * had, and a title caught mid-retrieval is released. Run lazily on every read
 * rather than at boot, the bench's choice, so nothing has to remember to call it.
 */
async function recoverInterruptedBatches(): Promise<void> {
  const ids = [...preparing]
  const stale = await query<{ id: string }>(
    `UPDATE analysis_offsite_batches
        SET status = 'ready', prepared_at = NOW(),
            error = 'Preparation was interrupted (the server restarted). The prompts already built are kept.'
      WHERE status = 'preparing' AND NOT (id = ANY($1::uuid[]))
      RETURNING id`,
    [ids]
  )
  if (stale.rows.length === 0) return
  await query(
    `UPDATE analysis_offsite_items SET status = 'retrieval_failed', error = 'Interrupted'
      WHERE status = 'pending' AND batch_id = ANY($1::uuid[])`,
    [stale.rows.map((r) => r.id)]
  )
}

export interface OffsiteBatchCounts {
  pending: number
  ready: number
  rejected: number
  stored: number
  declined: number
  skipped: number
  retrievalFailed: number
}

export interface OffsiteBatchSummary {
  id: string
  status: 'preparing' | 'ready' | 'closed'
  /** True while the batch still holds its titles away from the library job. */
  open: boolean
  error: string | null
  requested: number
  mediaTypes: Array<'movie' | 'series'>
  promptVersion: number
  promptVariant: string | null
  maxOutputTokens: number | null
  temperature: number | null
  topP: number | null
  createdAt: string
  preparedAt: string | null
  expiresAt: string
  lastImportAt: string | null
  counts: OffsiteBatchCounts
  /** Titles a download would include: answered by nobody yet. */
  downloadable: number
}

export interface OffsiteBatchItem {
  id: string
  position: number
  mediaType: 'movie' | 'series'
  mediaId: string
  title: string
  year: number | null
  status: string
  error: string | null
  model: string | null
  sourceCount: number | null
  importedAt: string | null
}

export interface OffsiteBatchView extends OffsiteBatchSummary {
  items: OffsiteBatchItem[]
}

function toSummary(row: BatchRow, counts: Record<string, number>): OffsiteBatchSummary {
  const c: OffsiteBatchCounts = {
    pending: counts.pending ?? 0,
    ready: counts.ready ?? 0,
    rejected: counts.rejected ?? 0,
    stored: counts.stored ?? 0,
    declined: counts.declined ?? 0,
    skipped: counts.skipped ?? 0,
    retrievalFailed: counts.retrieval_failed ?? 0,
  }
  const status = (row.status === 'preparing' || row.status === 'closed' ? row.status : 'ready') as
    | 'preparing'
    | 'ready'
    | 'closed'
  return {
    id: row.id,
    status,
    open: status !== 'closed' && row.expires_at.getTime() > Date.now(),
    error: row.error,
    requested: row.requested,
    mediaTypes: row.media_types,
    promptVersion: row.prompt_version,
    promptVariant: row.prompt_variant,
    maxOutputTokens: row.max_output_tokens,
    temperature: numeric(row.temperature),
    topP: numeric(row.top_p),
    createdAt: row.created_at.toISOString(),
    preparedAt: row.prepared_at?.toISOString() ?? null,
    expiresAt: row.expires_at.toISOString(),
    lastImportAt: row.last_import_at?.toISOString() ?? null,
    counts: c,
    downloadable: c.ready + c.rejected,
  }
}

async function countsFor(batchIds: string[]): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>()
  if (batchIds.length === 0) return out
  const rows = await query<{ batch_id: string; status: string; n: string }>(
    `SELECT batch_id, status, COUNT(*)::text AS n
       FROM analysis_offsite_items
      WHERE batch_id = ANY($1::uuid[])
      GROUP BY batch_id, status`,
    [batchIds]
  )
  for (const r of rows.rows) {
    const entry = out.get(r.batch_id) ?? {}
    entry[r.status] = Number.parseInt(r.n, 10)
    out.set(r.batch_id, entry)
  }
  return out
}

export async function listOffsiteBatches(limit = 25): Promise<OffsiteBatchSummary[]> {
  await recoverInterruptedBatches()
  const rows = await query<BatchRow>(
    `SELECT * FROM analysis_offsite_batches ORDER BY created_at DESC LIMIT $1`,
    [limit]
  )
  const counts = await countsFor(rows.rows.map((r) => r.id))
  return rows.rows.map((r) => toSummary(r, counts.get(r.id) ?? {}))
}

export async function getOffsiteBatch(batchId: string): Promise<OffsiteBatchView | null> {
  if (!UUID.test(batchId)) return null
  await recoverInterruptedBatches()
  const row = await queryOne<BatchRow>(`SELECT * FROM analysis_offsite_batches WHERE id = $1`, [batchId])
  if (!row) return null
  const counts = await countsFor([row.id])
  const items = await query<{
    id: string
    position: number
    media_type: 'movie' | 'series'
    media_id: string
    title: string
    year: number | null
    status: string
    error: string | null
    model: string | null
    source_count: number | null
    imported_at: Date | null
  }>(
    `SELECT id, position, media_type, media_id, title, year, status, error, model, source_count, imported_at
       FROM analysis_offsite_items
      WHERE batch_id = $1
      ORDER BY position ASC`,
    [batchId]
  )
  return {
    ...toSummary(row, counts.get(row.id) ?? {}),
    items: items.rows.map((i) => ({
      id: i.id,
      position: i.position,
      mediaType: i.media_type,
      mediaId: i.media_id,
      title: i.title,
      year: i.year,
      status: i.status,
      error: i.error,
      model: i.model,
      sourceCount: i.source_count,
      importedAt: i.imported_at?.toISOString() ?? null,
    })),
  }
}

/**
 * The batch file: every title nobody has answered yet — prepared ones and ones
 * whose answer was rejected. Downloadable while the batch is still preparing,
 * so the other machine can start on the first titles; downloading again later
 * is safe, because the runner skips ids its results file already answers.
 */
export async function exportOffsiteBatch(
  batchId: string
): Promise<{ fileName: string; body: string; count: number } | null> {
  if (!UUID.test(batchId)) return null
  const row = await queryOne<BatchRow>(`SELECT * FROM analysis_offsite_batches WHERE id = $1`, [batchId])
  if (!row) return null
  const items = await query<{
    id: string
    media_type: 'movie' | 'series'
    title: string
    year: number | null
    prompt: string
  }>(
    `SELECT id, media_type, title, year, prompt
       FROM analysis_offsite_items
      WHERE batch_id = $1 AND status IN ('ready', 'rejected') AND prompt IS NOT NULL
      ORDER BY position ASC`,
    [batchId]
  )
  const body = buildExportFile(
    items.rows.map((i) => ({
      id: i.id,
      mediaType: i.media_type,
      title: i.title,
      year: i.year,
      prompt: i.prompt,
    })),
    {
      promptVersion: row.prompt_version,
      promptVariant: row.prompt_variant,
      maxOutputTokens: row.max_output_tokens,
      temperature: numeric(row.temperature),
      topP: numeric(row.top_p),
    }
  )
  return { fileName: exportFileName(row.id), body, count: items.rows.length }
}

/**
 * Close a batch: its unanswered titles go back to the library job. The prompts
 * stay, so an answer that arrives later can still be imported.
 */
export async function closeOffsiteBatch(batchId: string): Promise<boolean> {
  if (!UUID.test(batchId)) return false
  if (preparing.has(batchId)) throw new Error('Stop the batch before closing it.')
  const result = await query(
    `UPDATE analysis_offsite_batches SET status = 'closed' WHERE id = $1 AND status <> 'preparing'`,
    [batchId]
  )
  return (result.rowCount ?? 0) > 0
}

/** Delete a batch and its prompts. Analyses already imported stay in the library. */
export async function deleteOffsiteBatch(batchId: string): Promise<boolean> {
  if (!UUID.test(batchId)) return false
  if (preparing.has(batchId)) throw new Error('Stop the batch before deleting it.')
  const result = await query(`DELETE FROM analysis_offsite_batches WHERE id = $1`, [batchId])
  return (result.rowCount ?? 0) > 0
}

export interface OffsiteImportLine {
  customId: string
  title: string | null
  outcome: OffsiteImportOutcome
  /** The reason, for a rejection or a runner error. */
  detail: string | null
}

export interface OffsiteImportSummary {
  counts: Record<OffsiteImportOutcome, number>
  lines: OffsiteImportLine[]
  /** Line numbers in the file that were not results at all. */
  badLines: number[]
}

interface ImportItemRow {
  id: string
  batch_id: string
  media_type: 'movie' | 'series'
  media_id: string
  title: string
  status: string
  sources: AnalysisSourceRef[] | null
  evidence: RetrievedSource[] | null
  source_count: number | null
  retrieved_chars: number | null
  prompt_version: number
  prompt_variant: string | null
  max_output_tokens: number | null
  batch_created_at: Date
  analyzed_at: Date | null
}

/**
 * Import a results file written by the runner.
 *
 * Each answer goes through `readAnalysis` (the output contract) and then
 * `storeAnalysisOutcome` (floor, map, insert) — the library job's own two
 * functions. Nothing here is trusted from the file except the id and the text:
 * the evidence the floor judges, the sources the panel lists and the prompt
 * version the row records all come from the batch, as built on this server.
 *
 * Never throws for one bad line; every line gets an outcome in the summary.
 */
export async function importOffsiteResults(jsonl: string): Promise<OffsiteImportSummary> {
  const parsed = parseOffsiteResults(jsonl)
  const counts = {
    stored: 0,
    declined: 0,
    rejected: 0,
    runnerError: 0,
    superseded: 0,
    duplicate: 0,
    notExported: 0,
    stale: 0,
    unknown: 0,
    gone: 0,
  } satisfies Record<OffsiteImportOutcome, number>
  const lines: OffsiteImportLine[] = []
  const touchedBatches = new Set<string>()

  const ids = parsed.results.map((r) => r.customId).filter((id) => UUID.test(id))
  const rows = ids.length
    ? await query<ImportItemRow>(
        `SELECT i.id, i.batch_id, i.media_type, i.media_id, i.title, i.status, i.sources, i.evidence,
                i.source_count, i.retrieved_chars,
                b.prompt_version, b.prompt_variant, b.max_output_tokens,
                b.created_at AS batch_created_at,
                ta.analyzed_at
           FROM analysis_offsite_items i
           JOIN analysis_offsite_batches b ON b.id = i.batch_id
           LEFT JOIN title_analysis ta
                  ON ta.media_type = i.media_type AND ta.media_id = i.media_id
          WHERE i.id = ANY($1::uuid[])`,
        [ids]
      )
    : { rows: [] as ImportItemRow[] }
  const byId = new Map(rows.rows.map((r) => [r.id, r]))

  const record = (line: OffsiteImportLine) => {
    counts[line.outcome]++
    lines.push(line)
  }

  for (const result of parsed.results) {
    const item = UUID.test(result.customId) ? byId.get(result.customId) : undefined
    if (!item) {
      record({ customId: result.customId, title: null, outcome: 'unknown', detail: null })
      continue
    }

    try {
      const check = importPrecheck({
        itemStatus: item.status,
        batchPromptVersion: item.prompt_version,
        staleBelow: ANALYSIS_STALE_BELOW,
        analysedAt: item.analyzed_at,
        batchCreatedAt: item.batch_created_at,
        resultKind: result.kind,
      })

      if (check.action === 'skip') {
        const detail = result.kind === 'error' ? result.error : null
        if (check.outcome === 'runnerError') {
          // Kept `ready`: the title stays in the batch for the next run.
          await query(`UPDATE analysis_offsite_items SET error = $2 WHERE id = $1`, [item.id, detail])
        } else if (check.outcome === 'superseded') {
          await query(
            `UPDATE analysis_offsite_items SET status = 'skipped', prompt = NULL, imported_at = NOW(),
                    error = 'Analysed another way after the batch was made'
              WHERE id = $1`,
            [item.id]
          )
        }
        touchedBatches.add(item.batch_id)
        record({ customId: result.customId, title: item.title, outcome: check.outcome, detail })
        continue
      }
      if (result.kind !== 'answer') continue

      // A title deleted since the batch was made: storing would leave an orphan
      // row nothing can reach.
      if (!(await loadAnalysisSubject(item.media_type, item.media_id))) {
        record({ customId: result.customId, title: item.title, outcome: 'gone', detail: null })
        continue
      }

      const modelId = result.model ?? 'offsite'
      const read = readAnalysis(result.text, result.finishReason ?? undefined, {
        mediaType: item.media_type,
        promptVersion: item.prompt_version,
      })

      if (read.problem) {
        const detail = describeResponseProblem(read.problem, {
          title: item.title,
          modelId,
          maxOutputTokens: item.max_output_tokens ?? undefined,
          outputTokens: result.outputTokens ?? undefined,
        })
        await query(
          `UPDATE analysis_offsite_items SET status = 'rejected', error = $2, model = $3 WHERE id = $1`,
          [item.id, detail, modelId]
        )
        touchedBatches.add(item.batch_id)
        record({ customId: result.customId, title: item.title, outcome: 'rejected', detail })
        continue
      }

      const stored = await storeAnalysisOutcome({
        mediaType: item.media_type,
        mediaId: item.media_id,
        title: item.title,
        mode: 'crw',
        text: read.text,
        mapText: read.mapText,
        grade: read.grade,
        modelId,
        evidence: { mode: 'crw', sources: item.evidence ?? [] },
        foundSources: item.sources ?? [],
        sourceCount: item.source_count ?? 0,
        retrievedChars: item.retrieved_chars,
        promptVersion: item.prompt_version,
        promptVariant: item.prompt_variant,
      })
      const outcome: OffsiteImportOutcome = stored.analysis ? 'stored' : 'declined'
      // The prompt is cleared: the row is written and nothing will send it again.
      await query(
        `UPDATE analysis_offsite_items
            SET status = $2, error = $3, model = $4, prompt = NULL, imported_at = NOW()
          WHERE id = $1`,
        [item.id, outcome, stored.declineReason, modelId]
      )
      touchedBatches.add(item.batch_id)
      record({
        customId: result.customId,
        title: item.title,
        outcome,
        detail: stored.declineReason,
      })
    } catch (err) {
      // A database fault on one line must not lose the rest of the file. Filed
      // as a rejection so the title stays in the batch and can be imported again.
      const detail = err instanceof Error ? err.message : String(err)
      logger.error({ err, customId: result.customId }, 'Offsite import of one answer failed')
      record({ customId: result.customId, title: item.title, outcome: 'rejected', detail })
    }
  }

  if (touchedBatches.size > 0) {
    await query(`UPDATE analysis_offsite_batches SET last_import_at = NOW() WHERE id = ANY($1::uuid[])`, [
      [...touchedBatches],
    ])
  }

  logger.info({ ...counts, badLines: parsed.badLines.length }, 'Offsite analysis results imported')
  return { counts, lines, badLines: parsed.badLines }
}
