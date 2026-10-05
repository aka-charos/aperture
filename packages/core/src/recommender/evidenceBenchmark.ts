/**
 * Run labelled pairs through a decision model, the cosine bar AND the free
 * credits rule (same director or same franchise), on this library, and score
 * all three against the labels.
 *
 * TWO SOURCES OF LABELS. The reference pairs (./evidenceBenchmarkPairs.ts) are
 * the cases quoted in the threshold's own derivations, resolved by title. The
 * operator's labels (./evidenceLabels.ts) are pairs from live runs, judged
 * blind on the card, resolved by id — movies and series alike. Both are scored
 * the same way, and reported together and per source.
 *
 * The rule is there because the first benchmark showed most reference reasons
 * share a director or a franchise — fields the model is handed — so beating
 * the cosine bar alone did not show the model was worth more than reading two
 * columns. The no-shared-credits subtotal is where that question is answered.
 *
 * It reads the library, writes nothing, and changes no one's recommendations.
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
 * never silently dropped, and the score only counts pairs every judge answered.
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
import {
  buildEvidenceJudgmentRequest,
  readEvidenceJudgments,
  type JudgedTitleFacts,
} from './evidenceJudgment.js'
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
import { listEvidenceLabels } from './evidenceLabels.js'

const logger = createChildLogger('evidence-benchmark')

/** Well under the 60s an nginx in front of the API allows by default. */
const BENCHMARK_DEADLINE_MS = 45_000
/** A call with less time than this left is not started. */
const MIN_CALL_MS = 1_500
const CONSECUTIVE_FAILURE_LIMIT = 3
/**
 * Your labels re-asked per run, newest first. With the reference pairs that is
 * about 300 calls, which measured at ~0.1s each fits the deadline with room.
 */
const LABELLED_PAIR_LIMIT = 120

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

type MediaType = 'movie' | 'series'

interface PairInLibrary {
  index: number
  mediaType: MediaType
  pickId: string
  watchedId: string
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
  mediaType: MediaType,
  pairs: Array<{ pickId: string; watchedId: string }>,
  embeddingSet: string | null
): Promise<Array<number | null>> {
  const similarities: Array<number | null> = pairs.map(() => null)
  if (!embeddingSet || pairs.length === 0) return similarities

  // Each media type has its own table under the same set id, exactly as
  // storeEvidence and storeSeriesEvidence read them.
  const table = await getActiveEmbeddingTableName(
    mediaType === 'movie' ? 'embeddings' : 'series_embeddings'
  )
  const column = mediaType === 'movie' ? 'movie_id' : 'series_id'
  const result = await query<{ i: string; similarity: number | string }>(
    `SELECT p.i::text AS i, 1 - (a.embedding <=> b.embedding) AS similarity
     FROM unnest($1::uuid[], $2::uuid[]) WITH ORDINALITY AS p(pick, watched, i)
     JOIN ${table} a ON a.${column} = p.pick AND a.model = $3
     JOIN ${table} b ON b.${column} = p.watched AND b.model = $3`,
    [pairs.map((p) => p.pickId), pairs.map((p) => p.watchedId), embeddingSet]
  )
  for (const row of result.rows) {
    const value =
      typeof row.similarity === 'number' ? row.similarity : Number.parseFloat(row.similarity)
    if (Number.isFinite(value)) similarities[Number(row.i) - 1] = value
  }
  return similarities
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
    const [resolved, labels, embeddingSet] = await Promise.all([
      resolveTitles(BENCHMARK_PAIRS.flatMap((p) => [...p.pick, ...p.watched])),
      listEvidenceLabels(LABELLED_PAIR_LIMIT),
      getActiveEmbeddingModelId(),
    ])

    const results: BenchmarkPairResult[] = []
    const inLibrary: PairInLibrary[] = []
    const freshResult = (): Pick<
      BenchmarkPairResult,
      'similarity' | 'thresholdSays' | 'modelRuns' | 'modelSays' | 'unstable' | 'ruleSays' | 'ruleBasis'
    > => ({
      similarity: null,
      thresholdSays: null,
      modelRuns: [],
      modelSays: null,
      unstable: false,
      ruleSays: null,
      ruleBasis: null,
    })

    // The reference pairs, resolved by title.
    const referenceKeys = new Set<string>()
    for (const pair of BENCHMARK_PAIRS) {
      const pick = firstResolved(pair.pick, resolved)
      const watched = firstResolved(pair.watched, resolved)
      const missing: Array<'pick' | 'watched'> = []
      if (!pick) missing.push('pick')
      if (!watched) missing.push('watched')
      results.push({
        ...freshResult(),
        id: pair.id,
        source: 'reference',
        mediaType: 'movie',
        label: pair.label,
        reason: pair.reason,
        pickTitle: pick?.title ?? pair.pick[0].title,
        watchedTitle: watched?.title ?? pair.watched[0].title,
        status: missing.length > 0 ? 'notInLibrary' : 'notRun',
        missing,
      })
      if (pick && watched) {
        inLibrary.push({ index: results.length - 1, mediaType: 'movie', pickId: pick.id, watchedId: watched.id })
        referenceKeys.add(`movie:${pick.id}:${watched.id}`)
      }
    }

    // Your labels, by id. A label on a pair the reference set already holds is
    // not asked twice; the reference row stands for it.
    const labelled = labels.filter(
      (l) => !referenceKeys.has(`${l.mediaType}:${l.pickId}:${l.watchedId}`)
    )

    const ids: Record<MediaType, Set<string>> = { movie: new Set(), series: new Set() }
    for (const p of inLibrary) {
      ids.movie.add(p.pickId)
      ids.movie.add(p.watchedId)
    }
    for (const l of labelled) {
      ids[l.mediaType].add(l.pickId)
      ids[l.mediaType].add(l.watchedId)
    }
    const [movieFacts, seriesFacts] = await Promise.all([
      loadJudgedTitleFacts('movie', [...ids.movie]),
      loadJudgedTitleFacts('series', [...ids.series]),
    ])
    const factsFor = (mediaType: MediaType, id: string): JudgedTitleFacts | undefined =>
      (mediaType === 'movie' ? movieFacts : seriesFacts).get(id)

    for (const l of labelled) {
      const pick = factsFor(l.mediaType, l.pickId)
      const watched = factsFor(l.mediaType, l.watchedId)
      const missing: Array<'pick' | 'watched'> = []
      if (!pick) missing.push('pick')
      if (!watched) missing.push('watched')
      results.push({
        ...freshResult(),
        id: `yours:${l.mediaType}:${l.pickId}:${l.watchedId}`,
        source: 'yours',
        mediaType: l.mediaType,
        label: l.label,
        reason: { kind: 'yourLabel' },
        pickTitle: pick?.title ?? '—',
        watchedTitle: watched?.title ?? '—',
        status: missing.length > 0 ? 'notInLibrary' : 'notRun',
        missing,
      })
      if (pick && watched) {
        inLibrary.push({
          index: results.length - 1,
          mediaType: l.mediaType,
          pickId: l.pickId,
          watchedId: l.watchedId,
        })
      }
    }

    // Cosines, per media type, as the panel's threshold reads them.
    for (const mediaType of ['movie', 'series'] as const) {
      const ofType = inLibrary.filter((p) => p.mediaType === mediaType)
      const similarities = await loadSimilarities(mediaType, ofType, embeddingSet)
      ofType.forEach((p, i) => {
        results[p.index].similarity = similarities[i]
        results[p.index].thresholdSays = thresholdVerdict(similarities[i])
      })
    }

    // The free baseline, from the same facts the model is about to be shown.
    for (const p of inLibrary) {
      const pickFacts = factsFor(p.mediaType, p.pickId)
      const watchedFacts = factsFor(p.mediaType, p.watchedId)
      if (!pickFacts || !watchedFacts) continue
      const rule = creditsRuleVerdict(pickFacts, watchedFacts)
      results[p.index].ruleSays = rule.says
      results[p.index].ruleBasis = rule.basis
    }

    // Every (pair, run) is one task, your labels first: if the deadline cuts
    // the tail, it cuts the reference pairs, whose answers are already known.
    const ordered = [
      ...inLibrary.filter((p) => results[p.index].source === 'yours'),
      ...inLibrary.filter((p) => results[p.index].source === 'reference'),
    ]
    const tasks = ordered.flatMap((p) => Array.from({ length: BENCHMARK_RUNS_PER_PAIR }, () => p))
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
        const pickFacts = factsFor(task.mediaType, task.pickId)
        const watchedFacts = factsFor(task.mediaType, task.watchedId)
        if (!pickFacts || !watchedFacts) continue

        const request = buildEvidenceJudgmentRequest(pickFacts, [watchedFacts], task.mediaType)
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
