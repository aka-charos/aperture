/**
 * People and franchises for the search palette, matched by NAME. Pure — no DB —
 * so the SQL shape is pinned by `nameSearch.test.ts`.
 *
 * Title search (`searchSql.ts`) ranks by how much of the query a title holds,
 * which suits a title. A name is different: someone typing "nol" wants Christopher
 * Nolan, and someone typing "a" wants nothing yet. So a name matches only where
 * one of its WORDS starts with the query ("nol" finds "Christopher Nolan", "ark"
 * does not find "Clark Gable"), and ranks exact, then whole-name prefix, then
 * word prefix, with the larger body of work breaking ties.
 *
 * Both sides go through `aperture_search_key()` (`0178`), the one fold title
 * search uses, so "bjork" finds "Björk" and "oconnor" finds "O'Connor". The fold
 * also turns every punctuation character into a space, which is what keeps `%`
 * and `_` in a query from reaching LIKE as wildcards.
 */

/** Rows per section. A palette, not a page: the full lists live on Browse → People and Franchises. */
export const PEOPLE_LIMIT_DEFAULT = 4
export const FRANCHISE_LIMIT_DEFAULT = 3
export const NAME_SEARCH_MAX_LIMIT = 10

export function clampNameLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, 0), NAME_SEARCH_MAX_LIMIT)
}

/**
 * 0 exact, 1 the name starts with the query, 2 a later word does, null no match.
 * `nameKey` and `queryKey` are already folded SQL expressions.
 */
export function nameMatchRankSql(nameKey: string, queryKey: string): string {
  return `CASE
      WHEN ${nameKey} = ${queryKey} THEN 0
      WHEN ${nameKey} LIKE ${queryKey} || '%' THEN 1
      WHEN ${nameKey} LIKE '% ' || ${queryKey} || '%' THEN 2
    END`
}

export interface NameSearchSql {
  sql: string
  params: unknown[]
}

/**
 * Actors and directors credited on titles the viewer may see — the population
 * Browse → People lists — filtered to matching names BEFORE grouping, so the
 * aggregate counts credits for a handful of people rather than for the library.
 *
 * `scope` receives the params array and an alias and returns the viewer's scope
 * clause for that alias (the route passes `scopeClause` from `lib/viewerScope.ts`).
 */
export function buildPeopleSearch(
  queryText: string,
  limit: number,
  scope: (alias: string, params: unknown[]) => string
): NameSearchSql {
  const params: unknown[] = [queryText, limit]
  const movieScope = scope('m', params)
  const seriesScope = scope('s', params)
  const rank = nameMatchRankSql('aperture_search_key(n.name)', 'q.key')

  // Each distinct name is folded once, not each credit: a lead actor appears on
  // dozens of rows, and folding is most of what this query costs.
  const sql = `
WITH q AS (SELECT aperture_search_key($1) AS key),
credits AS (
  SELECT trim(a->>'name') AS name, 'movie'::text AS kind
  FROM movies m CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.actors, '[]'::jsonb)) AS a
  WHERE (${movieScope})
  UNION ALL
  SELECT trim(d) AS name, 'movie'::text
  FROM movies m CROSS JOIN LATERAL unnest(COALESCE(m.directors, ARRAY[]::text[])) AS d
  WHERE (${movieScope})
  UNION ALL
  SELECT trim(a->>'name') AS name, 'series'::text
  FROM series s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.actors, '[]'::jsonb)) AS a
  WHERE (${seriesScope})
  UNION ALL
  SELECT trim(d) AS name, 'series'::text
  FROM series s CROSS JOIN LATERAL unnest(COALESCE(s.directors, ARRAY[]::text[])) AS d
  WHERE (${seriesScope})
),
names AS (
  SELECT DISTINCT name FROM credits WHERE name IS NOT NULL AND name <> ''
),
matched AS (
  SELECT n.name, ${rank} AS rank
  FROM names n, q
  WHERE q.key <> ''
)
SELECT c.name,
       MIN(mt.rank)::int AS rank,
       COUNT(*)::int AS credits,
       COUNT(*) FILTER (WHERE c.kind = 'movie')::int AS movie_credits,
       COUNT(*) FILTER (WHERE c.kind = 'series')::int AS series_credits
FROM credits c
JOIN matched mt ON mt.name = c.name AND mt.rank IS NOT NULL
GROUP BY c.name
ORDER BY MIN(mt.rank), COUNT(*) DESC, c.name
LIMIT $2`

  return { sql, params }
}

/**
 * TMDb collections with at least one film the viewer may see, grouped by name
 * exactly as the Franchises page groups them, addressed by the TMDb id that
 * `/franchises/:id` takes. A franchise with no id cannot be opened, so it is
 * not offered.
 */
export function buildFranchiseSearch(
  queryText: string,
  limit: number,
  scope: (alias: string, params: unknown[]) => string
): NameSearchSql {
  const params: unknown[] = [queryText, limit]
  const movieScope = scope('m', params)
  const rank = nameMatchRankSql('aperture_search_key(f.name)', 'q.key')

  const sql = `
WITH q AS (SELECT aperture_search_key($1) AS key),
franchises AS (
  SELECT m.collection_name AS name,
         MIN(m.collection_id) AS id,
         COUNT(*)::int AS movie_count,
         (ARRAY_AGG(m.poster_url ORDER BY m.year NULLS LAST) FILTER (WHERE m.poster_url IS NOT NULL))[1] AS first_poster
  FROM movies m
  WHERE m.collection_name IS NOT NULL AND m.collection_id IS NOT NULL AND (${movieScope})
  GROUP BY m.collection_name
),
matched AS (
  SELECT f.*, ${rank} AS rank
  FROM franchises f, q
  WHERE q.key <> ''
)
SELECT matched.id, matched.name, matched.movie_count,
       COALESCE(c.poster_url, matched.first_poster) AS poster_url
FROM matched
LEFT JOIN collections c ON c.tmdb_id = matched.id
WHERE matched.rank IS NOT NULL
ORDER BY matched.rank, matched.movie_count DESC, matched.name
LIMIT $2`

  return { sql, params }
}
