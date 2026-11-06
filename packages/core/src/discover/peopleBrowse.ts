import { AsyncCache } from '../lib/asyncCache.js'
import { query, queryOne } from '../lib/db.js'
import { binderFor, libraryScopeKey, libraryScopeSql, type LibraryScope } from '../lib/libraryScope.js'

/**
 * Infinite scroll asks for one page at a time, and each page used to rebuild the
 * whole aggregation to throw most of it away. So the WHOLE ordered answer is what
 * is cached, every page of it is a slice, and a search is a filter over it.
 */
export const PEOPLE_CACHE_TTL_MS = 5 * 60_000
/** One list per audience. */
const PEOPLE_CACHE_MAX_ENTRIES = 64
/**
 * Rows held across all entries, so a large library cannot pile up full lists: at
 * about 200 bytes a row, its derived name and orderings included, this is ~100 MB,
 * and only while people are browsing.
 */
const PEOPLE_CACHE_MAX_ROWS = 500_000

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

/** The answer for one audience and search, in the order the database collates names. */
interface PeopleList {
  byName: PersonBrowseRow[]
  /** Derived on first use; shares the rows. */
  byCredits?: PersonBrowseRow[]
  /** `foldPersonName` of each row in `byName`, derived on the first search. */
  foldedNames?: string[]
  /** The latest search over this list: the next page of it should not filter again. */
  lastSearch?: { folded: string; matches: PeopleList }
}

const peopleLists = new AsyncCache<PeopleList>({
  ttlMs: PEOPLE_CACHE_TTL_MS,
  maxEntries: PEOPLE_CACHE_MAX_ENTRIES,
  maxWeight: PEOPLE_CACHE_MAX_ROWS,
  weigh: (list) => list.byName.length,
})

/** The cache key: one list per audience. */
export const peopleListKey = libraryScopeKey

/**
 * Case folding for a name search. Lowercasing alone is not enough: JavaScript turns
 * Turkish capital I with a dot into `i` plus a combining dot, so "inanir" would miss
 * a name the database matched, and it spells a word-final Greek sigma differently.
 * Accents are kept, so `jose` does not find `José`.
 */
export function foldPersonName(text: string): string {
  return text.toLowerCase().replace(/\u0307/g, '').replace(/ς/g, 'σ')
}

/**
 * The people whose name contains the search, in the list's order. Folding every name
 * is the slow part of a search, so it happens once per list, on the list. Touches
 * nothing outside it.
 */
export function peopleMatching(list: PeopleList, search: string): PeopleList {
  const folded = foldPersonName(search)
  if (list.lastSearch?.folded === folded) return list.lastSearch.matches
  const names = (list.foldedNames ??= list.byName.map((p) => foldPersonName(p.name)))
  const matches = { byName: list.byName.filter((_, i) => names[i].includes(folded)) }
  list.lastSearch = { folded, matches }
  return matches
}

/**
 * `credits DESC, name ASC` without asking the database again: a stable sort keeps
 * the database's own name order among equal counts, so no collation is copied here.
 */
export function orderByCredits(byName: readonly PersonBrowseRow[]): PersonBrowseRow[] {
  return [...byName].sort((a, b) => b.credits - a.credits)
}

/** Pure. One page of a list; past the end is empty, and `total` stays the list's. */
export function peoplePage(
  list: PeopleList,
  sortBy: 'name' | 'credits',
  page: number,
  pageSize: number
): ListPeopleBrowseResult {
  const rows = sortBy === 'credits' ? (list.byCredits ??= orderByCredits(list.byName)) : list.byName
  const offset = (page - 1) * pageSize
  return { people: rows.slice(offset, offset + pageSize), total: rows.length, page, pageSize }
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
  const sortBy = options.sortBy === 'credits' ? 'credits' : 'name'
  const search = options.search?.trim() ?? ''
  const showAll = options.showAll === true
  const scope = options.scope

  const list =
    (scope
      ? await peopleLists.get(peopleListKey(scope), () => loadPeopleList(scope, false))
      : // No scope means no key that could say who this is for, so nothing is shared.
        await loadPeopleList(undefined, showAll)) ?? { byName: [] }

  return peoplePage(search ? peopleMatching(list, search) : list, sortBy, page, pageSize)
}

/** The whole list for one audience, in name order. */
async function loadPeopleList(
  scope: LibraryScope | undefined,
  showAll: boolean
): Promise<PeopleList> {
  const params: unknown[] = []

  let filterByLibrary = false
  if (!scope) {
    const configCheck = await queryOne<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM library_config'
    )
    filterByLibrary = !!configCheck && parseInt(configCheck.count, 10) > 0 && !showAll
  }

  const libMovie = scope
    ? libraryScopeSql(scope, 'm', binderFor(params))
    : filterByLibrary
      ? `EXISTS (
        SELECT 1 FROM library_config lc
        WHERE lc.provider_library_id = m.provider_library_id
        AND lc.is_enabled = true
      )`
      : 'TRUE'

  const libSeries = scope
    ? libraryScopeSql(scope, 's', binderFor(params))
    : filterByLibrary
      ? `EXISTS (
        SELECT 1 FROM library_config lc
        WHERE lc.provider_library_id = s.provider_library_id
        AND lc.is_enabled = true
      )`
      : 'TRUE'

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
)
SELECT name, credits, movie_credits, series_credits
FROM agg
ORDER BY name ASC
`

  const result = await query<{
    name: string
    credits: number
    movie_credits: number
    series_credits: number
  }>(sql, params)

  return {
    byName: result.rows.map((r) => ({
      name: r.name,
      credits: r.credits,
      movieCredits: r.movie_credits,
      seriesCredits: r.series_credits,
    })),
  }
}
