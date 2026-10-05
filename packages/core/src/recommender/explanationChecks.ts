/**
 * Check the written recommendation explanations with the decision model, and
 * read the checks back beside the operator's labels. The rules — what the
 * model is shown and asked, how answers and labels are read — are pure and
 * live in ./explanationCheck.ts.
 *
 * SHADOW ONLY. Nothing a viewer sees reads these results. The job measures;
 * the card shows how often each check fails and asks the operator to accept or
 * reject explanations blind, which is what says whether the checks can be
 * trusted. Only then is acting on them (regenerating a failing explanation,
 * or fixing the prompt) a decision with evidence behind it.
 *
 * The explanations are the ones every reader resolves: the newest completed
 * run per viewer and media type. The context each was written from is rebuilt
 * from the same sources the writer used — the fact loader, the analysis
 * grounding, the reception wording, the reserved-slot origin, and the heading
 * evidenceSupportsCause decides — so "not in the data" means the data the
 * writer actually had.
 */
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import {
  callSystemOne,
  getDecisionModelConfig,
  resolveDecisionEndpoint,
  DecisionModelError,
} from '../lib/decisionModel.js'
import { isSystemicDecisionFailure, sanitizeDecisionModelConfig } from '../lib/decisionModelRules.js'
import {
  createJobProgress,
  setJobStep,
  updateJobProgress,
  addLog,
  completeJob,
  failJob,
  isJobCancelled,
} from '../jobs/progress.js'
import { formatAnalysisGrounding, loadAnalysisGrounding } from '../analysis/grounding.js'
import type { JudgedTitleFacts } from './evidenceJudgment.js'
import { evidenceSupportsCause } from './evidenceStrength.js'
import { labellingOrder } from './evidenceLabelling.js'
import {
  EXPLANATION_CHECKS,
  buildExplanationCheckRequest,
  explanationFailures,
  explanationHash,
  pickOrigin,
  readExplanationChecks,
  receptionLabel,
  tallyExplanationAgreement,
  isExplanationLabel,
  type ExplanationAgreement,
  type ExplanationCheckId,
  type ExplanationCheckInput,
  type ExplanationCheckScores,
  type ExplanationHeading,
  type ExplanationLabel,
  type PickOrigin,
} from './explanationCheck.js'
import { NEWEST_RUNS_SQL, loadJudgedTitleFacts } from './judgeEvidence.js'

const logger = createChildLogger('explanation-checks')

export const CHECK_EXPLANATIONS_JOB = 'check-recommendation-explanations'
const CONSECUTIVE_FAILURE_LIMIT = 3

type MediaType = 'movie' | 'series'

interface CandidateExplanation {
  hash: string
  mediaType: MediaType
  pickId: string
  explanation: string
  heading: ExplanationHeading
  origin: PickOrigin
  interestText: string | null
  ratingScore: number | null
  watchedIds: string[]
}

/**
 * Every explanation on the newest runs, with the heading its writer was given.
 * One query for the picks and one for their evidence; the same text appearing
 * twice (it should not) is kept once.
 */
async function loadCandidateExplanations(): Promise<CandidateExplanation[]> {
  const picks = await query<{
    candidate_id: string
    media_type: string
    pick_id: string
    ai_explanation: string
    rating_score: number | string | null
    score_breakdown: unknown
  }>(
    `WITH latest AS (${NEWEST_RUNS_SQL})
     SELECT rc.id AS candidate_id, l.media_type,
            COALESCE(rc.movie_id, rc.series_id) AS pick_id,
            rc.ai_explanation, rc.rating_score, rc.score_breakdown
     FROM latest l
     JOIN recommendation_candidates rc ON rc.run_id = l.id AND rc.is_selected = true
     WHERE rc.ai_explanation IS NOT NULL AND length(trim(rc.ai_explanation)) > 0`
  )
  if (picks.rows.length === 0) return []

  const evidence = await query<{
    candidate_id: string
    watched_id: string
    similarity: number | string | null
    judged_connection: number | string | null
  }>(
    `SELECT re.candidate_id,
            COALESCE(re.similar_movie_id, re.similar_series_id) AS watched_id,
            re.similarity, re.judged_connection
     FROM recommendation_evidence re
     WHERE re.candidate_id = ANY($1::uuid[])
     ORDER BY re.candidate_id, re.similarity DESC`,
    [picks.rows.map((p) => p.candidate_id)]
  )
  const evidenceByCandidate = new Map<string, typeof evidence.rows>()
  for (const row of evidence.rows) {
    const list = evidenceByCandidate.get(row.candidate_id)
    if (list) list.push(row)
    else evidenceByCandidate.set(row.candidate_id, [row])
  }

  const out = new Map<string, CandidateExplanation>()
  for (const p of picks.rows) {
    const mediaType = p.media_type === 'series' ? 'series' : p.media_type === 'movie' ? 'movie' : null
    if (!mediaType || !p.pick_id) continue
    const hash = explanationHash(p.ai_explanation)
    if (out.has(hash)) continue
    const rows = evidenceByCandidate.get(p.candidate_id) ?? []
    const { origin, interestText } = pickOrigin(p.score_breakdown)
    // The heading the writer saw: a reserved-slot pick always gets the hedged
    // one; a ranked pick gets whatever evidenceSupportsCause decides, which is
    // the same read the explanation prompt makes.
    const heading: ExplanationHeading =
      origin !== 'ranked'
        ? 'contextOnly'
        : evidenceSupportsCause(
              rows.map((r) => ({ similarity: r.similarity, judgedConnection: r.judged_connection }))
            )
          ? 'reason'
          : 'contextOnly'
    const rating = p.rating_score == null ? null : Number.parseFloat(String(p.rating_score))
    out.set(hash, {
      hash,
      mediaType,
      pickId: p.pick_id,
      explanation: p.ai_explanation,
      heading,
      origin,
      interestText,
      ratingScore: Number.isFinite(rating) ? rating : null,
      watchedIds: rows.map((r) => r.watched_id).filter(Boolean),
    })
  }
  return [...out.values()]
}

interface CheckContext {
  facts: Map<string, JudgedTitleFacts>
  analysis: Map<string, string>
}

async function loadContext(items: CandidateExplanation[]): Promise<CheckContext> {
  const ids: Record<MediaType, Set<string>> = { movie: new Set(), series: new Set() }
  const pickIds: Record<MediaType, Set<string>> = { movie: new Set(), series: new Set() }
  for (const item of items) {
    ids[item.mediaType].add(item.pickId)
    pickIds[item.mediaType].add(item.pickId)
    for (const w of item.watchedIds) ids[item.mediaType].add(w)
  }
  const [movieFacts, seriesFacts, movieAnalysis, seriesAnalysis] = await Promise.all([
    loadJudgedTitleFacts('movie', [...ids.movie]),
    loadJudgedTitleFacts('series', [...ids.series]),
    loadAnalysisGrounding('movie', [...pickIds.movie]),
    loadAnalysisGrounding('series', [...pickIds.series]),
  ])
  const facts = new Map<string, JudgedTitleFacts>()
  for (const [id, f] of movieFacts) facts.set(`movie:${id}`, f)
  for (const [id, f] of seriesFacts) facts.set(`series:${id}`, f)
  const analysis = new Map<string, string>()
  for (const [mediaType, grounding] of [
    ['movie', movieAnalysis],
    ['series', seriesAnalysis],
  ] as const) {
    for (const [id, parts] of grounding) {
      const text = formatAnalysisGrounding(parts, '')
      if (text) analysis.set(`${mediaType}:${id}`, text.trim())
    }
  }
  return { facts, analysis }
}

function toInput(item: CandidateExplanation, context: CheckContext): ExplanationCheckInput | null {
  const pick = context.facts.get(`${item.mediaType}:${item.pickId}`)
  if (!pick) return null
  return {
    mediaType: item.mediaType,
    explanation: item.explanation,
    heading: item.heading,
    origin: item.origin,
    interestText: item.interestText,
    reception: receptionLabel(item.mediaType, item.ratingScore),
    pick,
    analysis: context.analysis.get(`${item.mediaType}:${item.pickId}`) ?? null,
    watched: item.watchedIds
      .map((id) => context.facts.get(`${item.mediaType}:${id}`))
      .filter((f): f is JudgedTitleFacts => f != null),
  }
}

export interface ExplanationCheckRunResult {
  explanations: number
  checked: number
  skipped: number
  failed: number
  flagged: number
  cancelled: boolean
}

/**
 * The job: check every explanation on the newest runs that has not already
 * been checked with this model. Uses the decision model as configured on the
 * card whether or not judging is switched on — this is a measurement, not a
 * feature, and it is run by hand.
 */
export async function checkRecommendationExplanations(jobId: string): Promise<ExplanationCheckRunResult> {
  const result: ExplanationCheckRunResult = {
    explanations: 0,
    checked: 0,
    skipped: 0,
    failed: 0,
    flagged: 0,
    cancelled: false,
  }
  createJobProgress(jobId, CHECK_EXPLANATIONS_JOB, 2)

  try {
    setJobStep(jobId, 0, 'Loading explanations')
    const config = sanitizeDecisionModelConfig({ ...(await getDecisionModelConfig()), enabled: true })
    const endpoint = await resolveDecisionEndpoint(config)
    if (!endpoint.ok) {
      addLog(jobId, 'error', `❌ The decision model cannot be called: ${endpoint.reason}`)
      failJob(jobId, endpoint.reason)
      return result
    }

    const items = await loadCandidateExplanations()
    result.explanations = items.length
    const done = await query<{ explanation_hash: string }>(
      `SELECT explanation_hash FROM explanation_checks WHERE requested_model = $1`,
      [config.model]
    )
    const already = new Set(done.rows.map((r) => r.explanation_hash))
    const todo = items.filter((i) => !already.has(i.hash))
    result.skipped = items.length - todo.length
    addLog(
      jobId,
      'info',
      `🔎 ${items.length} explanation(s) on the newest runs; ${result.skipped} already checked with ${config.model}, ${todo.length} to check`
    )
    if (todo.length === 0) {
      completeJob(jobId, { ...result })
      return result
    }

    const context = await loadContext(todo)
    setJobStep(jobId, 1, 'Checking explanations', todo.length)

    let next = 0
    let processed = 0
    let consecutiveFailures = 0
    let stopped: string | null = null

    const worker = async () => {
      for (;;) {
        if (stopped) return
        if (isJobCancelled(jobId)) {
          result.cancelled = true
          return
        }
        const item = todo[next++]
        if (!item) return
        const input = toInput(item, context)
        if (!input) {
          result.failed++
          processed++
          continue
        }
        const request = buildExplanationCheckRequest(input)
        try {
          const answer = await callSystemOne(
            endpoint.endpoint,
            { model: config.model, state: request.state, questions: request.questions },
            config.timeoutMs
          )
          const scores = readExplanationChecks(answer.answers, request.checks)
          if (!scores) throw new DecisionModelError('The answer was missing a check')
          await query(
            `INSERT INTO explanation_checks
               (explanation_hash, media_type, pick_id, heading, claims_context_as_reason,
                unsupported_link, invented_fact, spoiler, requested_model, answered_model, checked_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
             ON CONFLICT (explanation_hash) DO UPDATE SET
               media_type = EXCLUDED.media_type, pick_id = EXCLUDED.pick_id, heading = EXCLUDED.heading,
               claims_context_as_reason = EXCLUDED.claims_context_as_reason,
               unsupported_link = EXCLUDED.unsupported_link, invented_fact = EXCLUDED.invented_fact,
               spoiler = EXCLUDED.spoiler, requested_model = EXCLUDED.requested_model,
               answered_model = EXCLUDED.answered_model, checked_at = NOW()`,
            [
              item.hash,
              item.mediaType,
              item.pickId,
              item.heading,
              scores.claimsContextAsReason ?? null,
              scores.unsupportedLink ?? null,
              scores.inventedFact ?? null,
              scores.spoiler ?? null,
              config.model,
              answer.model,
            ]
          )
          result.checked++
          if (explanationFailures(scores).length > 0) result.flagged++
          consecutiveFailures = 0
        } catch (err) {
          result.failed++
          consecutiveFailures++
          const status = err instanceof DecisionModelError ? err.status : undefined
          const message = err instanceof Error ? err.message : String(err)
          logger.debug({ err, hash: item.hash }, 'Explanation check failed')
          if (isSystemicDecisionFailure(status)) stopped = message
          else if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
            stopped = `${consecutiveFailures} calls failed in a row (last: ${message})`
          }
        }
        processed++
        updateJobProgress(jobId, processed, todo.length)
      }
    }
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(config.concurrency, todo.length)) }, worker)
    )

    if (stopped) addLog(jobId, 'warn', `⚠️ Stopped early: ${stopped}`)
    addLog(
      jobId,
      'info',
      `✅ Checked ${result.checked} explanation(s): ${result.flagged} flagged by at least one check, ${result.failed} not checked`
    )
    // A cancelled job has its row written by cancelJob; completing over it
    // would turn a cancelled run into a completed one.
    if (!result.cancelled) completeJob(jobId, { ...result })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err }, 'Explanation check job failed')
    failJob(jobId, message)
    return result
  }
}

// ============================================================================
// Read back: the queue the operator labels, and the summary beside it
// ============================================================================

export type ExplanationFilter = 'toLabel' | 'flagged' | 'passed' | 'labelled'
export const EXPLANATION_FILTERS: readonly ExplanationFilter[] = ['toLabel', 'flagged', 'passed', 'labelled']

export function isExplanationFilter(value: unknown): value is ExplanationFilter {
  return typeof value === 'string' && (EXPLANATION_FILTERS as readonly string[]).includes(value)
}

export interface ExplanationItem {
  hash: string
  mediaType: MediaType
  pickId: string
  pickTitle: string
  pickYear: number | null
  explanation: string
  heading: ExplanationHeading | null
  origin: PickOrigin | null
  watchedTitles: string[]
  /** Null when not checked yet. */
  scores: ExplanationCheckScores | null
  failures: ExplanationCheckId[]
  flagged: boolean | null
  label: ExplanationLabel | null
  /** False for a labelled explanation no longer on the newest runs. */
  current: boolean
}

export interface ExplanationQueue {
  explanations: number
  checked: number
  flagged: number
  /** Per check: how many explanations it was asked of, and how many it failed. */
  perCheck: Record<ExplanationCheckId, { asked: number; failed: number }>
  counts: Record<ExplanationFilter, number>
  agreement: ExplanationAgreement
  total: number
  items: ExplanationItem[]
}

interface CheckRow {
  explanation_hash: string
  heading: string
  claims_context_as_reason: number | null
  unsupported_link: number | null
  invented_fact: number | null
  spoiler: number | null
}

function scoresOf(row: CheckRow): ExplanationCheckScores {
  const scores: ExplanationCheckScores = {}
  if (row.claims_context_as_reason != null) scores.claimsContextAsReason = row.claims_context_as_reason
  if (row.unsupported_link != null) scores.unsupportedLink = row.unsupported_link
  if (row.invented_fact != null) scores.inventedFact = row.invented_fact
  if (row.spoiler != null) scores.spoiler = row.spoiler
  return scores
}

export async function getExplanationQueue(
  options: { filter?: ExplanationFilter; offset?: number; limit?: number } = {}
): Promise<ExplanationQueue> {
  const filter = options.filter ?? 'toLabel'
  const offset = Math.max(0, options.offset ?? 0)
  const limit = Math.min(50, Math.max(0, options.limit ?? 10))

  const config = await getDecisionModelConfig()
  const [candidates, checks, labels] = await Promise.all([
    loadCandidateExplanations(),
    query<CheckRow>(
      `SELECT explanation_hash, heading, claims_context_as_reason, unsupported_link, invented_fact, spoiler
       FROM explanation_checks WHERE requested_model = $1`,
      [config.model]
    ),
    query<{
      explanation_hash: string
      media_type: string
      pick_id: string
      explanation: string
      label: string
      labelled_at: Date
    }>(`SELECT explanation_hash, media_type, pick_id, explanation, label, labelled_at FROM explanation_labels`),
  ])
  const checkByHash = new Map(checks.rows.map((r) => [r.explanation_hash, r]))
  const labelByHash = new Map(labels.rows.map((r) => [r.explanation_hash, r]))

  // Labelled explanations that have left the newest runs stay reviewable.
  const currentHashes = new Set(candidates.map((c) => c.hash))
  const orphans = labels.rows.filter(
    (l) => !currentHashes.has(l.explanation_hash) && (l.media_type === 'movie' || l.media_type === 'series')
  )

  const context = await loadContext([
    ...candidates,
    ...orphans.map(
      (l): CandidateExplanation => ({
        hash: l.explanation_hash,
        mediaType: l.media_type as MediaType,
        pickId: l.pick_id,
        explanation: l.explanation,
        heading: 'contextOnly',
        origin: 'ranked',
        interestText: null,
        ratingScore: null,
        watchedIds: [],
      })
    ),
  ])

  const items: ExplanationItem[] = []
  const add = (base: {
    hash: string
    mediaType: MediaType
    pickId: string
    explanation: string
    heading: ExplanationHeading | null
    origin: PickOrigin | null
    watchedIds: string[]
    current: boolean
  }) => {
    const pick = context.facts.get(`${base.mediaType}:${base.pickId}`)
    const check = checkByHash.get(base.hash)
    const scores = check ? scoresOf(check) : null
    const failures = scores ? explanationFailures(scores) : []
    const labelRow = labelByHash.get(base.hash)
    items.push({
      hash: base.hash,
      mediaType: base.mediaType,
      pickId: base.pickId,
      pickTitle: pick?.title ?? '—',
      pickYear: pick?.year ?? null,
      explanation: base.explanation,
      heading: base.heading ?? (check?.heading === 'reason' ? 'reason' : check ? 'contextOnly' : null),
      origin: base.origin,
      watchedTitles: base.watchedIds
        .map((id) => context.facts.get(`${base.mediaType}:${id}`)?.title)
        .filter((t): t is string => !!t),
      scores,
      failures,
      flagged: scores ? failures.length > 0 : null,
      label: labelRow && isExplanationLabel(labelRow.label) ? labelRow.label : null,
      current: base.current,
    })
  }
  for (const c of candidates) add({ ...c, current: true })
  for (const l of orphans) {
    add({
      hash: l.explanation_hash,
      mediaType: l.media_type as MediaType,
      pickId: l.pick_id,
      explanation: l.explanation,
      heading: null,
      origin: null,
      watchedIds: [],
      current: false,
    })
  }

  const perCheck = Object.fromEntries(
    EXPLANATION_CHECKS.map((id) => [id, { asked: 0, failed: 0 }])
  ) as ExplanationQueue['perCheck']
  const counts: ExplanationQueue['counts'] = { toLabel: 0, flagged: 0, passed: 0, labelled: 0 }
  let checked = 0
  for (const item of items) {
    if (item.current && !item.label) counts.toLabel++
    if (item.label) counts.labelled++
    if (item.flagged === true) counts.flagged++
    if (item.flagged === false) counts.passed++
    if (!item.scores || !item.current) continue
    checked++
    for (const id of EXPLANATION_CHECKS) {
      const p = item.scores[id]
      if (p == null) continue
      perCheck[id].asked++
      if (item.failures.includes(id)) perCheck[id].failed++
    }
  }

  const selected = items.filter((item) => {
    switch (filter) {
      case 'toLabel':
        return item.current && !item.label
      case 'flagged':
        return item.flagged === true
      case 'passed':
        return item.flagged === false
      case 'labelled':
        return item.label != null
    }
  })
  if (filter === 'labelled') {
    const at = (hash: string) => new Date(labelByHash.get(hash)?.labelled_at ?? 0).getTime()
    selected.sort((a, b) => at(b.hash) - at(a.hash))
  } else {
    // Blind order, as for the evidence pairs: nothing about a check or a label
    // decides where an explanation appears.
    selected.sort((a, b) => labellingOrder(a.hash) - labellingOrder(b.hash))
  }

  return {
    explanations: candidates.length,
    checked,
    flagged: items.filter((i) => i.current && i.flagged === true).length,
    perCheck,
    counts,
    agreement: tallyExplanationAgreement(items),
    total: selected.length,
    items: selected.slice(offset, offset + limit),
  }
}

export class ExplanationNotFoundError extends Error {}

/**
 * Record, change or (with null) remove a label. The text is read from the
 * newest runs by its hash rather than taken from the request, so a label is
 * always on words the app actually wrote; a label on an explanation that has
 * since left the runs can still be changed or removed.
 */
export async function setExplanationLabel(input: {
  hash: string
  label: ExplanationLabel | null
  userId: string | null
}): Promise<void> {
  if (input.label === null) {
    await query(`DELETE FROM explanation_labels WHERE explanation_hash = $1`, [input.hash])
    return
  }
  const current = (await loadCandidateExplanations()).find((c) => c.hash === input.hash)
  if (current) {
    await query(
      `INSERT INTO explanation_labels (explanation_hash, media_type, pick_id, explanation, label, labelled_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (explanation_hash)
       DO UPDATE SET label = EXCLUDED.label, labelled_by = EXCLUDED.labelled_by, labelled_at = NOW()`,
      [current.hash, current.mediaType, current.pickId, current.explanation, input.label, input.userId]
    )
    return
  }
  const updated = await query(
    `UPDATE explanation_labels SET label = $2, labelled_by = $3, labelled_at = NOW()
     WHERE explanation_hash = $1`,
    [input.hash, input.label, input.userId]
  )
  if ((updated.rowCount ?? 0) === 0) throw new ExplanationNotFoundError('No such explanation')
}
