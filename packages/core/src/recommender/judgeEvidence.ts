/**
 * Ask the optional decision model whether each pick's evidence is a real
 * reason, and store its verdicts beside the evidence rows.
 *
 * The why is in ./evidenceJudgment.ts (pure, pinned). This file is the I/O:
 * load a run's picks and evidence, ask, write `judged_connection`. The read
 * side is `evidenceSupportsCause` in ./evidenceStrength.ts, which uses a
 * verdict only when a pick has a complete set and otherwise falls back to the
 * cosine bar — so every way this can fail leaves the app exactly as it was.
 *
 * NEVER THROWS. It runs inside a recommendation run that has already produced
 * good picks; prose about those picks must not be able to fail it (the same
 * rule as the Watcher Identity refresh, F-111).
 *
 * RESERVED-SLOT PICKS ARE SKIPPED. A twin, interest or acclaimed pick always
 * takes the hedged heading whatever its evidence says (F-052), so judging it
 * would pay for a verdict nothing reads.
 */
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import {
  callSystemOne,
  getDecisionModelConfig,
  resolveDecisionEndpoint,
  DecisionModelError,
  type DecisionEndpoint,
} from '../lib/decisionModel.js'
import {
  isSystemicDecisionFailure,
  sanitizeDecisionModelConfig,
  type DecisionModelConfig,
} from '../lib/decisionModelRules.js'
import {
  buildEvidenceJudgmentRequest,
  readEvidenceJudgments,
  summarizeEvidenceJudgments,
  type EvidenceJudgmentSummary,
  type JudgedEvidenceRow,
  type JudgedMediaType,
  type JudgedTitleFacts,
} from './evidenceJudgment.js'
import { EVIDENCE_JUDGMENT_MIN_YES } from './evidenceStrength.js'

const logger = createChildLogger('evidence-judge')

/**
 * Consecutive failed picks after which a run stops asking. Systemic failures
 * (bad key, unknown endpoint) stop it at the first; this catches the rest — a
 * wrong model id answers 400, which is also what one oversized state answers.
 */
const CONSECUTIVE_FAILURE_LIMIT = 3

/**
 * A pick placed by a reserved slot, read the way `readSlotOrigin` reads it: the
 * key present AND not JSON null.
 */
/**
 * Each viewer's newest completed run per media type — the run every reader
 * resolves (the panel, the explanation refresh). Shared by the read-back and
 * the labelling queue so the two can never be reading different runs.
 */
export const NEWEST_RUNS_SQL = `SELECT DISTINCT ON (user_id, media_type) id, media_type
  FROM recommendation_runs
  WHERE status = 'completed' AND channel_id IS NULL
  ORDER BY user_id, media_type, created_at DESC`

export const RESERVED_SLOT_SQL = `(
  COALESCE(jsonb_typeof(rc.score_breakdown->'twinMatch'), 'null') <> 'null'
  OR COALESCE(jsonb_typeof(rc.score_breakdown->'interestMatch'), 'null') <> 'null'
  OR COALESCE(jsonb_typeof(rc.score_breakdown->'acclaimedMatch'), 'null') <> 'null'
)`

interface MediaColumns {
  pick: 'movie_id' | 'series_id'
  evidence: 'similar_movie_id' | 'similar_series_id'
}

function columnsFor(mediaType: JudgedMediaType): MediaColumns {
  return mediaType === 'movie'
    ? { pick: 'movie_id', evidence: 'similar_movie_id' }
    : { pick: 'series_id', evidence: 'similar_series_id' }
}

interface FactsRow {
  id: string
  title: string
  year: number | null
  genres: string[] | null
  directors: string[] | null
  keywords: string[] | null
  overview: string | null
  franchise: string | null
  network: string | null
}

/**
 * What the model is shown about each title. Exported so the benchmark sends
 * exactly what a run sends; a second copy would let the two measure different
 * requests.
 */
export async function loadJudgedTitleFacts(
  mediaType: JudgedMediaType,
  ids: string[]
): Promise<Map<string, JudgedTitleFacts>> {
  if (ids.length === 0) return new Map()
  const result = await query<FactsRow>(
    mediaType === 'movie'
      ? `SELECT id, title, year, genres, directors, keywords, overview,
                collection_name AS franchise, NULL::text AS network
         FROM movies WHERE id = ANY($1)`
      : // The media server supplies creators for almost no show (0192), so
        // TMDb's are read whenever its list is empty. Same fallback for the
        // model and the credits rule, since both are handed these facts.
        `SELECT id, title, year, genres,
                COALESCE(NULLIF(directors, '{}'::text[]), tmdb_creators, '{}'::text[]) AS directors,
                keywords, overview, NULL::text AS franchise, network
         FROM series WHERE id = ANY($1)`,
    [ids]
  )
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        title: row.title,
        year: row.year,
        genres: row.genres ?? [],
        creators: row.directors ?? [],
        franchise: row.franchise,
        network: row.network,
        themes: row.keywords ?? [],
        synopsis: row.overview,
      },
    ])
  )
}

export interface EvidenceJudgmentOutcome {
  /**
   * off: the integration is switched off. unavailable: on, but it cannot be
   * called (no key, no URL). nothing: no eligible pick. done: every eligible
   * pick was asked. stopped: the run gave up part-way (cancel, failures).
   */
  status: 'off' | 'unavailable' | 'nothing' | 'done' | 'stopped'
  /** Picks that now carry a full set of verdicts. */
  judged: number
  /** Picks asked and not answered; they keep the cosine bar. */
  failed: number
  reason?: string
}

interface PickToJudge {
  candidateId: string
  pickId: string
  evidence: Array<{ evidenceId: string; itemId: string }>
}

export interface JudgeRunOptions {
  shouldCancel?: () => boolean
  /**
   * Ask only for picks still missing a verdict. Used by the explanation
   * refresh, so switching this on and refreshing reaches existing runs without
   * re-scoring them — and re-running a refresh does not pay twice.
   */
  onlyUnjudged?: boolean
}

/**
 * Judge every ranked pick of one run. See the file header for the guarantees.
 */
export async function judgeRunEvidence(
  runId: string,
  mediaType: JudgedMediaType,
  options: JudgeRunOptions = {}
): Promise<EvidenceJudgmentOutcome> {
  try {
    const config = await getDecisionModelConfig()
    if (!config.enabled) return { status: 'off', judged: 0, failed: 0 }

    const resolved = await resolveDecisionEndpoint(config)
    if (!resolved.ok) {
      logger.warn({ runId, reason: resolved.reason }, 'Decision model is on but cannot be called; using the cosine bar')
      return { status: 'unavailable', judged: 0, failed: 0, reason: resolved.reason }
    }

    const cols = columnsFor(mediaType)
    const rows = await query<{
      candidate_id: string
      pick_id: string
      evidence_id: string
      evidence_item_id: string
      judged_connection: number | string | null
    }>(
      `SELECT rc.id AS candidate_id, rc.${cols.pick} AS pick_id,
              re.id AS evidence_id, re.${cols.evidence} AS evidence_item_id,
              re.judged_connection
       FROM recommendation_candidates rc
       JOIN recommendation_evidence re ON re.candidate_id = rc.id
       WHERE rc.run_id = $1 AND rc.is_selected = true
         AND re.${cols.evidence} IS NOT NULL
         AND NOT ${RESERVED_SLOT_SQL}
       ORDER BY rc.selected_rank NULLS LAST, rc.rank, re.similarity DESC`,
      [runId]
    )

    const picks = new Map<string, PickToJudge & { complete: boolean }>()
    for (const row of rows.rows) {
      let pick = picks.get(row.candidate_id)
      if (!pick) {
        pick = { candidateId: row.candidate_id, pickId: row.pick_id, evidence: [], complete: true }
        picks.set(row.candidate_id, pick)
      }
      pick.evidence.push({ evidenceId: row.evidence_id, itemId: row.evidence_item_id })
      if (row.judged_connection == null) pick.complete = false
    }

    const todo = [...picks.values()].filter((p) => !(options.onlyUnjudged && p.complete))
    if (todo.length === 0) return { status: 'nothing', judged: 0, failed: 0 }

    const ids = new Set<string>()
    for (const pick of todo) {
      ids.add(pick.pickId)
      for (const e of pick.evidence) ids.add(e.itemId)
    }
    const facts = await loadJudgedTitleFacts(mediaType, [...ids])

    const result = await askForPicks(todo, facts, mediaType, config, resolved.endpoint, options)

    if (result.updates.length > 0) {
      await query(
        `UPDATE recommendation_evidence re
         SET judged_connection = t.p, judged_model = t.m
         FROM unnest($1::uuid[], $2::real[], $3::text[]) AS t(id, p, m)
         WHERE re.id = t.id`,
        [
          result.updates.map((u) => u.evidenceId),
          result.updates.map((u) => u.probability),
          result.updates.map((u) => u.model),
        ]
      )
    }

    const outcome: EvidenceJudgmentOutcome = {
      status: result.stoppedReason ? 'stopped' : 'done',
      judged: result.judged,
      failed: result.failed,
      reason: result.stoppedReason ?? undefined,
    }
    logger.info(
      { runId, mediaType, model: config.model, ...outcome, eligible: todo.length },
      outcome.status === 'done'
        ? `⚖️ Decision model judged ${outcome.judged}/${todo.length} picks' evidence`
        : `⚖️ Decision model stopped after ${outcome.judged}/${todo.length} picks: ${outcome.reason}`
    )
    return outcome
  } catch (err) {
    logger.warn({ err, runId, mediaType }, 'Judging evidence failed; picks keep the cosine bar')
    return { status: 'stopped', judged: 0, failed: 0, reason: err instanceof Error ? err.message : String(err) }
  }
}

interface AskResult {
  updates: Array<{ evidenceId: string; probability: number; model: string }>
  judged: number
  failed: number
  stoppedReason: string | null
}

async function askForPicks(
  picks: PickToJudge[],
  facts: Map<string, JudgedTitleFacts>,
  mediaType: JudgedMediaType,
  config: DecisionModelConfig,
  endpoint: DecisionEndpoint,
  options: JudgeRunOptions
): Promise<AskResult> {
  const result: AskResult = { updates: [], judged: 0, failed: 0, stoppedReason: null }
  let consecutiveFailures = 0
  let next = 0

  const worker = async () => {
    for (;;) {
      if (result.stoppedReason) return
      if (options.shouldCancel?.()) {
        result.stoppedReason = 'cancelled'
        return
      }
      const pick = picks[next++]
      if (!pick) return

      const pickFacts = facts.get(pick.pickId)
      const evidenceFacts = pick.evidence.map((e) => facts.get(e.itemId))
      if (!pickFacts || evidenceFacts.some((f) => !f)) continue

      const request = buildEvidenceJudgmentRequest(
        pickFacts,
        evidenceFacts as JudgedTitleFacts[],
        mediaType
      )
      try {
        const answer = await callSystemOne(
          endpoint,
          { model: config.model, state: request.state, questions: request.questions },
          config.timeoutMs
        )
        const verdicts = readEvidenceJudgments(answer.answers, request.keys)
        if (!verdicts) throw new DecisionModelError('The answer was missing a verdict')
        verdicts.forEach((probability, i) => {
          result.updates.push({ evidenceId: pick.evidence[i].evidenceId, probability, model: answer.model })
        })
        result.judged++
        consecutiveFailures = 0
      } catch (err) {
        result.failed++
        consecutiveFailures++
        const status = err instanceof DecisionModelError ? err.status : undefined
        const message = err instanceof Error ? err.message : String(err)
        logger.debug({ err, candidateId: pick.candidateId }, 'Decision model call failed for one pick')
        if (isSystemicDecisionFailure(status)) {
          result.stoppedReason = message
        } else if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
          result.stoppedReason = `${consecutiveFailures} calls failed in a row (last: ${message})`
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(config.concurrency, picks.length) }, worker))
  return result
}

// ============================================================================
// Settings card: a live test, and what the stored verdicts say
// ============================================================================

/**
 * Two fixed pairs with obvious answers, one each way, built by the SAME request
 * builder the runs use. A model that cannot tell a sequel from an unrelated
 * film will not tell anything subtler, and a test that only checked "it
 * answered" would pass on a model that answers 0.5 to everything.
 */
const TEST_PICK: JudgedTitleFacts = {
  title: 'Dune: Part Two',
  year: 2024,
  genres: ['Science Fiction', 'Adventure'],
  creators: ['Denis Villeneuve'],
  franchise: 'Dune Collection',
  themes: ['desert', 'prophecy', 'revenge', 'empire'],
  synopsis:
    'Paul Atreides joins the Fremen of the desert planet Arrakis and wages war on the house that destroyed his family.',
}
const TEST_RELATED: JudgedTitleFacts = {
  title: 'Dune',
  year: 2021,
  genres: ['Science Fiction', 'Adventure'],
  creators: ['Denis Villeneuve'],
  franchise: 'Dune Collection',
  themes: ['desert', 'prophecy', 'empire'],
  synopsis:
    'The heir of a noble house is sent with his family to rule Arrakis, a desert planet that holds the most valuable substance in the universe.',
}
const TEST_UNRELATED: JudgedTitleFacts = {
  title: 'Thirteen Lives',
  year: 2022,
  genres: ['Drama', 'Thriller'],
  creators: ['Ron Howard'],
  themes: ['cave', 'rescue', 'thailand', 'true story'],
  synopsis:
    'Divers and volunteers attempt to rescue a youth football team trapped in a flooded cave in northern Thailand.',
}

export type EvidenceJudgeTestResult =
  | {
      success: true
      model: string
      latencyMs: number
      /** P(yes) for the sequel pair; expected high. */
      related: number
      /** P(yes) for the unrelated pair; expected low. */
      unrelated: number
      /** Whether the two land on the right sides of the line. */
      discriminates: boolean
    }
  | { success: false; error: string }

export async function testEvidenceJudge(
  input: Partial<DecisionModelConfig>
): Promise<EvidenceJudgeTestResult> {
  // Enabled is irrelevant to a test: the point is to try it before turning it on.
  const config = sanitizeDecisionModelConfig({ ...input, enabled: true })
  const resolved = await resolveDecisionEndpoint(config)
  if (!resolved.ok) return { success: false, error: resolved.reason }

  const request = buildEvidenceJudgmentRequest(TEST_PICK, [TEST_RELATED, TEST_UNRELATED], 'movie')
  try {
    const answer = await callSystemOne(
      resolved.endpoint,
      { model: config.model, state: request.state, questions: request.questions },
      config.timeoutMs
    )
    const verdicts = readEvidenceJudgments(answer.answers, request.keys)
    if (!verdicts) {
      return {
        success: false,
        error: `${answer.model} answered, but not with a yes/no probability for each question`,
      }
    }
    const [related, unrelated] = verdicts
    return {
      success: true,
      model: answer.model,
      latencyMs: answer.latencyMs,
      related,
      unrelated,
      discriminates: related >= EVIDENCE_JUDGMENT_MIN_YES && unrelated < EVIDENCE_JUDGMENT_MIN_YES,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface EvidenceJudgmentStats extends EvidenceJudgmentSummary {
  /** Newest completed runs the figures cover (one per viewer per media type). */
  runs: number
}

/**
 * How the stored verdicts compare with the cosine bar on the newest completed
 * run per viewer and media type — the runs the panel actually reads. Never
 * throws: a database without the migration reports nothing judged.
 */
export async function getEvidenceJudgmentStats(): Promise<EvidenceJudgmentStats> {
  const empty: EvidenceJudgmentStats = {
    runs: 0,
    picks: 0,
    judgedPicks: 0,
    agree: 0,
    judgeOnly: 0,
    cosineOnly: 0,
    examples: [],
    models: [],
  }
  try {
    const result = await query<{
      run_id: string
      candidate_id: string
      media_type: string
      pick_title: string
      evidence_title: string
      similarity: number | string | null
      judged_connection: number | string | null
      judged_model: string | null
    }>(
      `WITH latest AS (${NEWEST_RUNS_SQL})
       SELECT l.id AS run_id, rc.id AS candidate_id, l.media_type,
              COALESCE(pm.title, ps.title) AS pick_title,
              COALESCE(em.title, es.title) AS evidence_title,
              re.similarity, re.judged_connection, re.judged_model
       FROM latest l
       JOIN recommendation_candidates rc ON rc.run_id = l.id AND rc.is_selected = true
       JOIN recommendation_evidence re ON re.candidate_id = rc.id
       LEFT JOIN movies pm ON pm.id = rc.movie_id
       LEFT JOIN series ps ON ps.id = rc.series_id
       LEFT JOIN movies em ON em.id = re.similar_movie_id
       LEFT JOIN series es ON es.id = re.similar_series_id
       WHERE NOT ${RESERVED_SLOT_SQL}`
    )

    const rows: JudgedEvidenceRow[] = result.rows.map((r) => ({
      candidateId: r.candidate_id,
      mediaType: r.media_type,
      pickTitle: r.pick_title ?? '',
      evidenceTitle: r.evidence_title ?? '',
      similarity: r.similarity,
      judgedConnection: r.judged_connection,
      judgedModel: r.judged_model,
    }))
    return {
      runs: new Set(result.rows.map((r) => r.run_id)).size,
      ...summarizeEvidenceJudgments(rows),
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read evidence judgment stats')
    return empty
  }
}

/**
 * Forget every stored verdict, so every heading goes back to the cosine bar.
 *
 * This is the way back. A verdict belongs to the run it was written for, like
 * a score: switching the feature off stops NEW verdicts, but the ones already
 * stored keep deciding their picks' headings until those picks are replaced,
 * because the explanation prose was written to match them. An operator who has
 * read the disagreements and does not trust the model needs to undo it without
 * regenerating everyone's recommendations — and needs it before comparing a
 * second model, or the read-back pools the two.
 *
 * Explanations written to a cleared verdict's heading stay as they are until
 * the explanation refresh rewrites them; the card says so.
 */
export async function clearEvidenceJudgments(): Promise<number> {
  const result = await query(
    `UPDATE recommendation_evidence
     SET judged_connection = NULL, judged_model = NULL
     WHERE judged_connection IS NOT NULL OR judged_model IS NOT NULL`
  )
  const cleared = result.rowCount ?? 0
  logger.info({ cleared }, 'Cleared stored decision-model verdicts')
  return cleared
}
