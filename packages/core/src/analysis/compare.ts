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
import {
  buildAnalysisPrompt,
  extractPromptSources,
  promptChoiceKey,
  promptChoiceLabel,
  resolveBenchPromptChoices,
  type AnalysisSource,
  type PromptChoice,
} from './prompt.js'
import { parseParagraphMap, splitAnalysisParagraphs } from './paragraphMap.js'
import {
  renderComparisonReport,
  type ComparisonBaseline,
  type ComparisonEntry,
  type ComparisonReport,
} from './comparisonReport.js'

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
  /**
   * Prompt versions to put beside each other. Every model answers every
   * version, all built from the one retrieval. Absent means the current
   * version only, which is what the bench did before versions were selectable.
   */
  promptVersions?: number[]
  /**
   * Prompt variants to put beside those versions - an alternative set of
   * questions and rules for the same version, for a model that cannot hold
   * that version's own. See ./promptVariants.ts. Each runs on the same
   * retrieval as everything else, so a variant is compared against its base
   * under the one control that means anything.
   */
  promptVariants?: string[]
}

/** One answer the run will produce: a model, under one prompt. */
interface PlannedEntry extends ComparisonModelRequest {
  position: number
  choice: PromptChoice
}

/**
 * The version a run is filed under: the highest number among its choices.
 *
 * A variant carries its base version rather than a number of its own, so a run
 * of v15 beside v15 compact is a v15 run - which is what keeps
 * analysis_comparison_runs.prompt_version meaning the newest version answered.
 */
function headlineVersion(choices: PromptChoice[]): number {
  return Math.max(...choices.map((choice) => choice.version))
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
  // Resolved before any row exists, so an unknown version or variant is
  // refused rather than leaving a run behind that can never finish.
  const choices = resolveBenchPromptChoices(options.promptVersions, options.promptVariants)

  const run = await queryOne<{ id: string }>(
    `INSERT INTO analysis_comparison_runs (media_type, media_id, title, year, prompt_version)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [options.mediaType, options.mediaId, subject.title, subject.year, headlineVersion(choices)]
  )
  if (!run) throw new Error('Could not start the comparison.')

  await launch(run.id, options.mediaType, options.mediaId, models, choices, null)
  return run.id
}

/**
 * Replay a stored run's sources under any prompt versions this build carries.
 *
 * A new bench no longer needs this to compare versions - `startComparison`
 * takes `promptVersions` and builds every version from its one retrieval. What
 * replay still answers is the run you already have: the same documents under a
 * version that did not exist when it ran, or the same version again for the
 * noise floor.
 *
 * WHY. The bench compares MODELS by retrieving once. Comparing PROMPT VERSIONS
 * needs the same control across two runs days apart, and retrieving again would
 * give the newer prompt different pages - so a difference in the answers could
 * be the pages rather than the prompt. A replay retrieves nothing: it reads the
 * documents back out of the stored prompt (`extractPromptSources`), builds the
 * current prompt from them, and records the run it came from so the report
 * prints both runs' answers together.
 *
 * REPLAYING UNDER THE SAME VERSION IS ALLOWED ON PURPOSE. Same sources, same
 * prompt, same models is the noise floor: how much a model's answer moves
 * between two identical calls. Without it a difference between versions has
 * nothing to be measured against.
 *
 * The retrieval mode is not checked, unlike `startComparison`: grounding is
 * refused there because each model would search for itself, and here nothing
 * searches.
 *
 * The subject header (directors, reception figures) is rebuilt from the library
 * as it is now, so a rating refreshed since the baseline shows up in that one
 * line of the prompt. The documents are what must not move, and do not.
 */
export async function replayComparison(
  runId: string,
  options: {
    models?: ComparisonModelRequest[]
    promptVersions?: number[]
    promptVariants?: string[]
  } = {}
): Promise<string> {
  const requested = options.models
  const choices = resolveBenchPromptChoices(options.promptVersions, options.promptVariants)
  const original = await queryOne<RunRow>(`SELECT * FROM analysis_comparison_runs WHERE id = $1`, [
    runId,
  ])
  if (!original) throw new Error('No such comparison.')
  if (running.has(runId)) throw new Error('That run is still going. Replay it once it has finished.')
  if (!original.prompt) {
    throw new Error('That run never got as far as building its prompt, so it has no sources to replay.')
  }

  const sources = extractPromptSources(original.prompt, original.sources ?? [])
  if (!sources) {
    throw new Error("Could not read that run's source documents back out of its stored prompt.")
  }

  const subject = await loadAnalysisSubject(original.media_type, original.media_id)
  if (!subject) throw new Error('That title is no longer in the library.')

  // Default: the baseline's models, in the baseline's order, so every answer in
  // the report has a partner to be read against. DISTINCT because a baseline
  // that ran several prompt versions lists each model once per version.
  const models = (
    requested?.length
      ? requested
      : (
          await query<ComparisonModelRequest>(
            `SELECT provider, model FROM analysis_comparison_results
              WHERE run_id = $1
              GROUP BY provider, model
              ORDER BY MIN(position) ASC`,
            [runId]
          )
        ).rows
  ).slice(0, MAX_COMPARISON_MODELS)
  if (models.length === 0) throw new Error('That run has no models to replay.')

  const run = await queryOne<{ id: string }>(
    `INSERT INTO analysis_comparison_runs
       (media_type, media_id, title, year, prompt_version, replay_of, source_count, retrieved_chars, sources)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      original.media_type,
      original.media_id,
      subject.title,
      subject.year,
      headlineVersion(choices),
      original.id,
      original.source_count,
      original.retrieved_chars,
      // pg hands JSONB back parsed, so it goes back in as text.
      JSON.stringify(original.sources ?? []),
    ]
  )
  if (!run) throw new Error('Could not start the replay.')

  await launch(run.id, original.media_type, original.media_id, models, choices, sources)
  return run.id
}

/**
 * Every answer a run will produce, in report order: grouped by MODEL, each
 * model's prompts in choice order - versions oldest first, then variants.
 *
 * Grouped by model rather than by version so a model's answers sit next to each
 * other in the report, which is the comparison a version change asks for - the
 * same model, the same documents, different questions and rules.
 */
function planEntries(models: ComparisonModelRequest[], choices: PromptChoice[]): PlannedEntry[] {
  return models.flatMap((model, m) =>
    choices.map((choice, v) => ({
      provider: model.provider,
      model: model.model,
      choice,
      position: m * choices.length + v,
    }))
  )
}

/**
 * Write the pending rows, then drive the run in the background.
 *
 * The pending rows are written UP FRONT so the page can show what is queued
 * from the first poll. An empty list while three models are waiting reads as a
 * broken run.
 */
async function launch(
  runId: string,
  mediaType: 'movie' | 'series',
  mediaId: string,
  models: ComparisonModelRequest[],
  choices: PromptChoice[],
  replaySources: AnalysisSource[] | null
): Promise<void> {
  const entries = planEntries(models, choices)
  for (const entry of entries) {
    await query(
      `INSERT INTO analysis_comparison_results
         (run_id, position, provider, model, prompt_version, prompt_variant)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        runId,
        entry.position,
        entry.provider,
        entry.model,
        entry.choice.version,
        entry.choice.variant,
      ]
    )
  }

  running.add(runId)
  // Deliberately not awaited: the caller answers 202 and the page polls.
  void driveComparison(runId, mediaType, mediaId, entries, choices, replaySources).catch((err) => {
    logger.error({ err, runId }, 'Comparison run threw outside its own handler')
  })
}

async function driveComparison(
  runId: string,
  mediaType: 'movie' | 'series',
  mediaId: string,
  entries: PlannedEntry[],
  choices: PromptChoice[],
  replaySources: AnalysisSource[] | null
): Promise<void> {
  try {
    const subject = await loadAnalysisSubject(mediaType, mediaId)
    if (!subject) throw new Error('That title is not in the library.')

    const crwConfig = await getCrwConfig()

    // ONCE, whatever the number of versions. Every prompt below is built from
    // this one list, so two versions' prompts differ below the TASK line and
    // nowhere else - see PromptEdition.
    let sources: AnalysisSource[]
    if (replaySources) {
      // A replay's documents came from the run it replays, and the counts and
      // summaries were copied from that run when the row was created.
      sources = replaySources
    } else {
      const retrieval = await retrieveSources(subject)
      sources = retrieval.sources
      await query(
        `UPDATE analysis_comparison_runs
            SET source_count = $2, retrieved_chars = $3, sources = $4
          WHERE id = $1`,
        [
          runId,
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
    }

    const prompts = new Map(
      choices.map((choice) => [
        promptChoiceKey(choice),
        buildAnalysisPrompt(subject, {
          mode: 'crw',
          sources,
          version: choice.version,
          variant: choice.variant,
        }),
      ])
    )
    // `prompt` keeps the last choice's text, because replay reads the documents
    // back out of it (0171) and every choice carries the same header and source
    // block; `prompts` holds them all (0172), keyed by choice.
    const newest = prompts.get(promptChoiceKey(choices[choices.length - 1]))!
    await query(`UPDATE analysis_comparison_runs SET prompt = $2, prompts = $3 WHERE id = $1`, [
      runId,
      newest,
      JSON.stringify(Object.fromEntries(prompts)),
    ])

    logger.info(
      {
        runId,
        title: subject.title,
        answers: entries.length,
        prompts: choices.map(promptChoiceLabel),
        promptChars: newest.length,
      },
      'Comparison prompts built — running models'
    )

    for (const entry of entries) {
      if (cancelled.has(runId)) break
      await runOneEntry(
        runId,
        entry.position,
        entry,
        prompts.get(promptChoiceKey(entry.choice))!,
        crwConfig.analysisMaxOutputTokens,
        mediaType,
        entry.choice.version
      )
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
  mediaType: 'movie' | 'series',
  promptVersion: number
): Promise<void> {
  const startedAt = Date.now()
  try {
    const attempt = await buildTitleAnalysisAttemptFor(entry.provider as ProviderType, entry.model)
    const outcome = await runWriteAttempt(attempt, prompt, maxOutputTokens, {
      mediaType,
      promptVersion,
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
          // The vocabulary of the version it answered, or a version-8 answer's
          // `intent` and `dispute` labels read as unrecognised and drop.
          promptVersion,
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
  replay_of: string | null
  /**
   * One prompt per choice, keyed "15" or "15:compact" (0172, 0179); null on
   * runs made before versions were selectable.
   */
  prompts: Record<string, string> | null
  started_at: string
  finished_at: string | null
}

interface ResultRow {
  position: number
  /** Null on rows made before 0172, which answered their run's prompt_version. */
  prompt_version: number | null
  /** The variant that answered, or null for the version's own prompt (0179). */
  prompt_variant: string | null
  provider: string
  model: string
  status: string
  analysis: string | null
  grade: string | null
  paragraph_map: { paragraph: number; questions: string[] }[] | null
  map_text: string | null
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

  // A replay carries its baseline's answers, so the one document holds both
  // prompt versions. A baseline deleted since leaves replay_of NULL (0171), and
  // the run then reads as an ordinary one.
  let replayOf: ComparisonBaseline | null = null
  if (run.replay_of) {
    const base = await queryOne<RunRow>(`SELECT * FROM analysis_comparison_runs WHERE id = $1`, [
      run.replay_of,
    ])
    if (base) {
      const baseResults = await query<ResultRow>(
        `SELECT * FROM analysis_comparison_results WHERE run_id = $1 ORDER BY position ASC`,
        [base.id]
      )
      replayOf = {
        runId: base.id,
        promptVersion: base.prompt_version,
        startedAt: new Date(base.started_at).toISOString(),
        entries: baseResults.rows.map((row) => toEntry(row, base.prompt_version)),
      }
    }
  }

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
    // Keyed "15" before variants existed and "15:compact" with one, so the
    // key is split rather than cast - Number("15:compact") is NaN, which sorts
    // nowhere and prints as a prompt for version NaN.
    prompts: run.prompts
      ? Object.entries(run.prompts)
          .map(([key, text]) => {
            const [version, variant] = key.split(':')
            return { version: Number(version), variant: variant ?? null, text }
          })
          .sort((a, b) => a.version - b.version || (a.variant ?? '').localeCompare(b.variant ?? ''))
      : null,
    // pg hands a TIMESTAMPTZ back as a Date, so interpolating it into the
    // report would print a locale-shaped string that differs between the
    // server rendering it and a client re-rendering it. Normalised once here.
    startedAt: new Date(run.started_at).toISOString(),
    finishedAt: run.finished_at ? new Date(run.finished_at).toISOString() : null,
    entries: results.rows.map((row) => toEntry(row, run.prompt_version)),
    replayOf,
  }

  return {
    ...report,
    id: run.id,
    status: run.status,
    error: run.error,
    text: renderComparisonReport(report),
  }
}

function toEntry(row: ResultRow, runVersion: number): ComparisonEntry {
  return {
    provider: row.provider,
    model: row.model,
    // Absent on a pre-0172 row, which answered the one prompt its run held.
    promptVersion: row.prompt_version ?? runVersion,
    promptVariant: row.prompt_variant,
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
    mapText: row.map_text,
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
  /** The newest prompt version the run answered. */
  promptVersion: number
  /** Every prompt version the run answered, oldest first. */
  promptVersions: number[]
  /** The run this one replayed, or null for a run that retrieved its own. */
  replayOf: string | null
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
    prompt_version: number
    prompt_versions: number[] | null
    replay_of: string | null
    started_at: string
    finished_at: string | null
  }>(
    `SELECT r.id, r.media_type, r.media_id, r.title, r.year, r.status,
            r.prompt_version, r.replay_of, r.started_at, r.finished_at,
            ARRAY(
              SELECT DISTINCT COALESCE(v.prompt_version, r.prompt_version)
                FROM analysis_comparison_results v
               WHERE v.run_id = r.id
               ORDER BY 1
            ) AS prompt_versions,
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
    promptVersion: row.prompt_version,
    promptVersions: row.prompt_versions?.length ? row.prompt_versions : [row.prompt_version],
    replayOf: row.replay_of,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }))
}

export async function deleteComparisonRun(runId: string): Promise<void> {
  await query(`DELETE FROM analysis_comparison_runs WHERE id = $1`, [runId])
}
