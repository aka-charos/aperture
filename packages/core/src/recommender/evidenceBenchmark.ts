/**
 * Run the labelled pairs (./evidenceBenchmarkPairs.ts) through a decision
 * model, the cosine bar AND the free credits rule (same director or same
 * franchise), on this library, and score all three against the labels.
 *
 * The rule is there because the first benchmark showed most labelled reasons
 * share a director or a franchise — fields the model is handed — so beating
 * the cosine bar alone did not show the model was worth more than reading two
 * columns. The no-shared-credits subtotal is where that question is answered.
 *
 * The point is a like-for-like answer to "is the model better than the
 * threshold?" without switching anything on: it reads the library, writes
 * nothing, and changes no one's recommendations.
 *
 * SAME REQUEST AS A RUN. Titles are described by loadJudgedTitleFacts and the
 * question is built by buildEvidenceJudgmentRequest — the functions a run uses
 * — so the benchmark measures the request that would actually be sent. The
 * cosine is the raw one storeEvidence computes, on the active embedding set,
 * and the threshold's call is hasCausalEvidence's.
 *
 * BOUNDED BY A DEADLINE, not by the work. It answers within one request, and a
 * request held open for minutes is cut by whichever proxy in front of the API
 * is least patient (F-141). Pairs not asked in time are reported as not run,
 * never silently dropped, and the score only counts pairs both sides answered.
 */
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../lib/ai-provider.js'
import { callSystemOne, resolveDecisionEndpoint, DecisionModelError } from '../lib/decisionModel.js'
import {
  isSystemicDecisionFailure,
  sanitizeDecisionModelConfig,
  type DecisionModelConfig,
} from '../lib/decisionModelRules.js'
import { buildEvidenceJudgmentRequest, readEvidenceJudgments } from './evidenceJudgment.js'
import {
  BENCHMARK_PAIRS,
  BENCHMARK_RUNS_PER_PAIR,
  creditsRuleVerdict,
  modelVerdict,
  scoreBenchmark,
  thresholdVerdict,
  type BenchmarkPairResult,
  type BenchmarkScore,
  type BenchmarkTitle,
} from './evidenceBenchmarkPairs.js'
import { EVIDENCE_CAUSAL_MIN_COSINE } from './evidenceStrength.js'
import { loadJudgedTitleFacts } from './judgeEvidence.js'

const logger = createChildLogger('evidence-benchmark')

/** Well under the 60s an nginx in front of the API allows by default. */
const BENCHMARK_DEADLINE_MS = 45_000
/** A call with less time than this left is not started. */
const MIN_CALL_MS = 1_500
const CONSECUTIVE_FAILURE_LIMIT = 3

export type EvidenceBenchmarkResult =
  | {
      success: true
      /** The model asked for, and the one the endpoint reported answering. */
      model: string
      answeredModel: string | null
      /** The cosine bar the threshold column used. */
      threshold: number
      /** The embedding set the similarities come from. */
      embeddingSet: string | null
      durationMs: number
      /** Why asking stopped early, when it did. */
      stoppedReason: string | null
      score: BenchmarkScore
      pairs: BenchmarkPairResult[]
    }
  | { success: false; error: string }

interface ResolvedTitle {
  id: string
  title: string
  year: number | null
}

/**
 * Every candidate title, resolved in one query. Matched through
 * aperture_search_key — the fold library search uses — so accents, dashes and
 * an asterisk in "Thunderbolts*" do not stop a film matching itself, and a
 * year within one either way, since release and production years disagree.
 */
async function resolveTitles(candidates: BenchmarkTitle[]): Promise<Map<string, ResolvedTitle>> {
  const key = (c: BenchmarkTitle) => `${c.title}\u0000${c.year}`
  const unique = [...new Map(candidates.map((c) => [key(c), c])).values()]
  const result = await query<{ i: string; id: string; title: string; year: number | null }>(
    `SELECT c.i::text AS i, m.id, m.title, m.year
     FROM unnest($1::text[], $2::int[]) WITH ORDINALITY AS c(title, year, i)
     CROSS JOIN LATERAL (
       SELECT id, title, year FROM movies
       WHERE (title_search_key = aperture_search_key(c.title)
              OR original_title_search_key = aperture_search_key(c.title))
         AND year BETWEEN c.year - 1 AND c.year + 1
       ORDER BY abs(year - c.year), id
       LIMIT 1
     ) m`,
    [unique.map((c) => c.title), unique.map((c) => c.year)]
  )
  const out = new Map<string, ResolvedTitle>()
  for (const row of result.rows) {
    const candidate = unique[Number(row.i) - 1]
    if (candidate) out.set(key(candidate), { id: row.id, title: row.title, year: row.year })
  }
  return out
}

function firstResolved(
  candidates: BenchmarkTitle[],
  resolved: Map<string, ResolvedTitle>
): ResolvedTitle | null {
  for (const c of candidates) {
    const hit = resolved.get(`${c.title}\u0000${c.year}`)
    if (hit) return hit
  }
  return null
}

async function loadSimilarities(
  pairs: Array<{ pickId: string; watchedId: string }>
): Promise<{ similarities: Array<number | null>; embeddingSet: string | null }> {
  const embeddingSet = await getActiveEmbeddingModelId()
  const similarities: Array<number | null> = pairs.map(() => null)
  if (!embeddingSet || pairs.length === 0) return { similarities, embeddingSet }

  const table = await getActiveEmbeddingTableName('embeddings')
  const result = await query<{ i: string; similarity: number | string }>(
    `SELECT p.i::text AS i, 1 - (a.embedding <=> b.embedding) AS similarity
     FROM unnest($1::uuid[], $2::uuid[]) WITH ORDINALITY AS p(pick, watched, i)
     JOIN ${table} a ON a.movie_id = p.pick AND a.model = $3
     JOIN ${table} b ON b.movie_id = p.watched AND b.model = $3`,
    [pairs.map((p) => p.pickId), pairs.map((p) => p.watchedId), embeddingSet]
  )
  for (const row of result.rows) {
    const value = typeof row.similarity === 'number' ? row.similarity : Number.parseFloat(row.similarity)
    if (Number.isFinite(value)) similarities[Number(row.i) - 1] = value
  }
  return { similarities, embeddingSet }
}

export async function runEvidenceBenchmark(
  input: Partial<DecisionModelConfig>
): Promise<EvidenceBenchmarkResult> {
  const startedAt = Date.now()
  const deadline = startedAt + BENCHMARK_DEADLINE_MS
  // Enabled is irrelevant: the benchmark exists to be run before switching on.
  const config = sanitizeDecisionModelConfig({ ...input, enabled: true })
  const endpoint = await resolveDecisionEndpoint(config)
  if (!endpoint.ok) return { success: false, error: endpoint.reason }

  try {
    const resolved = await resolveTitles(BENCHMARK_PAIRS.flatMap((p) => [...p.pick, ...p.watched]))

    const results: BenchmarkPairResult[] = []
    const inLibrary: Array<{ index: number; pickId: string; watchedId: string }> = []
    for (const pair of BENCHMARK_PAIRS) {
      const pick = firstResolved(pair.pick, resolved)
      const watched = firstResolved(pair.watched, resolved)
      const missing: Array<'pick' | 'watched'> = []
      if (!pick) missing.push('pick')
      if (!watched) missing.push('watched')
      results.push({
        id: pair.id,
        label: pair.label,
        reason: pair.reason,
        pickTitle: pick?.title ?? pair.pick[0].title,
        watchedTitle: watched?.title ?? pair.watched[0].title,
        status: missing.length > 0 ? 'notInLibrary' : 'notRun',
        missing,
        similarity: null,
        thresholdSays: null,
        modelRuns: [],
        modelSays: null,
        unstable: false,
        ruleSays: null,
        ruleBasis: null,
      })
      if (pick && watched) {
        inLibrary.push({ index: results.length - 1, pickId: pick.id, watchedId: watched.id })
      }
    }

    const { similarities, embeddingSet } = await loadSimilarities(inLibrary)
    inLibrary.forEach((p, i) => {
      results[p.index].similarity = similarities[i]
      results[p.index].thresholdSays = thresholdVerdict(similarities[i])
    })

    const facts = await loadJudgedTitleFacts(
      'movie',
      [...new Set(inLibrary.flatMap((p) => [p.pickId, p.watchedId]))]
    )

    // The free baseline, from the same facts the model is about to be shown.
    for (const p of inLibrary) {
      const pickFacts = facts.get(p.pickId)
      const watchedFacts = facts.get(p.watchedId)
      if (!pickFacts || !watchedFacts) continue
      const rule = creditsRuleVerdict(pickFacts, watchedFacts)
      results[p.index].ruleSays = rule.says
      results[p.index].ruleBasis = rule.basis
    }

    // Every (pair, run) is one task; the pool works through them in order, so
    // a deadline cuts the tail of the list rather than random pairs.
    const tasks = inLibrary.flatMap((p) =>
      Array.from({ length: BENCHMARK_RUNS_PER_PAIR }, () => p)
    )
    const errors = new Map<number, string>()
    let answeredModel: string | null = null
    let stoppedReason: string | null = null
    let consecutiveFailures = 0
    let next = 0

    const worker = async () => {
      for (;;) {
        if (stoppedReason) return
        const task = tasks[next++]
        if (!task) return
        const remaining = deadline - Date.now()
        if (remaining < MIN_CALL_MS) {
          stoppedReason = 'time limit reached'
          return
        }
        const pickFacts = facts.get(task.pickId)
        const watchedFacts = facts.get(task.watchedId)
        if (!pickFacts || !watchedFacts) continue

        const request = buildEvidenceJudgmentRequest(pickFacts, [watchedFacts], 'movie')
        try {
          const answer = await callSystemOne(
            endpoint.endpoint,
            { model: config.model, state: request.state, questions: request.questions },
            Math.min(config.timeoutMs, remaining),
            deadline
          )
          const verdicts = readEvidenceJudgments(answer.answers, request.keys)
          if (!verdicts) throw new DecisionModelError('The answer was missing a verdict')
          results[task.index].modelRuns.push(verdicts[0])
          answeredModel ??= answer.model
          consecutiveFailures = 0
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          errors.set(task.index, message)
          consecutiveFailures++
          const status = err instanceof DecisionModelError ? err.status : undefined
          if (isSystemicDecisionFailure(status)) stoppedReason = message
          else if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
            stoppedReason = `${consecutiveFailures} calls failed in a row (last: ${message})`
          }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(config.concurrency, tasks.length)) }, worker)
    )

    for (const p of inLibrary) {
      const r = results[p.index]
      const verdict = modelVerdict(r.modelRuns)
      r.modelSays = verdict.says
      r.unstable = verdict.unstable
      if (r.modelRuns.length > 0) r.status = 'scored'
      else if (errors.has(p.index)) {
        r.status = 'failed'
        r.error = errors.get(p.index)
      } else r.status = 'notRun'
    }

    const score = scoreBenchmark(results)
    logger.info(
      { model: config.model, embeddingSet, ...score, stoppedReason, durationMs: Date.now() - startedAt },
      `🧪 Evidence benchmark: threshold ${score.thresholdRight}/${score.scored}, credits rule ${score.ruleRight}/${score.scored}, model ${score.modelRight}/${score.scored}`
    )
    return {
      success: true,
      model: config.model,
      answeredModel,
      threshold: EVIDENCE_CAUSAL_MIN_COSINE,
      embeddingSet,
      durationMs: Date.now() - startedAt,
      stoppedReason,
      score,
      pairs: results,
    }
  } catch (err) {
    logger.warn({ err }, 'Evidence benchmark failed')
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
