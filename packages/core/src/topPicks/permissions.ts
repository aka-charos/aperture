/**
 * Top Picks Library Permissions
 *
 * Grants the Top Picks libraries to the accounts allowed to see what is in them.
 *
 * A Top Picks library is one set of files for the whole server, each pointing
 * straight at an original. Adding it to an account's permitted folders therefore
 * hands that account every title in it — including titles from libraries the
 * media server keeps them out of. So an account restricted to some libraries is
 * granted a Top Picks library only when its permission covers EVERY library the
 * current picks come from, and has it taken away again when that stops being
 * true. An account granted every folder needs nothing (F-136).
 */

import { createChildLogger } from '../lib/logger.js'
import { query } from '../lib/db.js'
import { libraryIdsFromFolderAccess, loadConfiguredLibraries } from '../lib/libraryScope.js'
import { getMediaServerProvider } from '../media/index.js'
import { getMediaServerApiKey, getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { getTopPicksConfig } from './config.js'

const logger = createChildLogger('top-picks-permissions')

interface LibraryInfo {
  id: string
  guid: string
  name: string
}

/**
 * The provider libraries a set of titles comes from — what an account must be
 * allowed to open before a library holding those titles may be granted to it.
 */
export async function sourceLibraryIdsFor(
  table: 'movies' | 'series',
  ids: readonly string[]
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await query<{ provider_library_id: string | null }>(
    `SELECT DISTINCT provider_library_id FROM ${table} WHERE id = ANY($1)`,
    [ids]
  )
  return rows.rows.map((row) => row.provider_library_id).filter((id): id is string => !!id)
}

/** Whether a permission covers every source library (pure). */
export function coversSources(allowedLibraryIds: readonly string[], sourceLibraryIds: readonly string[]): boolean {
  const allowed = new Set(allowedLibraryIds)
  return sourceLibraryIds.every((id) => allowed.has(id))
}

/**
 * Grant the Top Picks libraries to every account allowed to see what is in them,
 * and withdraw them from any account that is not (see the module note).
 */
export async function grantTopPicksAccessToAllUsers(
  moviesLibrary: LibraryInfo | null,
  seriesLibrary: LibraryInfo | null,
  /** Provider library ids each Top Picks library's titles come from. */
  sources: { movies: string[]; series: string[] } = { movies: [], series: [] },
  /**
   * Only take access away, never give it or touch sort preferences. For a
   * FROZEN Top Picks library (legacy output switched off): nothing may be added
   * to it or handed out, but an account whose permission narrowed must still
   * lose it, since it plays the original files.
   */
  options: { withdrawOnly?: boolean } = {}
): Promise<{ updated: number; failed: number; alreadyHadAccess: number; hasAllFolders: number; withheld: number }> {
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()

  if (!apiKey) {
    throw new Error('MEDIA_SERVER_API_KEY environment variable is required')
  }

  // Get all users from the media server
  const mediaServerUsers = await provider.getUsers(apiKey)
  
  logger.info({ 
    userCount: mediaServerUsers.length,
    moviesLibrary: moviesLibrary?.name,
    seriesLibrary: seriesLibrary?.name,
  }, 'Granting Top Picks access to all users')

  let updated = 0
  let alreadyHadAccess = 0
  let hasAllFolders = 0
  let failed = 0
  let withheld = 0

  // Folder permissions name libraries by GUID; titles carry the item id.
  const serverLibraries = await provider.getLibraries(apiKey)

  for (const user of mediaServerUsers) {
    try {
      // Get user's current library access
      const currentAccess = await provider.getUserLibraryAccess(apiKey, user.id)
      
      // If user has access to all folders, no need to update
      if (currentAccess.enableAllFolders) {
        logger.debug({ userId: user.id, username: user.name }, 'User has access to all folders, skipping permission update')
        hasAllFolders++
        if (options.withdrawOnly) continue
        // Still set sort preferences for users with all folder access
        if (moviesLibrary?.id) {
          await provider.setLibrarySortPreference(apiKey, user.id, moviesLibrary.id)
        }
        if (seriesLibrary?.id) {
          await provider.setLibrarySortPreference(apiKey, user.id, seriesLibrary.id)
        }
        continue
      }

      // Add each Top Picks library the account may see into, and take away one
      // it may not — its titles come from a library the server keeps it out of.
      const allowed = libraryIdsFromFolderAccess(currentAccess, serverLibraries)
      if (allowed === undefined) {
        // Could not read this account's permission (see libraryIdsFromFolderAccess):
        // leave its folders exactly as they are rather than add or take anything.
        logger.warn({ userId: user.id, username: user.name }, 'Permitted folders matched no library; Top Picks access left unchanged')
        failed++
        continue
      }
      const newEnabledFolders = new Set(currentAccess.enabledFolders)
      let withheldHere = false
      for (const [library, source] of [
        [moviesLibrary, sources.movies],
        [seriesLibrary, sources.series],
      ] as const) {
        if (!library?.guid) continue
        if (coversSources(allowed ?? [], source)) {
          if (!options.withdrawOnly) newEnabledFolders.add(library.guid)
        } else {
          newEnabledFolders.delete(library.guid)
          withheldHere = true
        }
      }
      if (withheldHere) {
        withheld++
        logger.info(
          { userId: user.id, username: user.name },
          'Top Picks library withheld: it holds titles from a library this account may not open'
        )
      }

      // Update user's library access if there are changes
      const needsUpdate = newEnabledFolders.size !== currentAccess.enabledFolders.length ||
          !currentAccess.enabledFolders.every(f => newEnabledFolders.has(f))
      
      if (needsUpdate) {
        await provider.updateUserLibraryAccess(
          apiKey,
          user.id,
          Array.from(newEnabledFolders)
        )
        logger.info({ userId: user.id, username: user.name }, 'Updated library access for user')
        updated++
      } else {
        alreadyHadAccess++
      }

      if (options.withdrawOnly) continue

      // Set sort preferences for Top Picks libraries (DateCreated descending)
      if (moviesLibrary?.id) {
        await provider.setLibrarySortPreference(apiKey, user.id, moviesLibrary.id)
      }
      if (seriesLibrary?.id) {
        await provider.setLibrarySortPreference(apiKey, user.id, seriesLibrary.id)
      }
    } catch (err) {
      logger.error({ err, userId: user.id, username: user.name }, 'Failed to update library access')
      failed++
    }
  }

  logger.info({ 
    updated, 
    alreadyHadAccess, 
    hasAllFolders, 
    failed,
    total: mediaServerUsers.length 
  }, 'Top Picks access grant completed')
  
  return { updated, failed, alreadyHadAccess, hasAllFolders, withheld }
}

const WRITTEN_SOURCES_SETTING = 'top_picks_written_sources'

/**
 * Record which libraries the Top Picks titles just written come from, so a
 * frozen Top Picks library can later be withdrawn from an account that may no
 * longer open them (`withdrawFrozenTopPicksAccess`).
 */
export async function recordTopPicksSources(sources: { movies: string[]; series: string[] }): Promise<void> {
  await setSystemSetting(
    WRITTEN_SOURCES_SETTING,
    JSON.stringify({ movies: sources.movies, series: sources.series }),
    'Libraries the titles in the Top Picks libraries were last written from'
  )
}

async function readTopPicksSources(): Promise<{ movies: string[]; series: string[] } | null> {
  const raw = await getSystemSetting(WRITTEN_SOURCES_SETTING)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { movies?: unknown; series?: unknown }
    const ids = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null)
    const movies = ids(parsed.movies)
    const series = ids(parsed.series)
    return movies && series ? { movies, series } : null
  } catch {
    return null
  }
}

/**
 * While legacy library output is switched off, the Top Picks libraries are
 * frozen and nothing re-grants them — but an account whose permission has
 * narrowed must still lose one that holds titles from a library it may no
 * longer open (F-136, F-142). Withdraw-only: nothing is granted.
 *
 * Every recorded Top Picks library is checked, not just the one under the
 * current name, since a renamed library stays behind with its old picks. With
 * no record of where the titles came from, every library of that kind is
 * assumed — so only an account that can open all of them keeps it.
 */
export async function withdrawFrozenTopPicksAccess(): Promise<{ withdrawn: number; failed: number }> {
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()
  if (!apiKey) return { withdrawn: 0, failed: 0 }

  const rows = await query<{ name: string; provider_library_id: string | null; media_type: string | null }>(
    `SELECT name, provider_library_id, media_type FROM strm_libraries WHERE user_id IS NULL AND channel_id IS NULL`
  )
  if (rows.rows.length === 0) return { withdrawn: 0, failed: 0 }

  const serverLibraries = await provider.getLibraries(apiKey)
  const byId = new Map(serverLibraries.map((lib) => [lib.id, lib]))
  const byName = new Map(serverLibraries.map((lib) => [lib.name, lib]))

  let sources = await readTopPicksSources()
  if (!sources) {
    const configured = await loadConfiguredLibraries()
    sources = {
      movies: configured.filter((lib) => lib.collectionType === 'movies').map((lib) => lib.id),
      series: configured.filter((lib) => lib.collectionType === 'tvshows').map((lib) => lib.id),
    }
  }

  let withdrawn = 0
  let failed = 0
  for (const row of rows.rows) {
    const library = (row.provider_library_id ? byId.get(row.provider_library_id) : undefined) ?? byName.get(row.name)
    if (!library) continue
    const info = { id: library.id, guid: library.guid, name: library.name }
    const isSeries = row.media_type === 'series'
    const result = await grantTopPicksAccessToAllUsers(isSeries ? null : info, isSeries ? info : null, sources, {
      withdrawOnly: true,
    })
    withdrawn += result.updated
    failed += result.failed
  }
  return { withdrawn, failed }
}

/**
 * Get the Top Picks libraries from the media server
 * Uses the configured library names from the database
 */
export async function getTopPicksLibraries(): Promise<{
  movies: LibraryInfo | null
  series: LibraryInfo | null
}> {
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()

  if (!apiKey) {
    throw new Error('MEDIA_SERVER_API_KEY environment variable is required')
  }

  // Get the configured library names from the database
  const config = await getTopPicksConfig()
  const { moviesLibraryName, seriesLibraryName } = config

  const libraries = await provider.getLibraries(apiKey)
  
  // Find libraries by exact name match (configured names)
  const moviesLibrary = libraries.find(lib => lib.name === moviesLibraryName && lib.collectionType === 'movies')
  const seriesLibrary = libraries.find(lib => lib.name === seriesLibraryName && lib.collectionType === 'tvshows')

  logger.debug({
    configuredMoviesName: moviesLibraryName,
    configuredSeriesName: seriesLibraryName,
    foundMovies: moviesLibrary?.name,
    foundSeries: seriesLibrary?.name,
  }, 'Looking for Top Picks libraries')

  return {
    movies: moviesLibrary ? { id: moviesLibrary.id, guid: moviesLibrary.guid, name: moviesLibrary.name } : null,
    series: seriesLibrary ? { id: seriesLibrary.id, guid: seriesLibrary.guid, name: seriesLibrary.name } : null,
  }
}

