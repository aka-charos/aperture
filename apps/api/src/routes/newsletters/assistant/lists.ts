/**
 * The newsletter assistant's list rules, apart from the database. Pure.
 *
 * `tools.ts` runs the queries; what they mean lives here, so it can be tested
 * without a database: which titles a library brought with its first import,
 * how two media types merge into one list of at most `limit`, and how an
 * earlier issue is dated.
 */
import { displayRatingSql, libraryScopeSql, binderFor, type LibraryScope } from '@aperture/core'

/** How long after a library's first row its titles still count as its first import. */
export const IMPORT_GRACE = `interval '1 day'`

/** The most titles one list may return. Interpolated into SQL, so it is held to this range. */
export const MAX_LIST_LIMIT = 40

export function listCap(limit: number): number {
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : 1)))
}

export const TITLE_COLUMNS = (alias: string) =>
  `${alias}.id, ${alias}.title, ${alias}.year, ${alias}.poster_url, ${alias}.provider_item_id, ${alias}.overview,
   ${alias}.genres, ${displayRatingSql(alias)} AS community_rating`

/** `EXISTS` over a title's genres, case-insensitive; the pattern is the bound value, never the array. */
export function genreClause(alias: string, genre: string | undefined, params: unknown[]): string {
  if (!genre?.trim()) return 'TRUE'
  params.push(genre.trim())
  return `EXISTS (SELECT 1 FROM unnest(${alias}.genres) g WHERE g ILIKE $${params.length})`
}

/**
 * `created_at` is when the app first saw a row, so a library's first import
 * reads as one huge arrival. A row first seen within {@link IMPORT_GRACE} of
 * its library's first row is that import, not news. One definition, used by
 * every recently-added query: `imports` is the CTE, `afterImport` the test.
 */
const importsCte = (table: 'movies' | 'series') =>
  `imports AS (
     SELECT provider_library_id, MIN(created_at) + ${IMPORT_GRACE} AS import_end
       FROM ${table} GROUP BY provider_library_id
   )`
const importJoin = (alias: string, importAlias: string) =>
  `JOIN imports ${importAlias} ON ${importAlias}.provider_library_id IS NOT DISTINCT FROM ${alias}.provider_library_id`
const afterImport = (alias: string, importAlias: string) => `${alias}.created_at > ${importAlias}.import_end`
/** `$1` is always the window in days. */
const withinDays = (alias: string) => `${alias}.created_at >= NOW() - make_interval(days => $1::int)`

/**
 * One query per media type: the newest titles past their library's import,
 * and, on every row (or on a lone row of NULL titles when none qualify), how
 * many in the window were left out as import and when that import ended. The
 * imports are grouped once per query.
 */
export interface RecentlyAddedQuery {
  sql: string
  params: unknown[]
}

export function recentMoviesQuery(input: {
  days: number
  genre?: string
  scope: LibraryScope
  limit: number
}): RecentlyAddedQuery {
  const params: unknown[] = [input.days]
  const genreSql = genreClause('m', input.genre, params)
  const inScope = libraryScopeSql(input.scope, 'm', binderFor(params))
  const sql = `WITH ${importsCte('movies')},
     window_rows AS (
       SELECT ${TITLE_COLUMNS('m')}, m.created_at, i.import_end, ${afterImport('m', 'i')} AS fresh
         FROM movies m ${importJoin('m', 'i')}
        WHERE ${withinDays('m')} AND ${genreSql} AND ${inScope}
     ),
     summary AS (
       SELECT COUNT(*) FILTER (WHERE NOT fresh)::int AS skipped,
              MAX(import_end) FILTER (WHERE NOT fresh) AS import_until
         FROM window_rows
     ),
     picked AS (
       SELECT * FROM window_rows WHERE fresh ORDER BY created_at DESC, id LIMIT ${listCap(input.limit)}
     )
     SELECT s.skipped, s.import_until, p.*, p.created_at AS latest
       FROM summary s LEFT JOIN picked p ON TRUE
      ORDER BY p.created_at DESC NULLS LAST, p.id`
  return { sql, params }
}

/**
 * Shows that are new, or that got new episodes (specials, season 0, are not
 * episodes anyone is waiting for). An episode that came with its library's
 * first import is not new either. A show from the import that is listed for
 * new episodes is not counted as left out.
 */
export function recentSeriesQuery(input: {
  days: number
  genre?: string
  scope: LibraryScope
  limit: number
}): RecentlyAddedQuery {
  const params: unknown[] = [input.days]
  const genreSql = genreClause('s', input.genre, params)
  const inScope = libraryScopeSql(input.scope, 's', binderFor(params))
  const sql = `WITH ${importsCte('series')},
     fresh_episodes AS (
       SELECT e.series_id, COUNT(*)::int AS new_episodes, MAX(e.created_at) AS latest
         FROM episodes e
         JOIN series es ON es.id = e.series_id
         ${importJoin('es', 'ei')}
        WHERE ${withinDays('e')} AND e.season_number > 0 AND ${afterImport('e', 'ei')}
        GROUP BY e.series_id
     ),
     window_rows AS (
       SELECT ${TITLE_COLUMNS('s')}, s.created_at, i.import_end, f.new_episodes,
              (${withinDays('s')} AND ${afterImport('s', 'i')}) AS is_new,
              (${withinDays('s')} AND NOT ${afterImport('s', 'i')} AND f.series_id IS NULL) AS from_import,
              GREATEST(CASE WHEN ${afterImport('s', 'i')} THEN s.created_at END, f.latest) AS latest
         FROM series s ${importJoin('s', 'i')}
         LEFT JOIN fresh_episodes f ON f.series_id = s.id
        WHERE (${withinDays('s')} OR f.series_id IS NOT NULL) AND ${genreSql} AND ${inScope}
     ),
     summary AS (
       SELECT COUNT(*) FILTER (WHERE from_import)::int AS skipped,
              MAX(import_end) FILTER (WHERE from_import) AS import_until
         FROM window_rows
     ),
     picked AS (
       SELECT * FROM window_rows WHERE is_new OR new_episodes IS NOT NULL
        ORDER BY latest DESC, id LIMIT ${listCap(input.limit)}
     )
     SELECT s.skipped, s.import_until, p.*
       FROM summary s LEFT JOIN picked p ON TRUE
      ORDER BY p.latest DESC NULLS LAST, p.id`
  return { sql, params }
}

/** What the model is told about a recently-added list beside its titles. */
export function recentlyAddedNote(input: {
  days: number
  count: number
  skipped: number
  importUntil: Date | null
}): string | null {
  const notes: string[] = []
  if (input.count === 0) notes.push(`Nothing was added in the last ${input.days} days.`)
  if (input.skipped > 0 && input.importUntil) {
    notes.push(
      `${input.skipped} titles first seen when their library was imported (until ${input.importUntil
        .toISOString()
        .slice(0, 10)}) are left out: they were already there, not newly added.`
    )
  }
  return notes.length > 0 ? notes.join(' ') : null
}

/**
 * Two media types' lists as one, best first by `score`, at most `limit` long,
 * whichever kinds were asked for. Stable: entries tied on score keep the order
 * they were given in (each list is already in its query's order).
 */
export function mergeRanked<T>(entries: readonly { score: number; item: T }[], limit: number): T[] {
  return entries
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, listCap(limit))
    .map((entry) => entry.item)
}

interface IssueDates {
  sentCount: number
  sentAt: string | null
  sendStartedAt: string | null
  updatedAt: string
}

/**
 * When an issue reached people. A send that failed partway has no `sentAt`
 * but its readers have seen those titles, so it is dated by when sending
 * started (`updatedAt` only as a last resort).
 */
export function issueSentOn(issue: Omit<IssueDates, 'sentCount'>): string {
  return issue.sentAt ?? issue.sendStartedAt ?? issue.updatedAt
}

/** The newest `count` issues that reached anyone, newest first. ISO strings sort as dates. */
export function sentIssues<T extends IssueDates>(issues: readonly T[], count: number): T[] {
  return issues
    .filter((issue) => issue.sentCount > 0)
    .sort((a, b) => issueSentOn(b).localeCompare(issueSentOn(a)))
    .slice(0, count)
}
