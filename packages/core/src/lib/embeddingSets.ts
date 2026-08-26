/**
 * What embeddings this instance actually holds, broken down by the model that
 * wrote them.
 *
 * Embedding rows are keyed `UNIQUE(<item>_id, model)` inside a per-dimension
 * table, and every read filters on `model`. Nothing is ever deleted implicitly:
 * switching the embeddings model starts a *new* set beside the old one, and
 * switching back reuses whatever was already stored. That is good behaviour and
 * completely invisible — the admin picking a model from a dropdown has no way
 * to tell whether they are about to spend a full library re-embed or reattach
 * to 12,000 vectors they already paid for.
 *
 * This module answers that question before the switch rather than after it.
 *
 * Two rules worth keeping:
 *
 *  - **Pending is measured with the job's own predicate, not a row count.** A
 *    `movieCount` equal to the library size does not mean "done" — a set can be
 *    fully populated and still need work because `CANONICAL_TEXT_VERSION` moved
 *    or titles were re-enriched since. `MOVIE_STALE_SQL`/`SERIES_STALE_SQL` are
 *    imported from the embedding modules for exactly that reason; a second copy
 *    here would drift, and the panel would report ready for a set the job then
 *    rebuilds from scratch.
 *
 *  - **The status is decided here, never in the web bundle.** The bundle never
 *    imports core, so a rule encoded in the UI drifts the first time this
 *    changes. The API ships `status`; the UI only chooses a colour for it.
 */
import { query, queryOne } from './db.js'
import {
  VALID_EMBEDDING_DIMENSIONS,
  getActiveEmbeddingModelId,
  getCurrentEmbeddingDimensions,
} from './ai-provider.js'
import { getEpisodeEmbeddingsEnabled } from '../settings/systemSettings.js'
import { MOVIE_STALE_SQL } from '../recommender/movies/embeddings.js'
import { SERIES_STALE_SQL } from '../recommender/series/embeddings.js'
import { createChildLogger } from './logger.js'

const logger = createChildLogger('embedding-sets')

export interface EmbeddingSetPending {
  movies: number
  series: number
  episodes: number
  total: number
}

export interface EmbeddingSetSummary {
  /** `provider:model`, the value stored in every embedding row's `model` column. */
  model: string
  dimensions: number
  movieCount: number
  seriesCount: number
  episodeCount: number
  totalCount: number
  isActive: boolean
  /**
   * What the embedding job would still generate if this set were the active
   * one. Null when it could not be measured — which the UI must render as
   * unknown rather than as zero.
   */
  pending: EmbeddingSetPending | null
  /**
   * `ready`      nothing left to generate — switching to it costs nothing.
   * `incomplete` usable, but the job has work to do before it covers the library.
   * `empty`      no rows at all; this is a full re-embed.
   * `unknown`    pending could not be measured.
   */
  status: 'ready' | 'incomplete' | 'empty' | 'unknown'
}

export interface EmbeddingSetsReport {
  sets: EmbeddingSetSummary[]
  activeModel: string | null
  activeDimensions: number | null
  /** Episodes are only ever generated while this is on, so pending reflects it. */
  episodeEmbeddingsEnabled: boolean
  /** The population the job would embed: enabled libraries only. */
  library: { movies: number; series: number; episodes: number }
}

interface StoredSetKey {
  model: string
  dimensions: number
}

/**
 * Whether any library has been configured at all.
 *
 * Mirrors the branch in `getMoviesNeedingEmbeddings`: with no `library_config`
 * rows the job embeds everything, so the totals here have to do the same or the
 * panel reports coverage against a population the job does not use.
 */
async function hasLibraryConfigs(): Promise<boolean> {
  const row = await queryOne<{ count: string }>('SELECT COUNT(*) FROM library_config')
  return row != null && parseInt(row.count, 10) > 0
}

const enabledLibrarySql = (alias: string): string =>
  `EXISTS (
     SELECT 1 FROM library_config lc
     WHERE lc.provider_library_id = ${alias}.provider_library_id
       AND lc.is_enabled = true
   )`

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const row = await queryOne<{ count: number }>(sql, params)
  return row?.count ?? 0
}

/**
 * The embeddable population — what 100% coverage would mean.
 */
async function getEmbeddablePopulation(scoped: boolean): Promise<{
  movies: number
  series: number
  episodes: number
}> {
  const movieWhere = scoped ? `WHERE ${enabledLibrarySql('m')}` : ''
  const seriesWhere = scoped ? `WHERE ${enabledLibrarySql('s')}` : ''

  const [movies, series, episodes] = await Promise.all([
    countRows(`SELECT COUNT(*)::int AS count FROM movies m ${movieWhere}`),
    countRows(`SELECT COUNT(*)::int AS count FROM series s ${seriesWhere}`),
    // Episodes carry no library scoping in getEpisodesWithoutEmbeddings, so
    // they get none here either.
    countRows('SELECT COUNT(*)::int AS count FROM episodes'),
  ])

  return { movies, series, episodes }
}

/**
 * How much work the embedding job would still have for one (model, dimension)
 * pair, using the job's own selection predicates.
 *
 * Episodes are counted as *missing* only. They are deliberately outside the
 * `text_version` staleness scheme — their canonical text reads no enrichment
 * column, so there is nothing for them to go stale against, and the episode
 * tables have no `text_version`/`updated_at` columns to test.
 */
async function measurePending(
  key: StoredSetKey,
  scoped: boolean,
  episodesEnabled: boolean
): Promise<EmbeddingSetPending | null> {
  const { model, dimensions } = key

  try {
    const movieScope = scoped ? `AND ${enabledLibrarySql('m')}` : ''
    const seriesScope = scoped ? `AND ${enabledLibrarySql('s')}` : ''

    const [movies, series, episodes] = await Promise.all([
      countRows(
        `SELECT COUNT(*)::int AS count
           FROM movies m
           LEFT JOIN embeddings_${dimensions} e ON e.movie_id = m.id AND e.model = $1
          WHERE ${MOVIE_STALE_SQL} ${movieScope}`,
        [model]
      ),
      countRows(
        `SELECT COUNT(*)::int AS count
           FROM series s
           LEFT JOIN series_embeddings_${dimensions} e ON e.series_id = s.id AND e.model = $1
          WHERE ${SERIES_STALE_SQL} ${seriesScope}`,
        [model]
      ),
      // With generation off the job produces no episode vectors at all, so
      // "pending" for them is genuinely zero rather than the whole table.
      episodesEnabled
        ? countRows(
            `SELECT COUNT(*)::int AS count
               FROM episodes ep
               LEFT JOIN episode_embeddings_${dimensions} ee
                 ON ee.episode_id = ep.id AND ee.model = $1
              WHERE ee.id IS NULL`,
            [model]
          )
        : Promise.resolve(0),
    ])

    return { movies, series, episodes, total: movies + series + episodes }
  } catch (err) {
    logger.warn({ err, model, dimensions }, 'Could not measure pending embeddings for set')
    return null
  }
}

/**
 * The one place a set's readiness is decided. Exported and pinned because the
 * panel, and any future caller, must not re-derive it — and because the
 * null case is the easy one to get wrong.
 *
 * A set whose pending count could not be measured is `unknown`, never `ready`.
 * Treating an unmeasured set as ready is the failure that matters: it tells an
 * admin a switch is free when it may cost a full library re-embed. The other
 * direction merely asks them to look.
 *
 * `empty` outranks the null check on purpose. A set with no rows needs no
 * measurement to classify, and reporting the model an admin just selected as
 * "unknown" rather than "nothing stored" hides the one fact they need.
 */
export function decideStatus(
  totalCount: number,
  pending: EmbeddingSetPending | null
): EmbeddingSetSummary['status'] {
  if (totalCount === 0) return 'empty'
  if (pending == null) return 'unknown'
  return pending.total === 0 ? 'ready' : 'incomplete'
}

function emptySummary(model: string, dimensions: number): EmbeddingSetSummary {
  return {
    model,
    dimensions,
    movieCount: 0,
    seriesCount: 0,
    episodeCount: 0,
    totalCount: 0,
    isActive: false,
    pending: null,
    status: 'empty',
  }
}

/**
 * Every stored (model, dimension) pair, with counts.
 *
 * Keyed on model *and* dimension rather than model alone. A model normally
 * resolves to exactly one dimension, but the resolution runs through
 * `getCurrentEmbeddingDimensions`, which reads a custom model's configured
 * dimensions — edit that after embedding and the same model name owns rows in
 * two tables. Merging them would report one set with a dimension that is wrong
 * for half its rows.
 */
async function listStoredSets(): Promise<Map<string, EmbeddingSetSummary>> {
  const familyUnion = (base: string): string =>
    VALID_EMBEDDING_DIMENSIONS.map(
      (d) =>
        `SELECT model, COUNT(*)::int AS count, ${d} AS dimensions FROM ${base}_${d} GROUP BY model`
    ).join(' UNION ALL ')

  const [movieSets, seriesSets, episodeSets] = await Promise.all([
    query<{ model: string; count: number; dimensions: number }>(familyUnion('embeddings')),
    query<{ model: string; count: number; dimensions: number }>(familyUnion('series_embeddings')),
    query<{ model: string; count: number; dimensions: number }>(familyUnion('episode_embeddings')),
  ])

  const sets = new Map<string, EmbeddingSetSummary>()

  const ensure = (model: string, dimensions: number): EmbeddingSetSummary => {
    const mapKey = `${model}|${dimensions}`
    let entry = sets.get(mapKey)
    if (!entry) {
      entry = emptySummary(model, dimensions)
      sets.set(mapKey, entry)
    }
    return entry
  }

  for (const row of movieSets.rows) {
    const entry = ensure(row.model, row.dimensions)
    entry.movieCount += row.count
    entry.totalCount += row.count
  }
  for (const row of seriesSets.rows) {
    const entry = ensure(row.model, row.dimensions)
    entry.seriesCount += row.count
    entry.totalCount += row.count
  }
  for (const row of episodeSets.rows) {
    const entry = ensure(row.model, row.dimensions)
    entry.episodeCount += row.count
    entry.totalCount += row.count
  }

  return sets
}

/**
 * Full report for the admin panel: every stored set, what it would still cost
 * to switch to, and which one is live.
 *
 * The active model is always present in the result even when it has written
 * nothing yet. Omitting it is what made the old listing confusing straight
 * after a switch — every row showed as inactive and the set the instance was
 * actually using appeared nowhere.
 */
export async function getEmbeddingSetsReport(): Promise<EmbeddingSetsReport> {
  const [activeModel, activeDimensions, episodeEmbeddingsEnabled, scoped] = await Promise.all([
    getActiveEmbeddingModelId(),
    getCurrentEmbeddingDimensions(),
    getEpisodeEmbeddingsEnabled(),
    hasLibraryConfigs(),
  ])

  const sets = await listStoredSets()

  // A freshly selected model owns no rows yet; it still has to appear, and its
  // pending count is the whole point of the panel.
  if (activeModel && activeDimensions) {
    const mapKey = `${activeModel}|${activeDimensions}`
    if (!sets.has(mapKey)) {
      sets.set(mapKey, emptySummary(activeModel, activeDimensions))
    }
  }

  const library = await getEmbeddablePopulation(scoped)

  const summaries = Array.from(sets.values())
  await Promise.all(
    summaries.map(async (set) => {
      set.isActive = set.model === activeModel && set.dimensions === activeDimensions
      set.pending = await measurePending(set, scoped, episodeEmbeddingsEnabled)
      set.status = decideStatus(set.totalCount, set.pending)
    })
  )

  summaries.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    return b.totalCount - a.totalCount
  })

  return {
    sets: summaries,
    activeModel,
    activeDimensions: activeDimensions ?? null,
    episodeEmbeddingsEnabled,
    library,
  }
}

/**
 * Delete one stored set.
 *
 * Scoped by dimension when given, for the same reason the listing is keyed that
 * way. Omitting it deletes the model across every dimension table, which is the
 * behaviour this endpoint has always had.
 */
export async function deleteEmbeddingSet(
  model: string,
  dimensions?: number
): Promise<{ movies: number; series: number; episodes: number; total: number }> {
  const dims =
    dimensions != null && (VALID_EMBEDDING_DIMENSIONS as readonly number[]).includes(dimensions)
      ? [dimensions]
      : [...VALID_EMBEDDING_DIMENSIONS]

  let movies = 0
  let series = 0
  let episodes = 0

  for (const dim of dims) {
    const [movieResult, seriesResult, episodeResult] = await Promise.all([
      query(`DELETE FROM embeddings_${dim} WHERE model = $1`, [model]),
      query(`DELETE FROM series_embeddings_${dim} WHERE model = $1`, [model]),
      query(`DELETE FROM episode_embeddings_${dim} WHERE model = $1`, [model]),
    ])
    movies += movieResult.rowCount ?? 0
    series += seriesResult.rowCount ?? 0
    episodes += episodeResult.rowCount ?? 0
  }

  return { movies, series, episodes, total: movies + series + episodes }
}
