/**
 * Reads what a Watcher Identity is written from, plus the taste dispersion
 * getSmartDiversityWeight falls back on when no clusters exist.
 *
 * This file used to BE the identity's analysis: genre-tag counts, a lookup table
 * of adjectives keyed on which genres appeared in the top ten, and threshold
 * labels on a favourite rate and a rewatch rate, all over `played OR
 * is_favorite`. F-129 has the measurements that retired it; tasteEvidence.ts
 * holds the rules that replaced it and lays the result out for the model.
 *
 * Two rules for every identity query here. The viewer's side is PLAYED titles:
 * the identity is a claim made to someone's face, and on a live instance
 * favourites were mostly a watchlist (one viewer: 872 unwatched of 898). And the
 * library side comes from the same libraries the viewer's side was drawn from --
 * `libraryFilter` is the one spelling of that, so a hidden library cannot read
 * as an avoided genre (F-034).
 */

import { query, queryOne } from './db.js'
import { getActiveEmbeddingTableName, getActiveEmbeddingModelId } from './ai-provider.js'
import { getUserExcludedLibraries } from './libraryExclusions.js'
import {
  WATCH_HISTORY_EXCLUDABLE_SQL,
  WATCH_HISTORY_PLAYED_SQL,
  WATCH_HISTORY_TASTE_SQL,
} from '../recommender/watchedExclusion.js'
import { DISPERSION_FOCUSED_THRESHOLD } from '../taste-profile/clustering.js'
import {
  EXAMPLE_CANDIDATES,
  FACET_RULES,
  FACETS_FOR,
  MIN_TITLES_FOR_SYNOPSIS,
  UNFINISHED_AFTER_DAYS,
  UNFINISHED_EXAMPLES,
  isTasteFacet,
  type CrowdComparison,
  type FacetCount,
  type FacetTotals,
  type RatedTitle,
  type SeriesProgress,
  type TasteEvidence,
  type TasteFacet,
  type TasteMediaType,
  type UnfinishedTitles,
} from './tasteEvidence.js'

const TABLE: Record<TasteMediaType, 'movies' | 'series'> = { movie: 'movies', series: 'series' }

/**
 * The libraries a viewer draws from, as one spelling. `$2` is their excluded
 * library ids in every query below, and the viewer's own titles are always
 * reached through the same filter, so the two sides of a comparison cannot come
 * from different libraries.
 */
function libraryFilter(alias: string): string {
  return `(CARDINALITY($2::text[]) = 0 OR ${alias}.provider_library_id IS NULL OR ${alias}.provider_library_id::text != ALL($2::text[]))`
}

/**
 * The viewer's PLAYED titles, one row per title, with their own rating. A show
 * counts once any of its episodes has been played.
 */
const MINE_SQL: Record<TasteMediaType, string> = {
  movie: `
      SELECT wh.movie_id AS id, MAX(ur.rating) AS rating
      FROM watch_history wh
      LEFT JOIN user_ratings ur ON ur.user_id = wh.user_id AND ur.movie_id = wh.movie_id
      WHERE wh.user_id = $1 AND wh.media_type = 'movie' AND wh.movie_id IS NOT NULL
        AND ${WATCH_HISTORY_PLAYED_SQL}
      GROUP BY wh.movie_id`,
  series: `
      SELECT e.series_id AS id, MAX(ur.rating) AS rating
      FROM watch_history wh
      JOIN episodes e ON e.id = wh.episode_id
      LEFT JOIN user_ratings ur ON ur.user_id = wh.user_id AND ur.series_id = e.series_id
      WHERE wh.user_id = $1 AND wh.media_type = 'episode'
        AND ${WATCH_HISTORY_PLAYED_SQL}
      GROUP BY e.series_id`,
}

/**
 * What counts as ONE choice in a facet comparison. A film in a TMDb collection
 * is its collection, so a trilogy is one choice rather than three: counted per
 * title, three extended editions of one trilogy made both a country and a
 * director read as preferences (F-129). `collection_id` is TEXT, and an empty
 * string is no collection. A show has no franchise grouping and is itself.
 */
const UNIT_EXPRESSION: Record<TasteMediaType, string> = {
  movie: `COALESCE(NULLIF(t.collection_id, ''), t.id::text)`,
  series: `t.id::text`,
}

/** Each facet as a text[] over the title table aliased `t`, so every facet unnests alike. */
const FACET_EXPRESSION: Record<TasteFacet, string> = {
  genre: `COALESCE(t.genres, '{}'::text[])`,
  decade: `CASE WHEN t.year IS NOT NULL THEN ARRAY[(FLOOR(t.year / 10) * 10)::int::text || 's'] ELSE '{}'::text[] END`,
  country: `COALESCE(t.production_countries, '{}'::text[])`,
  director: `COALESCE(t.directors, '{}'::text[])`,
  network: `CASE WHEN btrim(COALESCE(t.network, '')) <> '' THEN ARRAY[t.network] ELSE '{}'::text[] END`,
  keyword: `COALESCE(t.keywords, '{}'::text[])`,
}

/** pg returns NUMERIC and COUNT as strings, and Number(null) is 0 -- parse explicitly. */
function toNumber(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}

function toCount(value: unknown): number {
  return Math.max(0, Math.round(toNumber(value) ?? 0))
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []
}

type ExcludedLibraries = string[]

// ============================================================================
// Watcher Identity evidence
// ============================================================================

export async function gatherTasteEvidence(
  userId: string,
  mediaType: TasteMediaType
): Promise<TasteEvidence> {
  const excluded = await getUserExcludedLibraries(userId)
  const counts = await countTitles(userId, mediaType, excluded)

  const evidence: TasteEvidence = {
    mediaType,
    watchedTotal: counts.watched,
    libraryTotal: counts.library,
    facets: [],
    facetTotals: {},
    rated: [],
    crowd: null,
    unfinished: null,
    progress: null,
  }

  // Below the floor nothing is written, so the expensive reads are not worth
  // making -- and the refresh gate asks again on every run for these viewers.
  if (counts.watched < MIN_TITLES_FOR_SYNOPSIS[mediaType]) return evidence

  const [facets, rated, crowd, unfinished, progress] = await Promise.all([
    getFacetCounts(userId, mediaType, excluded),
    getRatedTitles(userId, mediaType, excluded),
    getCrowdComparison(userId, mediaType, excluded),
    mediaType === 'movie' ? getUnfinishedMovies(userId, excluded) : Promise.resolve(null),
    mediaType === 'series' ? getSeriesProgress(userId, excluded) : Promise.resolve(null),
  ])

  return {
    ...evidence,
    facets: facets.rows,
    facetTotals: facets.totals,
    rated,
    crowd,
    unfinished,
    progress,
  }
}

async function countTitles(
  userId: string,
  mediaType: TasteMediaType,
  excluded: ExcludedLibraries
): Promise<{ watched: number; library: number }> {
  const watchedSql =
    mediaType === 'movie'
      ? `SELECT COUNT(DISTINCT wh.movie_id)
           FROM watch_history wh
           JOIN movies t ON t.id = wh.movie_id
          WHERE wh.user_id = $1 AND wh.media_type = 'movie'
            AND ${WATCH_HISTORY_PLAYED_SQL}
            AND ${libraryFilter('t')}`
      : `SELECT COUNT(DISTINCT e.series_id)
           FROM watch_history wh
           JOIN episodes e ON e.id = wh.episode_id
           JOIN series t ON t.id = e.series_id
          WHERE wh.user_id = $1 AND wh.media_type = 'episode'
            AND ${WATCH_HISTORY_PLAYED_SQL}
            AND ${libraryFilter('t')}`

  const row = await queryOne<{ watched: string | null; library: string | null }>(
    `SELECT (${watchedSql}) AS watched,
            (SELECT COUNT(*) FROM ${TABLE[mediaType]} t WHERE ${libraryFilter('t')}) AS library`,
    [userId, excluded]
  )

  return { watched: toCount(row?.watched), library: toCount(row?.library) }
}

/**
 * Every facet label with the viewer's count and the library's, plus each facet's
 * own totals -- in one statement, so the two sides are read from one snapshot.
 *
 * Counts are CHOICES (UNIT_EXPRESSION), not titles, on both sides, so a franchise
 * is one decision however many of its films were watched. The totals are the
 * choices carrying at least one label OF THAT FACET, not every title: a film with
 * no keywords is not evidence about keywords, and counting it would shrink every
 * keyword share. Labels the viewer never watched are kept only for facets that
 * report avoidance, since "none of theirs" is the strongest form of it, and
 * dropped elsewhere (the library's keyword list is enormous).
 */
async function getFacetCounts(
  userId: string,
  mediaType: TasteMediaType,
  excluded: ExcludedLibraries
): Promise<{ rows: FacetCount[]; totals: Partial<Record<TasteFacet, FacetTotals>> }> {
  const facets = FACETS_FOR[mediaType]
  const columns = facets.map((f) => `${FACET_EXPRESSION[f]} AS f_${f}`).join(',\n             ')
  const unions = facets
    .map(
      (f) =>
        `SELECT '${f}'::text AS facet, v AS label, lib.id, lib.unit, lib.title, lib.votes FROM lib, unnest(lib.f_${f}) AS v`
    )
    .join('\n       UNION ALL\n       ')
  const reportsAvoidance = facets.filter((f) => FACET_RULES[f].underLimit > 0).map((f) => `'${f}'`)
  const keepUnwatched =
    reportsAvoidance.length > 0 ? `OR f.facet IN (${reportsAvoidance.join(', ')})` : ''

  const result = await query<{
    facet: string
    label: string | null
    available: number
    watched: number
    examples: string[] | null
    is_total: number
  }>(
    `WITH lib AS (
       SELECT t.id, t.title, t.imdb_vote_count AS votes,
              ${UNIT_EXPRESSION[mediaType]} AS unit,
              ${columns}
       FROM ${TABLE[mediaType]} t
       WHERE ${libraryFilter('t')}
     ),
     mine AS (${MINE_SQL[mediaType]}),
     facets AS (
       ${unions}
     )
     SELECT f.facet,
            f.label,
            COUNT(DISTINCT f.unit)::int AS available,
            (COUNT(DISTINCT f.unit) FILTER (WHERE mine.id IS NOT NULL))::int AS watched,
            (array_agg(f.title ORDER BY mine.rating DESC NULLS LAST, f.votes DESC NULLS LAST, f.title)
               FILTER (WHERE mine.id IS NOT NULL))[1:${EXAMPLE_CANDIDATES}] AS examples,
            GROUPING(f.label)::int AS is_total
     FROM facets f
     LEFT JOIN mine ON mine.id = f.id
     WHERE f.label IS NOT NULL AND btrim(f.label) <> ''
     GROUP BY GROUPING SETS ((f.facet, f.label), (f.facet))
     HAVING GROUPING(f.label) = 1 OR COUNT(DISTINCT mine.id) > 0 ${keepUnwatched}`,
    [userId, excluded]
  )

  const rows: FacetCount[] = []
  const totals: Partial<Record<TasteFacet, FacetTotals>> = {}

  for (const row of result.rows) {
    const facet = row.facet
    if (!isTasteFacet(facet)) continue
    const watched = toCount(row.watched)
    const available = toCount(row.available)

    if (toCount(row.is_total) === 1) {
      totals[facet] = { watched, available }
    } else if (row.label) {
      rows.push({
        facet,
        label: row.label,
        watched,
        available,
        examples: [...new Set(row.examples ?? [])],
      })
    }
  }

  return { rows, totals }
}

/**
 * Every title the viewer rated, with what it is: genres and keywords are what
 * let the model say what the favourites -- and the disagreements with IMDb --
 * have in common, instead of listing titles it may know nothing about.
 */
async function getRatedTitles(
  userId: string,
  mediaType: TasteMediaType,
  excluded: ExcludedLibraries
): Promise<RatedTitle[]> {
  const column = mediaType === 'movie' ? 'movie_id' : 'series_id'
  const result = await query<{
    title: string
    year: number | null
    rating: number
    crowd: string | number | null
    genres: string[] | null
    keywords: string[] | null
  }>(
    `SELECT t.title, t.year, ur.rating,
            NULLIF(COALESCE(t.imdb_rating, t.community_rating), 0) AS crowd,
            t.genres, t.keywords
     FROM user_ratings ur
     JOIN ${TABLE[mediaType]} t ON t.id = ur.${column}
     WHERE ur.user_id = $1 AND ${libraryFilter('t')}`,
    [userId, excluded]
  )

  return result.rows.map((r) => ({
    title: r.title,
    year: toNumber(r.year),
    rating: toCount(r.rating),
    crowdRating: toNumber(r.crowd),
    genres: toStrings(r.genres),
    keywords: toStrings(r.keywords),
  }))
}

async function getCrowdComparison(
  userId: string,
  mediaType: TasteMediaType,
  excluded: ExcludedLibraries
): Promise<CrowdComparison | null> {
  const row = await queryOne<{
    library_median_votes: number | null
    watched_median_votes: number | null
    library_mean_rating: string | null
    watched_mean_rating: string | null
  }>(
    `WITH lib AS (
       SELECT t.id, t.imdb_vote_count::float8 AS votes,
              NULLIF(COALESCE(t.imdb_rating, t.community_rating), 0) AS crowd
       FROM ${TABLE[mediaType]} t
       WHERE ${libraryFilter('t')}
     ),
     mine AS (${MINE_SQL[mediaType]})
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY lib.votes) AS library_median_votes,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY lib.votes)
              FILTER (WHERE mine.id IS NOT NULL) AS watched_median_votes,
            AVG(lib.crowd) AS library_mean_rating,
            AVG(lib.crowd) FILTER (WHERE mine.id IS NOT NULL) AS watched_mean_rating
     FROM lib
     LEFT JOIN mine ON mine.id = lib.id`,
    [userId, excluded]
  )

  if (!row) return null
  return {
    watchedMedianVotes: toNumber(row.watched_median_votes),
    libraryMedianVotes: toNumber(row.library_median_votes),
    watchedMeanRating: toNumber(row.watched_mean_rating),
    libraryMeanRating: toNumber(row.library_mean_rating),
  }
}

/**
 * Films partly played and then left. The excludable predicate's progress half
 * (>= 5% in) with `played` false, untouched for long enough that it reads as
 * left rather than paused. A film the viewer has RATED is not on this list: the
 * rating is the stronger evidence that they saw it, and measured live a 9/10
 * film sat here with its play never registered, which would have handed the
 * model a contradiction.
 */
async function getUnfinishedMovies(
  userId: string,
  excluded: ExcludedLibraries
): Promise<UnfinishedTitles> {
  const row = await queryOne<{ count: number | null; examples: string[] | null }>(
    `SELECT COUNT(*)::int AS count,
            (array_agg(t.title ORDER BY t.imdb_vote_count DESC NULLS LAST, t.title))[1:${UNFINISHED_EXAMPLES}] AS examples
     FROM watch_history wh
     JOIN movies t ON t.id = wh.movie_id
     WHERE wh.user_id = $1 AND wh.media_type = 'movie'
       AND wh.played IS NOT TRUE
       AND ${WATCH_HISTORY_EXCLUDABLE_SQL}
       AND wh.last_played_at < NOW() - make_interval(days => $3::int)
       AND NOT EXISTS (
         SELECT 1 FROM user_ratings ur WHERE ur.user_id = wh.user_id AND ur.movie_id = wh.movie_id
       )
       AND ${libraryFilter('t')}`,
    [userId, excluded, UNFINISHED_AFTER_DAYS]
  )

  return { count: toCount(row?.count), examples: row?.examples ?? [] }
}

/**
 * Per started show: played episodes against the library's, specials excluded
 * from both halves (watching/watchedItems.ts's rule -- a show is its seasons),
 * how long since an episode was last played, how many episodes had aired by
 * that day, and the first season begun and left incomplete among those aired.
 *
 * The aired count and the unfinished season are NULL when any episode has no
 * air date: an undated episode could fall on either side of the last play, and
 * these two decide whether a viewer "stopped" or simply caught up. Air date is
 * not the date the library acquired a season -- nothing stores that;
 * `episodes.created_at` is when the sync inserted the row -- which is why the
 * season test exists at all.
 */
async function getSeriesProgress(
  userId: string,
  excluded: ExcludedLibraries
): Promise<SeriesProgress[]> {
  const result = await query<{
    title: string
    year: number | null
    watched: number
    total: number
    aired_by_last_play: number | null
    unfinished_season: number | null
    days_since: number | null
  }>(
    `WITH started AS (
       SELECT e.series_id AS id,
              COUNT(DISTINCT wh.episode_id)::int AS watched,
              MAX(wh.last_played_at) AS last_played
       FROM watch_history wh
       JOIN episodes e ON e.id = wh.episode_id
       WHERE wh.user_id = $1 AND wh.media_type = 'episode'
         AND ${WATCH_HISTORY_PLAYED_SQL}
         AND e.season_number > 0
       GROUP BY e.series_id
     ),
     seasons AS (
       SELECT e.series_id AS id,
              e.season_number,
              COUNT(*) AS episodes,
              COUNT(*) FILTER (WHERE e.premiere_date IS NULL) AS undated,
              COUNT(*) FILTER (WHERE e.premiere_date <= st.last_played::date) AS aired,
              COUNT(wh.episode_id) AS played,
              COUNT(wh.episode_id) FILTER (WHERE e.premiere_date <= st.last_played::date) AS played_aired
       FROM episodes e
       JOIN started st ON st.id = e.series_id
       LEFT JOIN watch_history wh
         ON wh.episode_id = e.id AND wh.user_id = $1 AND ${WATCH_HISTORY_PLAYED_SQL}
       WHERE e.season_number > 0
       GROUP BY e.series_id, e.season_number
     ),
     totals AS (
       SELECT id,
              SUM(episodes)::int AS total,
              SUM(aired)::int AS aired,
              SUM(undated)::int AS undated,
              MIN(season_number) FILTER (WHERE played > 0 AND played_aired < aired) AS unfinished_season
       FROM seasons
       GROUP BY id
     )
     SELECT t.title, t.year, st.watched, tot.total,
            CASE WHEN st.last_played IS NULL OR tot.undated > 0 THEN NULL
                 ELSE tot.aired
            END AS aired_by_last_play,
            CASE WHEN st.last_played IS NULL OR tot.undated > 0 THEN NULL
                 ELSE tot.unfinished_season
            END AS unfinished_season,
            CASE WHEN st.last_played IS NULL THEN NULL
                 ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - st.last_played)) / 86400)::int
            END AS days_since
     FROM started st
     JOIN totals tot ON tot.id = st.id
     JOIN series t ON t.id = st.id
     WHERE ${libraryFilter('t')}`,
    [userId, excluded]
  )

  return result.rows.map((r) => ({
    title: r.title,
    year: toNumber(r.year),
    watched: toCount(r.watched),
    total: toCount(r.total),
    daysSinceLastPlay: toNumber(r.days_since),
    airedByLastPlay: toNumber(r.aired_by_last_play),
    unfinishedSeason: toNumber(r.unfinished_season),
  }))
}

// ============================================================================
// Taste dispersion (recommender only -- not part of the identity)
// ============================================================================

/**
 * Average cosine distance from the viewer's taste titles to their centroid,
 * rescaled to [0,1] with clustering.ts's cut points. Only getSmartDiversityWeight
 * reads this, and only when no clusters have stored a dispersion yet.
 *
 * It is deliberately not in the identity's evidence: the rescaling maps a raw
 * distance that measured below its 0.3 floor on every live profile, so it reads
 * 0 ("focused") for everyone -- the old identity prompt carried it anyway.
 * `played OR is_favorite` stays here because this is recommender input, where a
 * favourite is deliberate evidence (F-033), not a claim made to anyone.
 */
export async function calculateTasteDispersion(
  userId: string,
  mediaType: TasteMediaType
): Promise<number> {
  const modelId = await getActiveEmbeddingModelId()
  if (!modelId) return 0.5

  const excludedLibraryIds = await getUserExcludedLibraries(userId)
  let avgDistance: number

  if (mediaType === 'movie') {
    const tableName = await getActiveEmbeddingTableName('embeddings')
    const result = await query<{ avg_distance: string }>(
      `
      WITH user_embeddings AS (
        SELECT e.embedding
        FROM watch_history wh
        JOIN movies m ON m.id = wh.movie_id
        JOIN ${tableName} e ON e.movie_id = m.id AND e.model = $2
        WHERE wh.user_id = $1 AND wh.media_type = 'movie'
          AND ${WATCH_HISTORY_TASTE_SQL}
          AND (CARDINALITY($3::text[]) = 0 OR m.provider_library_id::text != ALL($3::text[]))
        LIMIT 100
      ),
      centroid AS (
        SELECT AVG(embedding) as center FROM user_embeddings
      )
      SELECT AVG(embedding <=> center)::numeric(10,4) as avg_distance
      FROM user_embeddings, centroid
    `,
      [userId, modelId, excludedLibraryIds]
    )
    avgDistance = parseFloat(result.rows[0]?.avg_distance || '0.5')
  } else {
    const tableName = await getActiveEmbeddingTableName('series_embeddings')
    const result = await query<{ avg_distance: string }>(
      `
      WITH user_embeddings AS (
        SELECT DISTINCT se.embedding
        FROM watch_history wh
        JOIN episodes ep ON ep.id = wh.episode_id
        JOIN series s ON s.id = ep.series_id
        JOIN ${tableName} se ON se.series_id = s.id AND se.model = $2
        WHERE wh.user_id = $1 AND wh.media_type = 'episode'
          AND ${WATCH_HISTORY_TASTE_SQL}
          AND (CARDINALITY($3::text[]) = 0 OR s.provider_library_id::text != ALL($3::text[]))
        LIMIT 100
      ),
      centroid AS (
        SELECT AVG(embedding) as center FROM user_embeddings
      )
      SELECT AVG(embedding <=> center)::numeric(10,4) as avg_distance
      FROM user_embeddings, centroid
    `,
      [userId, modelId, excludedLibraryIds]
    )
    avgDistance = parseFloat(result.rows[0]?.avg_distance || '0.5')
  }

  // Same formula clustering.ts applies to its own dispersion, so this fallback
  // and the stored value are on one scale.
  return Math.min(1, Math.max(0, (avgDistance - DISPERSION_FOCUSED_THRESHOLD) / 0.5))
}
