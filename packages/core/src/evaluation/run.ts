/**
 * Running an evaluation, and printing the neighbour dump beside it.
 *
 * Scope is deliberately RETRIEVAL ONLY: build a centroid from the training half
 * of a viewer's history, rank the whole library by cosine, see where the
 * held-out titles landed. No novelty, no rating blend, no preference nudge, no
 * diversity selection.
 *
 * That is not a shortcut, it is the question. Every open argument — whether
 * mean-centring helps, what the canonical text should contain, whether the
 * embedding is partly a nationality detector — is about retrieval. Running the
 * full pipeline would need it to be side-effect free and injectable, which it
 * is not, and would fold four more moving parts into a measurement of one.
 *
 * Read the header of `metrics.ts` before believing any number this prints.
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import {
  loadLibraryMatrix,
  meanCenter,
  scoreAll,
  weightedCentroid,
  type EmbeddingSetRef,
  type LibraryMatrix,
} from './embeddingMatrix.js'
import {
  DEFAULT_RELEVANCE_WEIGHTS,
  MIN_TEST_ITEMS,
  qualifies,
  splitHoldout,
  type RelevanceWeights,
  type WatchRecord,
} from './holdout.js'
import {
  DEFAULT_CUTOFFS,
  historyBucket,
  macroAverage,
  scoreUser,
  type AggregateMetrics,
  type UserMetrics,
} from './metrics.js'
import {
  buildNeighbourReports,
  countryConcentration,
  formatNeighbourReport,
  popularSeedIds,
  resolveSeedIds,
} from './neighbours.js'

const logger = createChildLogger('evaluation')

export const DEFAULT_HOLDOUT_SIZE = 20
export const DEFAULT_NEIGHBOUR_TOP_N = 10

/** Seeds dumped when the operator names none. */
export const DEFAULT_SEED_COUNT = 8

/**
 * Which ranking is being measured.
 *
 * `rating` and `random` are not filler. A metric with no baseline is
 * uninterpretable, and rating-only — sort the library by community score and
 * ignore the viewer entirely — is the one that matters: recommenders fail to
 * beat it more often than anyone admits, and if this one does not, that is the
 * most useful thing the harness could possibly report.
 */
export type EvaluationVariant = 'raw' | 'centered' | 'rating' | 'random'

export const DEFAULT_VARIANTS: EvaluationVariant[] = ['random', 'rating', 'raw', 'centered']

export interface EvaluationOptions {
  mediaType?: 'movie' | 'series'
  holdoutSize?: number
  minTestItems?: number
  variants?: EvaluationVariant[]
  weights?: RelevanceWeights
  /**
   * Which stored embedding set to measure. Defaults to the active one.
   *
   * This is how one library answers for two models. The splits below are
   * rebuilt per call but `splitHoldout` is deterministic -- the N most recent
   * engaged titles per viewer, never a sample -- so two runs over two sets are
   * scored against an identical answer key without having to hold one in
   * memory across both.
   *
   * What it does NOT control is the pool. `loadLibraryMatrix` applies no
   * library filter precisely so the ranked population is stable, but a set the
   * embedding job never finished is genuinely a smaller pool, and both
   * `medianPercentile` and ndcg at a deep cutoff read better on one. Compare
   * `poolSize` across runs before believing a difference.
   */
  set?: EmbeddingSetRef
  /** Titles to dump neighbours for, raw and mean-centred, side by side. */
  seedTitles?: string[]
  neighbourTopN?: number
  /** Every line also goes to the job log, which is where this is read. */
  onLog?: (line: string) => void
  shouldCancel?: () => boolean
}

export interface VariantResult {
  variant: EvaluationVariant
  aggregate: AggregateMetrics
  perUser: UserMetrics[]
  byBucket: Record<string, AggregateMetrics>
}

export interface EvaluationReport {
  mediaType: 'movie' | 'series'
  /** The set that was measured, `provider:model`. */
  modelId: string
  dimensions: number
  poolSize: number
  holdoutSize: number
  qualifiedUsers: number
  skippedUsers: number
  variants: VariantResult[]
}

interface UserSplit {
  userId: string
  username: string
  train: Array<{ itemId: string; weight: number }>
  trainIds: Set<string>
  test: Array<{ itemId: string; relevance: number }>
  bucket: string
}

/**
 * How much a training title counts toward the centroid.
 *
 * An approximation of `calculateEngagementWeight`, not a copy of it: the
 * production version reads episode counts, completion rates and a recency
 * half-life out of tables this module does not load. Held constant across every
 * variant, which is what matters — the comparison is between rankings, and a
 * weighting applied identically to both cannot decide it.
 */
function trainWeight(record: WatchRecord): number {
  let weight = 1
  if (record.isFavorite) weight *= 1.5
  if (record.playCount > 1) weight *= 1 + Math.log10(record.playCount)
  return weight
}

async function fetchHistory(
  mediaType: 'movie' | 'series',
  userId: string
): Promise<WatchRecord[]> {
  const rows =
    mediaType === 'movie'
      ? await query<{
          item_id: string
          last_played_at: Date | null
          play_count: number
          is_favorite: boolean
          played: boolean
          progress: string | null
        }>(
          `SELECT wh.movie_id AS item_id, wh.last_played_at, wh.play_count, wh.is_favorite, wh.played,
                  CASE WHEN wh.runtime_ticks > 0
                       THEN wh.playback_position_ticks::numeric / wh.runtime_ticks::numeric
                       ELSE NULL END AS progress
             FROM watch_history wh
            WHERE wh.user_id = $1 AND wh.movie_id IS NOT NULL`,
          [userId]
        )
      : await query<{
          item_id: string
          last_played_at: Date | null
          play_count: number
          is_favorite: boolean
          played: boolean
          progress: string | null
        }>(
          // One row per series, summarised from its episodes: progress is the
          // fraction of episodes finished, which is the series equivalent of
          // "did they sit through it" and the strongest signal in the schema.
          `SELECT e.series_id AS item_id,
                  MAX(wh.last_played_at) AS last_played_at,
                  MAX(wh.play_count) AS play_count,
                  BOOL_OR(wh.is_favorite) AS is_favorite,
                  BOOL_OR(wh.played) AS played,
                  COUNT(*) FILTER (WHERE wh.played)::numeric
                    / NULLIF(MAX(s.total_episodes), 0)::numeric AS progress
             FROM watch_history wh
             JOIN episodes e ON e.id = wh.episode_id
             JOIN series s ON s.id = e.series_id
            WHERE wh.user_id = $1 AND wh.episode_id IS NOT NULL
            GROUP BY e.series_id`,
          [userId]
        )

  return rows.rows.map((row) => ({
    itemId: row.item_id,
    lastPlayedAt: row.last_played_at,
    playCount: Number(row.play_count) || 0,
    isFavorite: Boolean(row.is_favorite),
    played: Boolean(row.played),
    // NUMERIC arrives as a string; Number(null) is 0, which would read as
    // "bailed out immediately" rather than "nothing recorded".
    progress: row.progress == null ? null : Number(row.progress),
  }))
}

/** Item scores that do not depend on the viewer: the two baselines. */
async function buildStaticScores(
  mediaType: 'movie' | 'series',
  matrix: LibraryMatrix
): Promise<{ rating: Float64Array; random: Float64Array }> {
  const table = mediaType === 'movie' ? 'movies' : 'series'
  const result = await query<{ id: string; community_rating: string | null }>(
    `SELECT id, community_rating FROM ${table} WHERE id = ANY($1)`,
    [matrix.ids]
  )

  const ratingById = new Map<string, number>()
  for (const row of result.rows) {
    if (row.community_rating != null) ratingById.set(row.id, Number(row.community_rating))
  }

  const rating = new Float64Array(matrix.ids.length)
  const random = new Float64Array(matrix.ids.length)
  for (let i = 0; i < matrix.ids.length; i++) {
    rating[i] = ratingById.get(matrix.ids[i]) ?? 0
    // Deterministic from the row index, so two runs of the same library give
    // the same baseline and a difference between them means something.
    random[i] = ((i * 2654435761) % 1000003) / 1000003
  }

  return { rating, random }
}

/** Positions of every id, best first, with the training half removed. */
function rankItems(
  matrix: LibraryMatrix,
  scores: Float64Array,
  excluded: Set<string>
): { ranks: Map<string, number>; poolSize: number } {
  const order: number[] = []
  for (let i = 0; i < matrix.ids.length; i++) {
    if (!excluded.has(matrix.ids[i])) order.push(i)
  }
  order.sort((a, b) => scores[b] - scores[a])

  const ranks = new Map<string, number>()
  for (let position = 0; position < order.length; position++) {
    ranks.set(matrix.ids[order[position]], position + 1)
  }

  return { ranks, poolSize: order.length }
}

function bucketAggregates(perUser: UserMetrics[], buckets: Map<string, string>) {
  const grouped = new Map<string, UserMetrics[]>()
  for (const metrics of perUser) {
    const bucket = buckets.get(metrics.userId) ?? 'unknown'
    const list = grouped.get(bucket) ?? []
    list.push(metrics)
    grouped.set(bucket, list)
  }

  const out: Record<string, AggregateMetrics> = {}
  for (const [bucket, list] of grouped) out[bucket] = macroAverage(list)
  return out
}

export async function runEvaluation(options: EvaluationOptions = {}): Promise<EvaluationReport | null> {
  const mediaType = options.mediaType ?? 'movie'
  const holdoutSize = options.holdoutSize ?? DEFAULT_HOLDOUT_SIZE
  const minTestItems = options.minTestItems ?? MIN_TEST_ITEMS
  const variants = options.variants ?? DEFAULT_VARIANTS
  const weights = options.weights ?? DEFAULT_RELEVANCE_WEIGHTS
  const log = (line: string) => {
    logger.info(line)
    options.onLog?.(line)
  }

  const raw = await loadLibraryMatrix(mediaType, options.set)
  if (!raw) {
    log('No embeddings loaded — nothing to evaluate.')
    return null
  }

  const centered = variants.includes('centered') ? meanCenter(raw) : null

  const users = await query<{ id: string; username: string }>(
    `SELECT DISTINCT u.id, u.username
       FROM users u
       JOIN watch_history wh ON wh.user_id = u.id
      ORDER BY u.username`
  )

  const splits: UserSplit[] = []
  let skipped = 0

  for (const user of users.rows) {
    if (options.shouldCancel?.()) break

    const history = await fetchHistory(mediaType, user.id)
    const split = splitHoldout(history, holdoutSize, weights)

    if (!qualifies(split, minTestItems)) {
      skipped++
      continue
    }

    splits.push({
      userId: user.id,
      username: user.username,
      train: split.train.map((record) => ({ itemId: record.itemId, weight: trainWeight(record) })),
      trainIds: new Set(split.train.map((record) => record.itemId)),
      test: split.test,
      bucket: historyBucket(split.train.length),
    })
  }

  // The qualification counts go first, not in a footnote: if half the viewers
  // could not be evaluated, that is the most important line in the report.
  log('')
  log(`Evaluation — ${mediaType}`)
  log(`  set              ${raw.modelId}`)
  log(`  library          ${raw.ids.length} embedded titles, ${raw.dims} dimensions`)
  log(`  holdout          ${holdoutSize} most recent engaged titles per viewer`)
  log(`  qualified        ${splits.length} of ${users.rows.length} viewers (>= ${minTestItems} answers)`)
  log(`  not evaluated    ${skipped}`)

  if (splits.length === 0) {
    log('  nothing to measure.')
    return null
  }

  const buckets = new Map(splits.map((split) => [split.userId, split.bucket]))
  const statics = await buildStaticScores(mediaType, raw)
  const scratch = new Float64Array(raw.ids.length)
  const results: VariantResult[] = []

  for (const variant of variants) {
    if (options.shouldCancel?.()) break

    const perUser: UserMetrics[] = []

    for (const split of splits) {
      let scores: Float64Array

      if (variant === 'rating' || variant === 'random') {
        scores = variant === 'rating' ? statics.rating : statics.random
      } else {
        const matrix = variant === 'centered' ? centered : raw
        if (!matrix) continue
        const centroid = weightedCentroid(matrix, split.train)
        if (!centroid) continue
        scoreAll(matrix, centroid, scratch)
        scores = scratch
      }

      const { ranks, poolSize } = rankItems(raw, scores, split.trainIds)
      perUser.push(scoreUser(split.userId, split.test, ranks, poolSize))
    }

    results.push({
      variant,
      aggregate: macroAverage(perUser),
      perUser,
      byBucket: bucketAggregates(perUser, buckets),
    })
  }

  logReport(results, splits, log)
  await logNeighbours(mediaType, raw, centered, options, log)

  return {
    mediaType,
    modelId: raw.modelId,
    dimensions: raw.dims,
    poolSize: raw.ids.length,
    holdoutSize,
    qualifiedUsers: splits.length,
    skippedUsers: skipped,
    variants: results,
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function logReport(
  results: VariantResult[],
  splits: UserSplit[],
  log: (line: string) => void
): void {
  const cutoffs = DEFAULT_CUTOFFS
  const header =
    `  ${'variant'.padEnd(10)} ${'med pct'.padStart(8)} ` +
    cutoffs.map((k) => `ndcg@${k}`.padStart(9)).join(' ') +
    ' ' +
    cutoffs.map((k) => `rec@${k}`.padStart(8)).join(' ')

  log('')
  log('Macro-averaged across viewers, one vote each:')
  log(header)
  for (const result of results) {
    log(
      `  ${result.variant.padEnd(10)} ${pct(result.aggregate.medianPercentile).padStart(8)} ` +
        cutoffs.map((k) => pct(result.aggregate.ndcg[k]).padStart(9)).join(' ') +
        ' ' +
        cutoffs.map((k) => pct(result.aggregate.recall[k]).padStart(8)).join(' ')
    )
  }

  // A change can help thin profiles and hurt thick ones, and the aggregate --
  // dominated by whoever has more history -- would read that as a loss.
  log('')
  log('By history size:')
  for (const result of results) {
    for (const [bucket, aggregate] of Object.entries(result.byBucket)) {
      log(
        `  ${result.variant.padEnd(10)} ${bucket.padEnd(9)} n=${String(aggregate.users).padStart(3)} ` +
          `med ${pct(aggregate.medianPercentile).padStart(7)}  ndcg@100 ${pct(aggregate.ndcg[100]).padStart(7)}`
      )
    }
  }

  // Per-viewer rows always, never only the mean. This instance has twice been
  // misled by an average that described nobody.
  log('')
  log('Per viewer (median percentile):')
  const names = new Map(splits.map((split) => [split.userId, split.username]))
  const first = results[0]
  if (!first) return

  for (const metrics of first.perUser) {
    const row = results
      .map((result) => {
        const found = result.perUser.find((m) => m.userId === metrics.userId)
        return `${result.variant} ${pct(found?.medianPercentile ?? 0).padStart(7)}`
      })
      .join('   ')
    log(`  ${(names.get(metrics.userId) ?? metrics.userId).padEnd(16)} n=${String(metrics.testItems).padStart(3)}   ${row}`)
  }
}

async function logNeighbours(
  mediaType: 'movie' | 'series',
  raw: LibraryMatrix,
  centered: LibraryMatrix | null,
  options: EvaluationOptions,
  log: (line: string) => void
): Promise<void> {
  const topN = options.neighbourTopN ?? DEFAULT_NEIGHBOUR_TOP_N

  let seedIds: string[]
  if (options.seedTitles?.length) {
    const resolved = await resolveSeedIds(mediaType, options.seedTitles)
    const missing = resolved.filter((entry) => !entry.id).map((entry) => entry.input)
    if (missing.length > 0) log(`  seeds not found: ${missing.join(', ')}`)
    seedIds = resolved.map((entry) => entry.id).filter((id): id is string => Boolean(id))
  } else {
    // Whatever the most people here have actually finished, so the reader knows
    // the films well enough for the dump to be worth reading.
    seedIds = await popularSeedIds(mediaType, DEFAULT_SEED_COUNT)
  }

  // A seed can name a real film that this SET has no vector for, which is
  // invisible otherwise -- and it is exactly the case that matters when two
  // sets are being compared, since a seed present in one dump and absent from
  // the other reads as the models disagreeing rather than as missing data.
  const unembedded = seedIds.filter((id) => !raw.index.has(id))
  if (unembedded.length > 0) {
    log(`  seeds with no embedding in this set: ${unembedded.length}`)
  }

  seedIds = seedIds.filter((id) => raw.index.has(id))
  if (seedIds.length === 0) {
    // Returning quietly here would delete the primary instrument from the
    // report and look like it simply had nothing to say.
    log('')
    log('Nearest neighbours — skipped: none of the requested seeds resolved to an embedded title.')
    return
  }

  log('')
  log('Nearest neighbours — the instrument to actually judge this on.')
  log('Country is shown because six of the fifteen canonical-text fields are')
  log('nationality-coded proper nouns; if it dominates, it shows up as a column.')

  const rawReports = await buildNeighbourReports(mediaType, raw, seedIds, topN)
  const centeredReports = centered
    ? await buildNeighbourReports(mediaType, centered, seedIds, topN)
    : []

  for (let i = 0; i < rawReports.length; i++) {
    log('')
    for (const line of formatNeighbourReport(rawReports[i], 'raw')) log(line)

    const rawShare = countryConcentration(rawReports[i])
    if (rawShare != null) log(`     same-country share: ${pct(rawShare)}`)

    const centeredReport = centeredReports[i]
    if (centeredReport) {
      log('')
      for (const line of formatNeighbourReport(centeredReport, 'mean-centred')) log(line)
      const share = countryConcentration(centeredReport)
      if (share != null) log(`     same-country share: ${pct(share)}`)
    }
  }
}
