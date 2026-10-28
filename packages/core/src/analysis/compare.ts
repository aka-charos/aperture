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
import { readAnalysis, retrieveSources, runWriteAttempt } from './generate.js'
import { buildExportLine, parseOffsiteResults } from './offsiteFormat.js'
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
  readJudgedSourceReport,
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
       (media_type, media_id, title, year, prompt_version, replay_of, source_count, retrieved_chars,
        sources, judged_sources)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      // CARRIED WITH THE REST OF THE RETRIEVAL. A replay reads its documents
      // back out of the baseline's prompt, which already holds only what the
      // filter kept — so inheriting every other retrieval fact and not this one
      // left a replay printing filtered documents under a report saying the
      // filter was never asked, which is the one thing NULL is supposed to mean.
      original.judged_sources == null ? null : JSON.stringify(original.judged_sources),
    ]
  )
  if (!run) throw new Error('Could not start the replay.')

  // A BY-HAND BASELINE REPLAYS BY HAND. Its stored models are ('manual',
  // <label>) pairs the operator typed, and driving those through the provider
  // path builds a ProviderConfig for a provider that does not exist, so every
  // entry would fail and the replay would be a run full of [failed] rows with
  // nothing saying why. Replaying one is worth having rather than refusing:
  // same documents, a prompt version that did not exist when it ran, answered
  // by the same outside model - which is the controlled pair this lane is for.
  if (models.every((entry) => entry.provider === MANUAL_PROVIDER)) {
    await launchManual(
      run.id,
      original.media_type,
      original.media_id,
      models.map((entry) => entry.model),
      choices,
      sources
    )
    return run.id
  }

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
    const crwConfig = await getCrwConfig()
    const prompts = await prepareComparison(runId, mediaType, mediaId, choices, replaySources)

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
 * Retrieve once, build every version's prompt from that one list, and store both.
 *
 * SHARED BY THE MODEL LANE AND THE MANUAL ONE, and that is the whole reason it
 * is a function. A manual run is the same bench with the model call taken out,
 * so if it retrieved or built its prompts through a second copy of this, the
 * two lanes would drift and a hand-entered answer would stop being comparable
 * with a run of the same title through a provider - which is the one property
 * the bench exists to have.
 */
async function prepareComparison(
  runId: string,
  mediaType: 'movie' | 'series',
  mediaId: string,
  choices: PromptChoice[],
  replaySources: AnalysisSource[] | null
): Promise<Map<string, string>> {
  {
    const subject = await loadAnalysisSubject(mediaType, mediaId)
    if (!subject) throw new Error('That title is not in the library.')

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
            SET source_count = $2, retrieved_chars = $3, sources = $4, judged_sources = $5
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
              ...(source.curated === true ? { curated: true } : {}),
              // Absent on a replay, which reads its documents back out of a
              // stored prompt and so never saw what the scraper first handed
              // over. See ComparisonSource.fetchedChars.
              ...(source.fetchedChars != null ? { fetchedChars: source.fetchedChars } : {}),
              ...(source.strippedChars ? { strippedChars: source.strippedChars } : {}),
            }))
          ),
          // NULL when the filter did not run. An empty `dropped` means it read
          // every document and ruled none out, which is a different fact and
          // one the report states out loud (0195).
          retrieval.judged
            ? JSON.stringify({
                dropped: retrieval.judged.dropped,
                scores: retrieval.judged.scores.map((s) => ({
                  domain: s.domain,
                  score: s.score,
                  kept: s.kept,
                  ...(s.url ? { url: s.url } : {}),
                })),
                floored: retrieval.judged.floored,
              })
            : null,
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
        prompts: choices.map(promptChoiceLabel),
        promptChars: newest.length,
      },
      'Comparison prompts built'
    )

    return prompts
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
      await writeComparisonFailure(runId, position, 'Cancelled', durationMs)
      return
    }

    if (outcome.kind === 'error') {
      const described = describeAiError(outcome.error)
      await writeComparisonFailure(
        runId,
        position,
        described.message ?? 'The provider call failed.',
        durationMs
      )
      return
    }

    const result = outcome.result
    await writeComparisonAnswer(
      runId,
      position,
      result,
      { mediaType, promptVersion },
      {
        status: outcome.kind === 'ok' ? 'ok' : 'unusable',
        finishReason: result.finishReason ?? null,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        reasoningTokens: result.usage?.reasoningTokens ?? null,
        durationMs,
      }
    )
  } catch (err) {
    const described = describeAiError(err)
    logger.warn({ runId, ...entry, ...described }, 'A model failed its comparison entry')
    await writeComparisonFailure(
      runId,
      position,
      err instanceof Error ? err.message : String(err),
      Date.now() - startedAt
    )
  }
}

/**
 * Record that an entry has no answer, and leave nothing of an earlier one.
 *
 * EVERY ANSWER FIELD IS CLEARED, which is not housekeeping. The report prints
 * `entry.analysis?.trim() || failureLine(entry)`, so prose wins over a failure
 * whenever both are present: a row answered once and then recorded as a
 * failure would keep printing the old answer under a stat line that says it
 * failed. `writeComparisonAnswer` clears `error` for the same reason in the
 * other direction, and the pair of them is what keeps a row's status and its
 * contents from ever disagreeing.
 *
 * Reachable in the model lane only in theory (its rows are pending until they
 * are answered once) and in practice in the manual one, where an operator can
 * paste an error line for a position they have already answered.
 */
async function writeComparisonFailure(
  runId: string,
  position: number,
  error: string,
  durationMs: number | null = null
): Promise<void> {
  await query(
    `UPDATE analysis_comparison_results
        SET status = 'error', error = $3, duration_ms = $4,
            analysis = NULL, grade = NULL, map_text = NULL, paragraph_map = NULL,
            problem = NULL, finish_reason = NULL,
            input_tokens = NULL, output_tokens = NULL, reasoning_tokens = NULL
      WHERE run_id = $1 AND position = $2`,
    [runId, position, error, durationMs]
  )
}

/**
 * Store one answer against its pending row.
 *
 * SHARED BY THE MODEL LANE AND THE MANUAL ONE for the reason the comment below
 * gives: an answer typed in by hand has to be held to the same contract as one
 * a provider returned, or the bench would flatter whichever lane it judged
 * loosely and the two could not be read beside each other.
 */
async function writeComparisonAnswer(
  runId: string,
  position: number,
  reading: {
    text: string | null
    grade: string | null
    mapText: string | null
    problem: { kind: string } | null
  },
  context: { mediaType: 'movie' | 'series'; promptVersion: number },
  meta: {
    status: 'ok' | 'unusable'
    finishReason?: string | null
    inputTokens?: number | null
    outputTokens?: number | null
    reasoningTokens?: number | null
    durationMs?: number | null
  }
): Promise<void> {
  // Judged exactly as the generation path judges it, so a map that would be
  // discarded there is discarded here — the bench must not flatter a model by
  // being more forgiving than the job.
  const map = reading.text
    ? parseParagraphMap(reading.mapText, {
        paragraphCount: splitAnalysisParagraphs(reading.text).length,
        mediaType: context.mediaType,
        // The vocabulary of the version it answered, or a version-8 answer's
        // `intent` and `dispute` labels read as unrecognised and drop.
        promptVersion: context.promptVersion,
      })
    : null

  await query(
    `UPDATE analysis_comparison_results
        SET status = $3, analysis = $4, grade = $5, map_text = $6, paragraph_map = $7,
            problem = $8, finish_reason = $9, input_tokens = $10, output_tokens = $11,
            reasoning_tokens = $12, duration_ms = $13, error = NULL
      WHERE run_id = $1 AND position = $2`,
    [
      runId,
      position,
      meta.status,
      reading.text || null,
      reading.grade,
      reading.mapText,
      map ? JSON.stringify(map) : null,
      reading.problem ? reading.problem.kind : null,
      meta.finishReason ?? null,
      meta.inputTokens ?? null,
      meta.outputTokens ?? null,
      meta.reasoningTokens ?? null,
      meta.durationMs ?? null,
    ]
  )
}

async function finishRun(runId: string, status: string, error: string | null): Promise<void> {
  await query(
    `UPDATE analysis_comparison_runs
        SET status = $2, error = $3, finished_at = NOW()
      WHERE id = $1`,
    [runId, status, error]
  )
}

/**
 * Move a run to a status it has not finished in, leaving `finished_at` alone.
 *
 * `awaiting` is the one non-terminal status a run can rest at: the prompts are
 * built and nothing else happens until somebody pastes an answer. Writing
 * `finished_at` there would say a run with no answers had finished, and every
 * partial import would push that timestamp later, so the run list would show a
 * completion time that tracked the last paste. The column stays NULL until the
 * run genuinely ends, which is what `listComparisonRuns` renders.
 */
async function parkRun(runId: string, status: string): Promise<void> {
  // `finished_at` is CLEARED, not merely left alone. A by-hand run that was
  // cancelled during its prompt build has already been stamped by finishRun,
  // and resuming it by pasting an answer is allowed (see assertManualRun), so
  // without this the resumed run carries the cancel's timestamp and shows a
  // completion time while it waits - the symptom this function exists to
  // remove, reached by the one path that goes backwards out of a terminal
  // status.
  await query(
    `UPDATE analysis_comparison_runs
        SET status = $2, error = NULL, finished_at = NULL
      WHERE id = $1`,
    [runId, status]
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
  sources:
    | {
        title: string
        domain: string
        url: string | null
        chars: number
        curated?: boolean
        fetchedChars?: number
        strippedChars?: number
      }[]
    | null
  /**
   * 0195. NULL means the source filter was not asked.
   *
   * `unknown` rather than the interface, because this is DRIVER OUTPUT and the
   * annotation would be a claim nothing checks — `sections` two fields up
   * carries the same note. It goes through `readJudgedSourceReport` before any
   * field is read off it.
   */
  judged_sources: unknown
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
      // STORED SINCE THE COLUMN EXISTED AND DROPPED HERE. The write above has
      // always put `url` in the row; this mapping picked three fields and the
      // report had no way back to any page in it. Stored as NULL under native
      // grounding, so the check is for a non-empty string, not for presence.
      ...(s.url ? { url: s.url } : {}),
      // Only ever true: absent must stay absent, or a run stored before the
      // curated search would claim that search rejected every document.
      ...(s.curated === true ? { curated: true } : {}),
      ...(s.fetchedChars != null ? { fetchedChars: s.fetchedChars } : {}),
      ...(s.strippedChars ? { strippedChars: s.strippedChars } : {}),
    })),
    retrievedChars: run.retrieved_chars ?? 0,
    // Absent stays absent: a run made before the filter existed, or with it
    // off, must not render as "it read everything and kept everything".
    judgedSources: readJudgedSourceReport(run.judged_sources),
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

/* ------------------------------------------------------------------------ */
/* THE MANUAL LANE                                                           */
/* ------------------------------------------------------------------------ */

/**
 * A bench whose answers are entered by hand.
 *
 * WHY THIS IS THE BENCH AND NOT OFFSITE ANALYSIS. Offsite exists for the same
 * practical reason - prompts built here, a model run somewhere else, answers
 * imported - but it is a LIBRARY WRITER: its import goes through
 * `storeAnalysisOutcome`, so the first answer for a title becomes the stored
 * article, the title stops being pending, and a second model can never answer
 * it. It also carries one prompt version per batch and produces no report. All
 * three are exactly wrong for comparing a prompt across models, which needs N
 * models x M versions on ONE retrieval, written nowhere, read as a table.
 *
 * So this is `startComparison` with the provider call taken out. It shares the
 * retrieval, the prompt building, the output contract and the report with the
 * model lane - see `prepareComparison` and `writeComparisonAnswer`, which both
 * exist so the two lanes cannot drift apart.
 *
 * THE FILE FORMAT IS OFFSITE'S, deliberately reused rather than invented
 * again: `buildExportLine` and `parseOffsiteResults` already define a line, and
 * `parseOffsiteResults` is already tolerant of a file stitched together by hand
 * (blank lines, a half-written last line, an id answered twice) because it was
 * written for a killed-and-resumed runner. A hand-made results file needs only
 * `custom_id` and `text`; everything else on the line is optional.
 */
export const MANUAL_PROVIDER = 'manual'

/** How many hand-entered labels one bench may hold. The model lane's ceiling. */
export const MAX_MANUAL_LABELS = MAX_COMPARISON_MODELS

export interface StartManualComparisonOptions {
  mediaType: 'movie' | 'series'
  mediaId: string
  /**
   * What to call each answer in the report - "polystrata / some-model". These
   * are labels the operator types, not model ids anything will be asked to
   * resolve, because nothing here calls a provider.
   */
  labels: string[]
  promptVersions?: number[]
  promptVariants?: string[]
}

/**
 * `awaiting` is a fourth run status beside running/completed/cancelled/failed.
 *
 * No migration: `analysis_comparison_runs.status` is plain TEXT with no CHECK,
 * which is the shape [F-002] asks for - a vocabulary that lives in one place
 * rather than in the schema as well.
 */
export const MANUAL_AWAITING = 'awaiting'

/**
 * Build the prompts and stop.
 *
 * Returns once the prompts exist, like `startComparison`, because retrieval is
 * a search plus up to ten page fetches and an HTTP request must not be held
 * open for it. The page polls, and the run sits at `awaiting` until answers
 * are imported.
 */
export async function startManualComparison(
  options: StartManualComparisonOptions
): Promise<string> {
  const mode = await getRetrievalMode()
  if (mode !== 'crw') {
    throw new Error(
      'Comparison needs retrieval mode "crw". Under grounding each model searches for itself, so the answers would not be built from the same sources and the comparison would mean nothing.'
    )
  }

  const subject = await loadAnalysisSubject(options.mediaType, options.mediaId)
  if (!subject) throw new Error('That title is not in the library.')

  const labels = options.labels
    .map((label) => label.trim())
    .filter((label) => label !== '')
    .slice(0, MAX_MANUAL_LABELS)
  if (labels.length === 0) throw new Error('Name at least one model you will run by hand.')

  const choices = resolveBenchPromptChoices(options.promptVersions, options.promptVariants)

  const run = await queryOne<{ id: string }>(
    `INSERT INTO analysis_comparison_runs (media_type, media_id, title, year, prompt_version, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      options.mediaType,
      options.mediaId,
      subject.title,
      subject.year,
      headlineVersion(choices),
      'running',
    ]
  )
  if (!run) throw new Error('Could not start the comparison.')

  await launchManual(run.id, options.mediaType, options.mediaId, labels, choices, null)
  return run.id
}

/**
 * Write the pending rows, build the prompts, and park.
 *
 * `launch`'s counterpart for this lane, and shared by a fresh by-hand bench
 * and a replay of one for the same reason `launch` is shared: a second copy
 * would be the place the two drift. `replaySources` is null for a new run and
 * the baseline's documents for a replay, which is the only difference between
 * them - everything below, including the cancel rule, is identical.
 */
async function launchManual(
  runId: string,
  mediaType: 'movie' | 'series',
  mediaId: string,
  labels: string[],
  choices: PromptChoice[],
  replaySources: AnalysisSource[] | null
): Promise<void> {
  const entries = planEntries(
    labels.map((label) => ({ provider: MANUAL_PROVIDER, model: label })),
    choices
  )
  for (const entry of entries) {
    await query(
      `INSERT INTO analysis_comparison_results
         (run_id, position, provider, model, prompt_version, prompt_variant)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [runId, entry.position, entry.provider, entry.model, entry.choice.version, entry.choice.variant]
    )
  }

  running.add(runId)
  // Deliberately not awaited, exactly as the model lane is not: the caller
  // answers 202 and the page polls. A throw here is the run's own failure and
  // is recorded against it rather than killing the process.
  void (async () => {
    try {
      await prepareComparison(runId, mediaType, mediaId, choices, replaySources)
      // COOPERATIVE, exactly as the model lane's cancel is: retrieval is one
      // search plus its page fetches and is not interruptible, so Stop cannot
      // cut it short - but it must still decide the outcome, or the button
      // reports success and the run goes on to collect answers anyway.
      if (cancelled.has(runId)) {
        await finishRun(runId, 'cancelled', null)
      } else {
        await parkRun(runId, MANUAL_AWAITING)
      }
    } catch (err) {
      const described = describeAiError(err)
      logger.error({ runId, ...described }, 'Manual comparison could not build its prompts')
      await finishRun(runId, 'failed', err instanceof Error ? err.message : String(err))
    } finally {
      running.delete(runId)
      // Both sets, as driveComparison's finally does. Leaving the id behind
      // keeps it in a module-level Set for the life of the process.
      cancelled.delete(runId)
    }
  })()
}

/**
 * The id one exported line carries.
 *
 * Run id AND position, so a results file pasted into the wrong run is refused
 * rather than silently matched - a bare position would be valid in every run
 * this build has ever made, and the wrong answers would be stored against real
 * rows with nothing to show for it. Pure and pinned for that reason.
 */
export function manualCustomId(runId: string, position: number): string {
  return `${runId}:${position}`
}

/**
 * Which answer of THIS run a line names, or null.
 *
 * Null for every way of not belonging: another run's id, a bare position from
 * a hand-written line, a uuid with no position, a position that is not a whole
 * number. The caller reports those back as unmatched rather than guessing,
 * because a guess here writes somebody else's answer into a row.
 */
export function readManualCustomId(runId: string, customId: string): number | null {
  const marker = customId.lastIndexOf(':')
  if (marker < 1) return null
  if (customId.slice(0, marker) !== runId) return null
  const tail = customId.slice(marker + 1)
  // `Number('')` is 0, not NaN, so a trailing colon would otherwise read as
  // position 0 and store somebody's answer against the run's first row.
  if (tail.trim() === '') return null
  const position = Number(tail)
  if (!Number.isInteger(position) || position < 0) return null
  return position
}

export interface ManualExportLine {
  position: number
  model: string
  promptLabel: string
  answered: boolean
}

/**
 * Refuse a run that is not this lane's.
 *
 * WITHOUT THIS, `MANUAL_PROVIDER` IS WRITTEN AND NEVER READ, and both ends are
 * open: the download emits lines for any pending row of any run, so a model
 * bench cancelled part way hands out ids, and importing answers for them
 * overwrites its rows and relabels a `cancelled` run `completed` - the record
 * that it was stopped is gone. The provider column already says which lane a
 * run belongs to; this is the read that makes it mean something.
 *
 * A by-hand run that was cancelled CAN still be imported into, deliberately:
 * pasting an answer into one is the operator resuming it, and the status
 * follows what is outstanding.
 */
async function assertManualRun(runId: string): Promise<void> {
  const rows = await query<{ provider: string }>(
    `SELECT DISTINCT provider FROM analysis_comparison_results WHERE run_id = $1`,
    [runId]
  )
  if (rows.rows.length === 0) throw new Error('That comparison has no answers to fill in.')
  const other = rows.rows.find((row) => row.provider !== MANUAL_PROVIDER)
  if (other) {
    throw new Error(
      `That comparison ran its models through ${other.provider}, so its answers are not entered by hand.`
    )
  }
}

/**
 * Export the prompts of a manual run, one JSONL line per answer still wanted.
 *
 * Each line carries the WHOLE prompt as `prompt`, which is the field to paste
 * into whatever interface is running the model. Lines already answered are
 * left out, so re-downloading after a partial import gives exactly what is
 * still outstanding.
 */
export async function exportManualComparison(
  runId: string
): Promise<{ jsonl: string; lines: ManualExportLine[] }> {
  const run = await queryOne<{
    media_type: 'movie' | 'series'
    title: string
    year: number | null
    prompts: Record<string, string> | null
    prompt: string | null
  }>(
    `SELECT media_type, title, year, prompts, prompt
       FROM analysis_comparison_runs WHERE id = $1`,
    [runId]
  )
  if (!run) throw new Error('That comparison run does not exist.')
  await assertManualRun(runId)
  if (!run.prompts && !run.prompt) {
    throw new Error('That run has not built its prompts yet.')
  }

  const rows = await query<{
    position: number
    model: string
    prompt_version: number
    prompt_variant: string | null
    status: string
  }>(
    `SELECT position, model, prompt_version, prompt_variant, status
       FROM analysis_comparison_results
      WHERE run_id = $1
      ORDER BY position`,
    [runId]
  )

  const maxOutputTokens = (await getCrwConfig()).analysisMaxOutputTokens
  const out: string[] = []
  const lines: ManualExportLine[] = []

  for (const row of rows.rows) {
    const choice: PromptChoice = { version: row.prompt_version, variant: row.prompt_variant }
    const prompt = run.prompts?.[promptChoiceKey(choice)] ?? run.prompt
    if (!prompt) continue
    const answered = row.status !== 'pending'
    lines.push({
      position: row.position,
      model: row.model,
      promptLabel: promptChoiceLabel(choice),
      answered,
    })
    if (answered) continue
    out.push(
      buildExportLine(
        {
          id: manualCustomId(runId, row.position),
          mediaType: run.media_type,
          title: run.title,
          year: run.year,
          attempt: 0,
          prompt,
          // The model this line is for. Without it the runner cannot tell a
          // bench's lines apart and answers all of them with one model.
          label: row.model,
        },
        {
          promptVersion: row.prompt_version,
          promptVariant: row.prompt_variant,
          maxOutputTokens: maxOutputTokens > 0 ? maxOutputTokens : null,
        }
      )
    )
  }

  return { jsonl: out.map((line) => line + '\n').join(''), lines }
}

export interface ManualImportSummary {
  stored: number
  unusable: number
  errors: number
  /** Lines whose custom_id names no pending answer in this run. */
  unmatched: string[]
  /** 1-based line numbers that were not a result line. */
  badLines: number[]
  /** Answers still outstanding after this import. */
  remaining: number
}

/**
 * Take a results file and score it exactly as a provider's answer is scored.
 *
 * An answer that breaks the output contract is stored as `unusable` with its
 * problem, which is the same outcome a model gets and is a real finding rather
 * than an import failure - a model that cannot hold the contract is usually
 * what a bench discovers. Only a line nothing matches is reported back as a
 * mistake.
 */
export async function importManualComparison(
  runId: string,
  jsonl: string
): Promise<ManualImportSummary> {
  const run = await queryOne<{ media_type: 'movie' | 'series'; status: string }>(
    `SELECT media_type, status FROM analysis_comparison_runs WHERE id = $1`,
    [runId]
  )
  if (!run) throw new Error('That comparison run does not exist.')
  await assertManualRun(runId)

  const rows = await query<{ position: number; prompt_version: number; status: string }>(
    `SELECT position, prompt_version, status
       FROM analysis_comparison_results WHERE run_id = $1`,
    [runId]
  )
  const byPosition = new Map(rows.rows.map((row) => [row.position, row]))

  const parsed = parseOffsiteResults(jsonl)
  const summary: ManualImportSummary = {
    stored: 0,
    unusable: 0,
    errors: 0,
    unmatched: [],
    badLines: parsed.badLines,
    remaining: 0,
  }

  for (const result of parsed.results) {
    const position = readManualCustomId(runId, result.customId)
    if (position == null || !byPosition.has(position)) {
      summary.unmatched.push(result.customId)
      continue
    }
    const row = byPosition.get(position)!

    if (result.kind === 'error') {
      await writeComparisonFailure(runId, position, result.error)
      summary.errors++
      row.status = 'error'
      continue
    }

    // The library job's own reader, never a copy: the output contract, the
    // begin marker, the grade line and the paragraph map are all judged here
    // the way `analyseTitle` judges them.
    const reading = readAnalysis(result.text, result.finishReason ?? undefined, {
      mediaType: run.media_type,
      promptVersion: row.prompt_version,
    })
    const status = reading.problem ? 'unusable' : 'ok'
    await writeComparisonAnswer(
      runId,
      position,
      reading,
      { mediaType: run.media_type, promptVersion: row.prompt_version },
      {
        status,
        finishReason: result.finishReason,
        outputTokens: result.outputTokens,
      }
    )
    if (status === 'ok') summary.stored++
    else summary.unusable++
    row.status = status
  }

  summary.remaining = [...byPosition.values()].filter((row) => row.status === 'pending').length

  // A run is only finished once nothing is outstanding. Until then it is
  // PARKED rather than finished, so the page keeps offering the download and
  // the paste box and `finished_at` stays NULL.
  if (summary.remaining === 0) await finishRun(runId, 'completed', null)
  else await parkRun(runId, MANUAL_AWAITING)

  logger.info({ runId, ...summary, unmatched: summary.unmatched.length }, 'Manual answers imported')
  return summary
}
