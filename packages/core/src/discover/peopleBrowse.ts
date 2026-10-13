import { query, queryOne } from '../lib/db.js'
import { binderFor, libraryScopeSql, type LibraryScope } from '../lib/libraryScope.js'

export interface ListPeopleBrowseOptions {
  search?: string
  page?: number
  pageSize?: number
  sortBy?: 'name' | 'credits'
  /** When true, include items from disabled libraries (only applies if library_config rows exist). */
  showAll?: boolean
  /**
   * What the viewer may see (lib/libraryScope.ts). When given it decides alone:
   * `showAll` never widens a viewer's scope.
   */
  scope?: LibraryScope
}

export interface PersonBrowseRow {
  name: string
  credits: number
  movieCredits: number
  seriesCredits: number
}

export interface ListPeopleBrowseResult {
  people: PersonBrowseRow[]
  total: number
  page: number
  pageSize: number
}

/**
 * List distinct people (cast, directors, writers, show creators) appearing in synced movies and series,
 * with optional library visibility matching the main Browse lists.
 */
export async function listPeopleForBrowse(
  options: ListPeopleBrowseOptions = {}
): Promise<ListPeopleBrowseResult> {
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(Math.max(1, options.pageSize ?? 50), 50)
  const offset = (page - 1) * pageSize
  const sortBy = options.sortBy === 'credits' ? 'credits' : 'name'
  const search = options.search?.trim() ?? ''
  const showAll = options.showAll === true

  const configCheck = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM library_config'
  )
  const hasLibraryConfigs = configCheck && parseInt(configCheck.count, 10) > 0
  const filterByLibrary = hasLibraryConfigs && !showAll

  const searchParam = search.length > 0 ? search : null
  const params: unknown[] = [searchParam, pageSize, offset]

  const libMovie = options.scope
    ? libraryScopeSql(options.scope, 'm', binderFor(params))
    : filterByLibrary
      ? `EXISTS (
        SELECT 1 FROM library_config lc
        WHERE lc.provider_library_id = m.provider_library_id
        AND lc.is_enabled = true
      )`
      : 'TRUE'

  const libSeries = options.scope
    ? libraryScopeSql(options.scope, 's', binderFor(params))
    : filterByLibrary
      ? `EXISTS (
        SELECT 1 FROM library_config lc
        WHERE lc.provider_library_id = s.provider_library_id
        AND lc.is_enabled = true
      )`
      : 'TRUE'

  const orderClause =
    sortBy === 'credits'
      ? 'credits DESC NULLS LAST, name ASC'
      : 'name ASC'

  const sql = `
WITH all_contributions AS (
  -- One row per (person, title, credit). Cast, directors and writers come from
  -- the media server; a show's directors column also holds its Creator people,
  -- and TMDb's creators sit beside it in tmdb_creators. The same population
  -- the person page lists, so the two agree on who is here.
  SELECT trim(p.name) AS name, 'movie'::text AS media_kind, m.id AS item_id
  FROM movies m
  CROSS JOIN LATERAL (
    SELECT a->>'name' FROM jsonb_array_elements(COALESCE(m.actors, '[]'::jsonb)) AS a
    UNION ALL SELECT unnest(COALESCE(m.directors, ARRAY[]::text[]))
    UNION ALL SELECT unnest(COALESCE(m.writers, ARRAY[]::text[]))
  ) AS p(name)
  WHERE trim(COALESCE(p.name, '')) != ''
  AND (${libMovie})
  UNION ALL
  SELECT trim(p.name) AS name, 'series'::text, s.id
  FROM series s
  CROSS JOIN LATERAL (
    SELECT a->>'name' FROM jsonb_array_elements(COALESCE(s.actors, '[]'::jsonb)) AS a
    UNION ALL SELECT unnest(COALESCE(s.directors, ARRAY[]::text[]))
    UNION ALL SELECT unnest(COALESCE(s.writers, ARRAY[]::text[]))
    UNION ALL SELECT unnest(COALESCE(s.tmdb_creators, ARRAY[]::text[]))
  ) AS p(name)
  WHERE trim(COALESCE(p.name, '')) != ''
  AND (${libSeries})
),
agg AS (
  -- Titles, not credits: someone who wrote and directed a film has one film.
  SELECT
    name,
    COUNT(DISTINCT item_id)::int AS credits,
    COUNT(DISTINCT item_id) FILTER (WHERE media_kind = 'movie')::int AS movie_credits,
    COUNT(DISTINCT item_id) FILTER (WHERE media_kind = 'series')::int AS series_credits
  FROM all_contributions
  GROUP BY name
),

filtered AS (
  SELECT * FROM agg
  WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%')
)
SELECT name, credits, movie_credits, series_credits,
       COUNT(*) OVER()::bigint AS full_total
FROM filtered
ORDER BY ${orderClause}
LIMIT $2 OFFSET $3
`

  const result = await query<{
    name: string
    credits: number
    movie_credits: number
    series_credits: number
    full_total: string
  }>(sql, params)

  const rows = result.rows
  const total = rows.length > 0 ? parseInt(rows[0].full_total, 10) : 0

  return {
    people: rows.map((r) => ({
      name: r.name,
      credits: r.credits,
      movieCredits: r.movie_credits,
      seriesCredits: r.series_credits,
    })),
    total,
    page,
    pageSize,
  }
}
