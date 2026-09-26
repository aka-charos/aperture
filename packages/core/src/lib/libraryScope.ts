/**
 * What one viewer may be shown: the libraries the media server lets them see,
 * intersected with the libraries the operator enabled here, plus their parental
 * rating ceiling. The one answer every surface asks.
 *
 * Before this, Aperture read a user's media-server library permission in exactly
 * one place — to ADD their generated library to the folders they may open — and
 * nowhere to decide what they were shown. Recommendations were drawn from every
 * enabled library, so someone blocked from a library on the media server could be
 * recommended its titles, and the generated library (whose files point straight
 * at the originals) let them play them. Browse, search, similar titles and the
 * assistant showed everything too. The operator's own library switch was applied
 * on some of those surfaces and not others, and the parental rating on three.
 *
 * Four rules.
 *
 * 1. **Unknown is unrestricted, because unknown is how it behaved.** An account
 *    whose access has not been read yet (`library_access_synced_at` NULL), and one
 *    the server grants every folder, both store NULL and see every enabled library.
 *    The first user sync or sign-in makes it exact.
 *
 * 2. **The operator's switch narrows, never widens.** A library disabled here is
 *    hidden from everyone, and one the server hides from a person stays hidden
 *    even when it is enabled here. With no library configured at all (a fresh
 *    instance), only the server's permission applies.
 *
 * 3. **Media types follow from the libraries.** `hasMovies`/`hasSeries` say
 *    whether any library of that kind is in scope; everything type-specific —
 *    recommendations, generated libraries, home rows, the watcher identity — asks
 *    them rather than a per-type switch.
 *
 * 4. **The SQL binds its values, and one shape serves every scope.** A NULL list
 *    and a NULL rating mean "no restriction", so a query is written once and the
 *    unrestricted case costs one `IS NULL` test rather than a second query text.
 */

import { query, queryOne, transaction } from './db.js'

export type LibraryKind = 'movies' | 'series'

/** A `library_config` row, reduced to what scope needs. */
export interface ConfiguredLibrary {
  id: string
  collectionType: string
  isEnabled: boolean
}

export interface LibraryScope {
  /** Library ids in scope, or null when nothing restricts them. */
  libraryIds: string[] | null
  /** Parental rating ceiling (a `parental_rating_values.rating_value`), or null. */
  maxParentalRating: number | null
  hasMovies: boolean
  hasSeries: boolean
}

/** The collection type a library of each kind carries on the media server. */
const COLLECTION_TYPE: Record<LibraryKind, string> = {
  movies: 'movies',
  series: 'tvshows',
}

/** Pure. See the module rules. */
export function resolveLibraryScope(input: {
  libraries: readonly ConfiguredLibrary[]
  /** Provider library ids the server lets this account see; null = all. */
  userLibraryIds: readonly string[] | null
  maxParentalRating: number | null
}): LibraryScope {
  const { libraries, userLibraryIds, maxParentalRating } = input

  if (libraries.length === 0) {
    // Nothing configured, so nothing says which library is which kind either.
    // Assume both exist rather than hiding everything from a fresh instance.
    return {
      libraryIds: userLibraryIds ? [...userLibraryIds] : null,
      maxParentalRating,
      hasMovies: true,
      hasSeries: true,
    }
  }

  const allowed = userLibraryIds ? new Set(userLibraryIds) : null
  const visible = libraries.filter((library) => library.isEnabled && (!allowed || allowed.has(library.id)))
  return {
    libraryIds: visible.map((library) => library.id),
    maxParentalRating,
    hasMovies: visible.some((library) => library.collectionType === COLLECTION_TYPE.movies),
    hasSeries: visible.some((library) => library.collectionType === COLLECTION_TYPE.series),
  }
}

/** Whether a kind of title is in scope at all. */
export function scopeHas(scope: LibraryScope, kind: LibraryKind): boolean {
  return kind === 'movies' ? scope.hasMovies : scope.hasSeries
}

/**
 * Translate the media server's per-user folder permission into the provider
 * library ids titles are stored under.
 *
 * The server's permission list names libraries by GUID while titles carry the
 * library's item id, and the two differ on Emby. An unknown GUID is a library
 * this instance has not seen, and is dropped: it cannot contain a title we hold.
 */
export function libraryIdsFromFolderAccess(
  access: { enableAllFolders: boolean; enabledFolders: readonly string[] },
  libraries: ReadonlyArray<{ id: string; guid: string }>
): string[] | null {
  if (access.enableAllFolders) return null
  const allowed = new Set(access.enabledFolders.map((folder) => folder.toLowerCase()))
  return libraries
    .filter((library) => allowed.has(library.guid.toLowerCase()) || allowed.has(library.id.toLowerCase()))
    .map((library) => library.id)
}

/** Adds one value to a query's parameters and returns its placeholder. */
export type BindParam = (value: unknown) => string

/** A `bind` for the common shape: an array of values, placeholders numbered after it. */
export function binderFor(params: unknown[]): BindParam {
  return (value) => {
    params.push(value)
    return `$${params.length}`
  }
}

/**
 * The SQL test that a title is in scope.
 *
 * `alias` is the `movies` or `series` row; an episode is scoped through its
 * series. The parental test matches the recommender's, which it replaces: an
 * unrated title is shown, and a rating name the table does not know reads as 0.
 */
export function libraryScopeSql(scope: LibraryScope, alias: string, bind: BindParam): string {
  const ids = bind(scope.libraryIds)
  const rating = bind(scope.maxParentalRating)
  return `((${ids}::text[] IS NULL OR ${alias}.provider_library_id = ANY(${ids}::text[]))
    AND (${rating}::int IS NULL OR ${alias}.content_rating IS NULL OR COALESCE((
      SELECT prv.rating_value FROM parental_rating_values prv
      WHERE prv.rating_name = ${alias}.content_rating LIMIT 1
    ), 0) <= ${rating}::int))`
}

interface ScopeUserRow {
  library_access: string[] | null
  max_parental_rating: number | null
}

interface LibraryConfigScopeRow {
  provider_library_id: string
  collection_type: string
  is_enabled: boolean
}

/** Every configured library, for callers resolving many users at once. */
export async function loadConfiguredLibraries(): Promise<ConfiguredLibrary[]> {
  const rows = await query<LibraryConfigScopeRow>(
    `SELECT provider_library_id, collection_type, is_enabled FROM library_config`
  )
  return rows.rows.map((row) => ({
    id: row.provider_library_id,
    collectionType: row.collection_type,
    isEnabled: row.is_enabled === true,
  }))
}

/** One user's scope, from the cached permission and the operator's library switches. */
export async function getLibraryScopeForUser(
  userId: string,
  libraries?: readonly ConfiguredLibrary[]
): Promise<LibraryScope> {
  const [user, configured] = await Promise.all([
    queryOne<ScopeUserRow>(`SELECT library_access, max_parental_rating FROM users WHERE id = $1`, [userId]),
    libraries ? Promise.resolve(libraries) : loadConfiguredLibraries(),
  ])
  return resolveLibraryScope({
    libraries: configured,
    userLibraryIds: user?.library_access ?? null,
    maxParentalRating: user?.max_parental_rating ?? null,
  })
}

/**
 * Store one account's library permission as the server reports it. Called by
 * the user sync and at sign-in; a failed read leaves the stored value alone.
 */
export async function saveUserLibraryAccess(userId: string, libraryIds: string[] | null): Promise<void> {
  await query(
    `UPDATE users SET library_access = $2, library_access_synced_at = NOW() WHERE id = $1`,
    [userId, libraryIds]
  )
}

/**
 * How far an HNSW scan walks when a nearest-neighbour query is post-filtered by
 * scope. pgvector returns at most `ef_search` rows (default 40) and applies a
 * WHERE after the scan, so a viewer allowed one small library would get a
 * similar-titles list that is nearly empty rather than one drawn from their
 * libraries. See the ef_search invariant in CLAUDE.md.
 */
export const SCOPED_ANN_EF_SEARCH = 500

/**
 * Run a nearest-neighbour query whose WHERE carries a scope clause. SET LOCAL,
 * inside a transaction, so the wider walk cannot leak onto the pooled
 * connection and change the other vector queries tuned for the default.
 */
export async function scopedAnnQuery<T>(sql: string, params: unknown[]): Promise<{ rows: T[] }> {
  return transaction(async (client) => {
    await client.query(`SET LOCAL hnsw.ef_search = ${SCOPED_ANN_EF_SEARCH}`)
    const result = await client.query(sql, params)
    return { rows: result.rows as T[] }
  })
}
