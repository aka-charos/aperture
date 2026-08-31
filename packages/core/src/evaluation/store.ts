/**
 * Keeping an evaluation after the job log has forgotten it.
 *
 * WHY THIS EXISTS. The whole report is written through addLog, and the job log
 * is trimmed twice on the way out — the live buffer to 500 entries, the stored
 * copy to 300. A run with fourteen seeds emits roughly 450 entries per
 * embedding set, so the moment two sets are measured in one run (which is the
 * only sound way to compare them, since they then share one deterministic
 * answer key) the middle is dropped, and the middle is where the second set's
 * summary table lives. The comparison the run exists to produce is the part
 * that cannot survive.
 *
 * WHY NOT A FILE. A file inside the container answers that and then disappears
 * on the next recreate, which is exactly when someone deploys the change they
 * were measuring. Rows also make the thing an operator actually asked for —
 * several runs, several models, several seed lists, merged into one sheet — a
 * query instead of a concatenation.
 *
 * The rendering half lives in `csv.ts`, database-free so it can be pinned by a
 * test; read its header before touching the escaping.
 */

import { query, transaction } from '../lib/db.js'
import { toCsv, type CsvCell } from './csv.js'
import { DEFAULT_CUTOFFS } from './metrics.js'
import type { EvaluationReport } from './run.js'

/** One archived run, enough to choose between them in a list. */
export interface EvaluationRunSummary {
  id: string
  createdAt: Date
  mediaType: string
  model: string
  dimensions: number
  poolSize: number
  qualifiedUsers: number
  seedTitles: string[]
}

/** Multi-row INSERT in chunks, so a long seed list cannot exceed the parameter cap. */
async function insertRows(
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
  table: string,
  columns: string[],
  rows: unknown[][]
): Promise<void> {
  if (rows.length === 0) return

  // Postgres caps a statement at 65535 parameters; this stays far under it
  // without making the write chatty.
  const perStatement = Math.max(1, Math.floor(2000 / columns.length))

  for (let start = 0; start < rows.length; start += perStatement) {
    const chunk = rows.slice(start, start + perStatement)
    const values: unknown[] = []
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => {
        values.push(value)
        return `$${values.length}`
      })
      return `(${placeholders.join(', ')})`
    })

    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`,
      values
    )
  }
}

/** Store one measured set. Returns the run id. */
export async function saveEvaluationReport(
  report: EvaluationReport,
  options: { jobId?: string } = {}
): Promise<string> {
  return transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO evaluation_runs
         (job_id, media_type, model, dimensions, pool_size, holdout_size,
          qualified_users, skipped_users, seed_titles)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        options.jobId ?? null,
        report.mediaType,
        report.modelId,
        report.dimensions,
        report.poolSize,
        report.holdoutSize,
        report.qualifiedUsers,
        report.skippedUsers,
        report.seedTitles,
      ]
    )

    const runId = inserted.rows[0].id
    const [k20, k100, k500] = DEFAULT_CUTOFFS

    const metricRows: unknown[][] = []
    for (const result of report.variants) {
      const push = (
        scope: string,
        label: string,
        users: number,
        testItems: number,
        medianPercentile: number,
        ndcg: Record<number, number>,
        recall: Record<number, number>
      ) => {
        metricRows.push([
          runId,
          result.variant,
          scope,
          label,
          users,
          testItems,
          medianPercentile,
          ndcg[k20] ?? null,
          ndcg[k100] ?? null,
          ndcg[k500] ?? null,
          recall[k20] ?? null,
          recall[k100] ?? null,
          recall[k500] ?? null,
        ])
      }

      const overall = result.aggregate
      push(
        'overall',
        '',
        overall.users,
        overall.testItems,
        overall.medianPercentile,
        overall.ndcg,
        overall.recall
      )

      for (const [bucket, aggregate] of Object.entries(result.byBucket)) {
        push(
          'history_bucket',
          bucket,
          aggregate.users,
          aggregate.testItems,
          aggregate.medianPercentile,
          aggregate.ndcg,
          aggregate.recall
        )
      }

      // Per viewer as well as the aggregate, for the same reason the log
      // prints both: this instance has twice been misled by an average that
      // described nobody.
      for (const metrics of result.perUser) {
        push(
          'viewer',
          report.usernames[metrics.userId] ?? metrics.userId,
          1,
          metrics.testItems,
          metrics.medianPercentile,
          metrics.ndcg,
          metrics.recall
        )
      }
    }

    await insertRows(
      client,
      'evaluation_metrics',
      [
        'run_id',
        'variant',
        'scope',
        'scope_label',
        'users',
        'test_items',
        'median_percentile',
        'ndcg_20',
        'ndcg_100',
        'ndcg_500',
        'recall_20',
        'recall_100',
        'recall_500',
      ],
      metricRows
    )

    const neighbourRows: unknown[][] = []
    for (const dump of report.neighbours) {
      dump.report.neighbours.forEach((row, index) => {
        neighbourRows.push([
          runId,
          dump.report.seedId,
          dump.report.seedTitle,
          dump.report.seedYear,
          dump.report.seedCountries.join('/'),
          dump.variant,
          dump.sameCountryShare,
          index + 1,
          row.itemId,
          row.title,
          row.year,
          row.countries.join('/'),
          row.genres.join('/'),
          row.cosine,
        ])
      })
    }

    await insertRows(
      client,
      'evaluation_neighbours',
      [
        'run_id',
        'seed_id',
        'seed_title',
        'seed_year',
        'seed_countries',
        'variant',
        'same_country_share',
        'neighbour_rank',
        'item_id',
        'title',
        'year',
        'countries',
        'genres',
        'cosine',
      ],
      neighbourRows
    )

    return runId
  })
}

export async function listEvaluationRuns(limit = 100): Promise<EvaluationRunSummary[]> {
  const result = await query<{
    id: string
    created_at: Date
    media_type: string
    model: string
    dimensions: number
    pool_size: number
    qualified_users: number
    seed_titles: string[] | null
  }>(
    `SELECT id, created_at, media_type, model, dimensions, pool_size,
            qualified_users, seed_titles
       FROM evaluation_runs
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  )

  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    mediaType: row.media_type,
    model: row.model,
    dimensions: row.dimensions,
    poolSize: row.pool_size,
    qualifiedUsers: row.qualified_users,
    seedTitles: row.seed_titles ?? [],
  }))
}

const METRIC_COLUMNS = [
  'run_id',
  'run_at',
  'media_type',
  'model',
  'dimensions',
  'pool_size',
  'holdout_size',
  'qualified_users',
  'skipped_users',
  'seed_count',
  'variant',
  'scope',
  'scope_label',
  'users',
  'test_items',
  'median_percentile',
  'ndcg_20',
  'ndcg_100',
  'ndcg_500',
  'recall_20',
  'recall_100',
  'recall_500',
]

const NEIGHBOUR_COLUMNS = [
  'run_id',
  'run_at',
  'media_type',
  'model',
  'dimensions',
  'pool_size',
  'seed_title',
  'seed_year',
  'seed_countries',
  'variant',
  'same_country_share',
  'neighbour_rank',
  'title',
  'year',
  'countries',
  'genres',
  'cosine',
]

/**
 * Every stored figure, one row per (run, variant, scope).
 *
 * Provenance columns ride on every row rather than living in a second sheet,
 * because the stated use is concatenating exports and pivoting them — a shape
 * that only works if each row can name the model it came from.
 */
export async function evaluationMetricsCsv(runId?: string): Promise<string> {
  const result = await query<Record<string, unknown>>(
    `SELECT r.id AS run_id, r.created_at AS run_at, r.media_type, r.model,
            r.dimensions, r.pool_size, r.holdout_size, r.qualified_users,
            r.skipped_users, COALESCE(array_length(r.seed_titles, 1), 0) AS seed_count,
            m.variant, m.scope, m.scope_label, m.users, m.test_items,
            m.median_percentile, m.ndcg_20, m.ndcg_100, m.ndcg_500,
            m.recall_20, m.recall_100, m.recall_500
       FROM evaluation_metrics m
       JOIN evaluation_runs r ON r.id = m.run_id
      ${runId ? 'WHERE r.id = $1' : ''}
      ORDER BY r.created_at DESC, r.model, m.variant, m.scope, m.scope_label`,
    runId ? [runId] : []
  )

  return toCsv(
    METRIC_COLUMNS,
    result.rows.map((row) => METRIC_COLUMNS.map((key) => asCell(row[key])))
  )
}

/** Every stored neighbour, one row per (run, seed, variant, rank). */
export async function evaluationNeighboursCsv(runId?: string): Promise<string> {
  const result = await query<Record<string, unknown>>(
    `SELECT r.id AS run_id, r.created_at AS run_at, r.media_type, r.model,
            r.dimensions, r.pool_size,
            n.seed_title, n.seed_year, n.seed_countries, n.variant,
            n.same_country_share, n.neighbour_rank, n.title, n.year,
            n.countries, n.genres, n.cosine
       FROM evaluation_neighbours n
       JOIN evaluation_runs r ON r.id = n.run_id
      ${runId ? 'WHERE r.id = $1' : ''}
      ORDER BY r.created_at DESC, r.model, n.seed_title, n.variant, n.neighbour_rank`,
    runId ? [runId] : []
  )

  return toCsv(
    NEIGHBOUR_COLUMNS,
    result.rows.map((row) => NEIGHBOUR_COLUMNS.map((key) => asCell(row[key])))
  )
}

/**
 * A pg value as a CSV cell.
 *
 * NUMERIC arrives as a string, which is exactly what a CSV wants — passing it
 * through Number() would be the usual trap running backwards, turning a stored
 * NULL into a confident 0.
 */
function asCell(value: unknown): CsvCell {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return value
  return String(value)
}
