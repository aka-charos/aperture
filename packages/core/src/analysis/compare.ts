/**
 * The model bench: one film, one retrieval, one prompt, N models.
 *
 * WHY IT EXISTS. Choosing a model for the `titleAnalysis` role means reading
 * several models' prose about the same film and judging it. Done by hand that
 * is: point the role at a model, force a title, read it, repoint the role, force
 * it again. Each of those runs performs its OWN retrieval, so the source
 * documents differ between them — and a difference in the output cannot then be
 * attributed to the model rather than to the pages it happened to get. The
 * comparison is unsound before it starts, and it is slow enough that nobody
 * repeats it often enough to notice.
 *
 * THE ONE DESIGN RULE IS THAT RETRIEVAL HAPPENS ONCE. `retrieveSources` runs a
 * single time, `buildAnalysisPrompt` runs a single time, and every model is
 * handed the byte-identical string. That is what makes a difference between two
 * answers a fact about the two models. It is also why **grounding mode is
 * refused rather than supported**: there the model does its own searching, so
 * two models are answering two different question sets and there is no shared
 * control to compare against. Refusing is the honest outcome; silently running
 * it would produce a report that looks exactly like a sound one.
 *
 * IT RUNS THE REAL PATH. `runWriteAttempt` is the generation path's own
 * function, with its retries, its pacing gate, its LM Studio native branch and
 * its contract checks — not a simplified copy. A copy would drift, and then the
 * bench would be measuring something the library never runs.
 *
 * IT WRITES NOTHING TO `title_analysis`. A comparison is a measurement, not a
 * generation: storing a bench answer would retire the title (its rows are
 * permanent until `ANALYSIS_PROMPT_VERSION` moves) and make the comparison
 * unrepeatable on the one film you had just decided to study.
 *
 * A MODEL THAT FAILS DOES NOT FAIL THE RUN. Each entry catches its own error
 * and records it, because "this model cannot hold the contract on a 20k-token
 * prompt" is usually the finding rather than an obstacle to it.
 */
import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { describeAiError } from '../lib/aiErrors.js'
import {
  buildTitleAnalysisAttemptFor,
  type ProviderType,
} from '../lib/ai-provider.js'
import { getCrwConfig } from '../lib/crw.js'
import { getRetrievalMode } from './mode.js'
import { loadAnalysisSubject } from './titles.js'
import { retrieveSources, runWriteAttempt } from './generate.js'
import { buildAnalysisPrompt, ANALYSIS_PROMPT_VERSION } from './prompt.js'
import { parseParagraphMap, splitAnalysisParagraphs } from './paragraphMap.js'
import { renderComparisonReport, type ComparisonReport } from './comparisonReport.js'

const logger = createChildLogger('analysis-compare')

/** One model the operator asked for, in the order they listed them. */
export interface ComparisonModelRequest {
  provider: string
  model: string
}

export interface StartComparisonOptions {
  mediaType: 'movie' | 'series'
  mediaId: string
  models: ComparisonModelRequest[]
}

/**
 * Runs in flight, and the ones asked to stop.
 *
 * In memory like `activeJobs` and the web-search cooldowns: a run cannot
 * survive a restart anyway, and a row left `running` by a container recreate is
 * read as stale by `isComparisonRunning` rather than blocking the next bench.
 */
const running = new Set<string>()
const cancelled = new Set<string>()

export function isComparisonRunning(runId: string): boolean {
  return running.has(runId)
}

export function cancelComparison(runId: string): boolean {
  if (!running.has(runId)) return false
  cancelled.add(runId)
  return true
}

/** How many models one bench may hold. */
export const MAX_COMPARISON_MODELS = 8

/**
 * Create the run and its pending rows, then drive it in the background.
 *
 * Returns as soon as the rows exist, because a local model can take 45 minutes
 * per entry and an HTTP request must not be held open for six of those — the
 * same reason the discovery refresh answers 202 and lets the page poll.
 *
 * The pending rows are written UP FRONT so the page can show what is queued
 * from the first poll. An empty list while three models are waiting reads as a
 * broken run.
 */
export async function startComparison(options: StartComparisonOptions): Promise<string> {
  const mode = await getRetrievalMode()
  if (mode !== 'crw') {
    throw new Error(
      'Comparison needs retrieval mode "crw". Under grounding each model searches for itself, so the models would not be answering the same sources and the comparison would mean nothing.'
    )
  }

  const subject = await loadAnalysisSubject(options.mediaType, options.mediaId)
  if (!subject) throw new Error('That title is not in the library.')

  const models = options.models.slice(0, MAX_COMPARISON_MODELS)
  if (models.length === 0) throw new Error('Pick at least one model.')

  const run = await queryOne<{ id: string }>(
    `INSERT INTO analysis_comparison_runs (media_type, media_id, title, year, prompt_version)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [options.mediaType, options.mediaId, subject.title, subject.year, ANALYSIS_PROMPT_VERSION]
  )
  if (!run) throw new Error('Could not start the comparison.')

  for (const [position, entry] of models.entries()) {
    await query(
      `INSERT INTO analysis_comparison_results (run_id, position, provider, model)
       VALUES ($1, $2, $3, $4)`,
      [run.id, position, entry.provider, entry.model]
    )
  }

  running.add(run.id)
  // Deliberately not awaited: the caller answers 202 and the page polls.
  void driveComparison(run.id, options.mediaType, options.mediaId, models).catch((err) => {
    logger.error({ err, runId: run.id }, 'Comparison run threw outside its own handler')
  })

  return run.id
}

async function driveComparison(
  runId: string,
  mediaType: 'movie' | 'series',
  mediaId: string,
  models: ComparisonModelRequest[]
): Promise<void> {
  try {
    const subject = await loadAnalysisSubject(mediaType, mediaId)
    if (!subject) throw new Error('That title is not in the library.')

    const crwConfig = await getCrwConfig()

    // ONCE. Everything below answers what this returns.
    const retrieval = await retrieveSources(subject)
    const prompt = buildAnalysisPrompt(subject, { mode: 'crw', sources: retrieval.sources })

    await query(
      `UPDATE analysis_comparison_runs
          SET prompt = $2, source_count = $3, retrieved_chars = $4, sources = $5
        WHERE id = $1`,
      [
        runId,
        prompt,
        retrieval.sources.length,
        retrieval.retrievedChars,
        JSON.stringify(
          retrieval.sources.map((source) => ({
            title: source.title,
            domain: source.domain,
            url: source.url ?? null,
            chars: source.text.length,
          }))
        ),
      ]
    )

    logger.info(
      { runId, title: subject.title, models: models.length, promptChars: prompt.length },
      'Comparison prompt built — running models'
    )

    for (const [position, entry] of models.entries()) {
      if (cancelled.has(runId)) break
      await runOneEntry(runId, position, entry, prompt, crwConfig.analysisMaxOutputTokens, mediaType)
    }

    await finishRun(runId, cancelled.has(runId) ? 'cancelled' : 'completed', null)
  } catch (err) {
    // Only a whole-run failure reaches here — retrieval refused, no sources, a
    // title that vanished. A model's own failure was recorded against its row.
    const described = describeAiError(err)
    logger.error({ runId, ...described }, 'Comparison run failed')
    await finishRun(runId, 'failed', err instanceof Error ? err.message : String(err))
  } finally {
    running.delete(runId)
    cancelled.delete(runId)
  }
}

/**
 * One model's turn.
 *
 * Everything is caught: a provider that refuses, a model id that does not
 * exist, a server that is not running. Each of those is a fact about that
 * model and is written to its row, and the loop moves to the next one.
 */
async function runOneEntry(
  runId: string,
  position: number,
  entry: ComparisonModelRequest,
  prompt: string,
  maxOutputTokens: number,
  mediaType: 'movie' | 'series'
): Promise<void> {
  const startedAt = Date.now()
  try {
    const attempt = await buildTitleAnalysisAttemptFor(entry.provider as ProviderType, entry.model)
    const outcome = await runWriteAttempt(attempt, prompt, maxOutputTokens, {
      shouldCancel: () => cancelled.has(runId),
      title: `${entry.model} (comparison)`,
    })

    const durationMs = Date.now() - startedAt

    if (outcome.kind === 'cancelled') {
      await query(
        `UPDATE analysis_comparison_results
            SET status = 'error', error = 'Cancelled', duration_ms = $3
          WHERE run_id = $1 AND position = $2`,
        [runId, position, durationMs]
      )
      return
    }

    if (outcome.kind === 'error') {
      const described = describeAiError(outcome.error)
      await query(
        `UPDATE analysis_comparison_results
            SET status = 'error', error = $3, duration_ms = $4
          WHERE run_id = $1 AND position = $2`,
        [runId, position, described.message ?? 'The provider call failed.', durationMs]
      )
      return
    }

    const result = outcome.result
    // Judged exactly as the generation path judges it, so a map that would be
    // discarded there is discarded here — the bench must not flatter a model by
    // being more forgiving than the job.
    const map = result.text
      ? parseParagraphMap(result.mapText, {
          paragraphCount: splitAnalysisParagraphs(result.text).length,
          mediaType,
        })
      : null

    await query(
      `UPDATE analysis_comparison_results
          SET status = $3, analysis = $4, grade = $5, map_text = $6, paragraph_map = $7,
              problem = $8, finish_reason = $9, input_tokens = $10, output_tokens = $11,
              reasoning_tokens = $12, duration_ms = $13
        WHERE run_id = $1 AND position = $2`,
      [
        runId,
        position,
        outcome.kind === 'ok' ? 'ok' : 'unusable',
        result.text || null,
        result.grade,
        result.mapText,
        map ? JSON.stringify(map) : null,
        result.problem ? result.problem.kind : null,
        result.finishReason ?? null,
        result.usage?.inputTokens ?? null,
        result.usage?.outputTokens ?? null,
        result.usage?.reasoningTokens ?? null,
        durationMs,
      ]
    )
  } catch (err) {
    const described = describeAiError(err)
    logger.warn({ runId, ...entry, ...described }, 'A model failed its comparison entry')
    await query(
      `UPDATE analysis_comparison_results
          SET status = 'error', error = $3, duration_ms = $4
        WHERE run_id = $1 AND position = $2`,
      [runId, position, err instanceof Error ? err.message : String(err), Date.now() - startedAt]
    )
  }
}

async function finishRun(runId: string, status: string, error: string | null): Promise<void> {
  await query(
    `UPDATE analysis_comparison_runs
        SET status = $2, error = $3, finished_at = NOW()
      WHERE id = $1`,
    [runId, status, error]
  )
}

interface RunRow {
  id: string
  media_type: 'movie' | 'series'
  media_id: string
  title: string
  year: number | null
  status: string
  error: string | null
  prompt: string | null
  prompt_version: number
  source_count: number | null
  retrieved_chars: number | null
  sources: { title: string; domain: string; url: string | null; chars: number }[] | null
  started_at: string
  finished_at: string | null
}

interface ResultRow {
  position: number
  provider: string
  model: string
  status: string
  analysis: string | null
  grade: string | null
  paragraph_map: { paragraph: number; questions: string[] }[] | null
  problem: string | null
  finish_reason: string | null
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  duration_ms: number | null
  error: string | null
}

export interface ComparisonRunView extends ComparisonReport {
  id: string
  status: string
  error: string | null
  /** The whole thing as one plain-text document — see ./comparisonReport.ts. */
  text: string
}

/** One run with every entry, plus the rendered report. */
export async function getComparisonRun(runId: string): Promise<ComparisonRunView | null> {
  const run = await queryOne<RunRow>(
    `SELECT * FROM analysis_comparison_runs WHERE id = $1`,
    [runId]
  )
  if (!run) return null

  const results = await query<ResultRow>(
    `SELECT * FROM analysis_comparison_results WHERE run_id = $1 ORDER BY position ASC`,
    [runId]
  )

  const report: ComparisonReport = {
    title: run.title,
    year: run.year,
    mediaType: run.media_type,
    promptVersion: run.prompt_version,
    sources: (run.sources ?? []).map((s) => ({
      title: s.title,
      domain: s.domain,
      chars: s.chars,
    })),
    retrievedChars: run.retrieved_chars ?? 0,
    prompt: run.prompt,
    // pg hands a TIMESTAMPTZ back as a Date, so interpolating it into the
    // report would print a locale-shaped string that differs between the
    // server rendering it and a client re-rendering it. Normalised once here.
    startedAt: new Date(run.started_at).toISOString(),
    finishedAt: run.finished_at ? new Date(run.finished_at).toISOString() : null,
    entries: results.rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      status: row.status,
      analysis: row.analysis,
      grade: row.grade,
      problem: row.problem,
      finishReason: row.finish_reason,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      reasoningTokens: row.reasoning_tokens,
      durationMs: row.duration_ms,
      error: row.error,
      // Rebuilt into per-paragraph order so the report can print the shape of
      // the answer. An absent map is an empty list, never a guess at position.
      sections: sectionsFromMap(row.analysis, row.paragraph_map),
    })),
  }

  return {
    ...report,
    id: run.id,
    status: run.status,
    error: run.error,
    text: renderComparisonReport(report),
  }
}

/**
 * The map as one list per paragraph, in the order the prose was written.
 *
 * A paragraph the model labelled with nothing contributes an empty entry rather
 * than being dropped, so the printed shape has the same number of parts as the
 * analysis does — a list that silently skipped them would misreport how a model
 * structured its answer, which is one of the things being compared.
 */
function sectionsFromMap(
  analysis: string | null,
  map: { paragraph: number; questions: string[] }[] | null
): string[][] {
  if (!analysis || !map || map.length === 0) return []
  const byParagraph = new Map(map.map((entry) => [entry.paragraph, entry.questions]))
  return splitAnalysisParagraphs(analysis).map((_, i) => byParagraph.get(i + 1) ?? [])
}

export interface ComparisonRunSummary {
  id: string
  mediaType: 'movie' | 'series'
  mediaId: string
  title: string
  year: number | null
  status: string
  modelCount: number
  startedAt: string
  finishedAt: string | null
}

export async function listComparisonRuns(limit = 25): Promise<ComparisonRunSummary[]> {
  const rows = await query<{
    id: string
    media_type: 'movie' | 'series'
    media_id: string
    title: string
    year: number | null
    status: string
    model_count: string
    started_at: string
    finished_at: string | null
  }>(
    `SELECT r.id, r.media_type, r.media_id, r.title, r.year, r.status,
            r.started_at, r.finished_at,
            COUNT(x.id) AS model_count
       FROM analysis_comparison_runs r
       LEFT JOIN analysis_comparison_results x ON x.run_id = r.id
      GROUP BY r.id
      ORDER BY r.started_at DESC
      LIMIT $1`,
    [limit]
  )

  return rows.rows.map((row) => ({
    id: row.id,
    mediaType: row.media_type,
    mediaId: row.media_id,
    title: row.title,
    year: row.year,
    status: row.status,
    // COUNT comes back as text from pg, so it is parsed rather than trusted.
    modelCount: Number.parseInt(row.model_count, 10) || 0,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }))
}

export async function deleteComparisonRun(runId: string): Promise<void> {
  await query(`DELETE FROM analysis_comparison_runs WHERE id = $1`, [runId])
}
