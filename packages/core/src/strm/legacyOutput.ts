/**
 * Legacy library output: the switch, the guard every writer calls, and the job
 * that removes what was written. The decisions themselves are in
 * `legacyOutputRules.ts`, which has no DB and is pinned by a test.
 */

import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getMediaServerProvider } from '../media/index.js'
import type { MediaServerProvider } from '../media/MediaServerProvider.js'
import type { Library } from '../media/types.js'
import { getTopPicksConfig } from '../topPicks/config.js'
import {
  getMediaServerApiKey,
  getSystemSetting,
  setSystemSetting,
} from '../settings/systemSettings.js'
import {
  addLog,
  completeJob,
  createJobProgress,
  failJob,
  getAllJobProgress,
  isJobCancelled,
  setJobStep,
  updateJobProgress,
} from '../jobs/progress.js'
import { getConfig } from './config.js'
import {
  LEGACY_LIBRARY_JOBS,
  LEGACY_LIBRARY_OUTPUT_SETTING,
  OUTPUT_SUBFOLDERS,
  REMOVE_LEGACY_LIBRARIES_JOB,
  generatedLocationSegments,
  isDisposableTopPicksContainer,
  parseLegacyLibraryOutputSetting,
  personalOutputFolders,
  personalOutputRoot,
  planGeneratedLibraryRemoval,
  rowOwnsLibrary,
  sharedOutputFolder,
  type GeneratedLibraryRow,
} from './legacyOutputRules.js'

const logger = createChildLogger('legacy-library-output')

/** Whether Aperture may write STRM/symlink libraries at all. Absent reads as on. */
export async function isLegacyLibraryOutputEnabled(): Promise<boolean> {
  return parseLegacyLibraryOutputSetting(await getSystemSetting(LEGACY_LIBRARY_OUTPUT_SETTING))
}

export async function setLegacyLibraryOutputEnabled(enabled: boolean): Promise<boolean> {
  await setSystemSetting(
    LEGACY_LIBRARY_OUTPUT_SETTING,
    String(enabled),
    'Write per-viewer AI Picks and Top Picks libraries as STRM files or symlinks (legacy; Emby home rows replace it)'
  )
  return isLegacyLibraryOutputEnabled()
}

/** What a log line, a job result and a refused request say. One sentence, one place. */
export const LEGACY_LIBRARY_OUTPUT_OFF_MESSAGE =
  'Legacy library output is switched off (Admin → Recommendations → Output format), so no STRM or symlink libraries are written. Recommendations and Top Picks reach viewers as Emby home rows instead.'

export class LegacyLibraryOutputDisabledError extends Error {
  readonly code = 'LEGACY_LIBRARY_OUTPUT_DISABLED'
  constructor() {
    super(LEGACY_LIBRARY_OUTPUT_OFF_MESSAGE)
    this.name = 'LegacyLibraryOutputDisabledError'
  }
}

/**
 * A viewer's library name is taken by a library that is not theirs. The
 * writers used to ADOPT any library carrying the name they asked for, and
 * then grant it to the viewer — so a viewer who named their AI Picks library
 * after one the media server hides from them was given access to it. Nothing
 * is adopted, recorded or granted now; the viewer's library is skipped until
 * the name is changed.
 */
export class LibraryNameTakenError extends Error {
  readonly code = 'LIBRARY_NAME_TAKEN'
  constructor(name: string, locations: readonly string[] | undefined) {
    super(
      `The library name "${name}" already belongs to a library that does not read this viewer's own folder (it reads ${locations?.length ? locations.join(', ') : 'other folders'}), so it was not used and nothing was granted. Give this viewer's library another name, or rename that library. If an earlier sync gave the viewer access to it, check their library access in the media server.`
    )
    this.name = 'LibraryNameTakenError'
  }
}

/**
 * Called at the top of every function that writes a library file or creates a
 * virtual library. The jobs check the switch first and exit cleanly; this is
 * what stops any OTHER caller — a per-user route, a future job — from writing
 * one anyway, since a guard only the jobs ask is a convention, not a rule.
 */
export async function assertLegacyLibraryOutputEnabled(): Promise<void> {
  if (!(await isLegacyLibraryOutputEnabled())) {
    throw new LegacyLibraryOutputDisabledError()
  }
}

/**
 * The early exit every legacy job takes when the output is off: the run is
 * recorded, with the reason in its log, rather than skipped silently — a
 * scheduled job that stops appearing in the history reads as broken.
 *
 * `upkeep` is what a frozen library still needs: the delete-only half of the
 * job. Frozen means nothing is WRITTEN, not that permissions stop applying —
 * these libraries play the original files, so a viewer whose access narrowed
 * must still lose one (F-136). A failed upkeep is logged, never thrown: the
 * next firing retries, and failing the run would read as the output breaking.
 */
export async function skipIfLegacyLibraryOutputOff(
  jobId: string,
  upkeep?: () => Promise<void>
): Promise<boolean> {
  if (await isLegacyLibraryOutputEnabled()) return false
  addLog(jobId, 'info', `⏭️ ${LEGACY_LIBRARY_OUTPUT_OFF_MESSAGE}`)
  addLog(
    jobId,
    'info',
    upkeep
      ? 'Nothing was written. Libraries already in the media server are only checked against current permissions: one its owner may no longer fully open is removed.'
      : 'Nothing was written, and libraries already in the media server keep their contents.'
  )
  if (upkeep) {
    try {
      await upkeep()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ err, jobId }, 'Upkeep of frozen legacy libraries failed')
      addLog(jobId, 'warn', `Could not check the frozen libraries against current permissions: ${message}`)
    }
  }
  completeJob(jobId, { skipped: true, reason: 'legacyLibraryOutputOff' })
  return true
}

/**
 * Record the scope a viewer's library was just written under, so that while
 * the output is frozen it can be removed once its owner may no longer open
 * everything it holds (`frozenLibraryStillPermitted`). Called by both writers
 * after writing; a separate table because `strm_libraries` rows are deleted
 * and re-inserted by every sync.
 */
export async function recordWrittenScope(
  userId: string,
  mediaType: 'movies' | 'series',
  scope: { libraryIds: string[] | null; maxParentalRating: number | null }
): Promise<void> {
  await query(
    `INSERT INTO strm_library_scopes (user_id, media_type, library_ids, max_parental_rating, written_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, media_type) DO UPDATE SET
       library_ids = EXCLUDED.library_ids,
       max_parental_rating = EXCLUDED.max_parental_rating,
       written_at = NOW()`,
    [userId, mediaType, scope.libraryIds, scope.maxParentalRating]
  )
}

/**
 * A viewer's library is renamed by making a new one under the new name, so the
 * one under the old name is removed here — but only when it provably reads
 * this viewer's own folder (`rowOwnsLibrary`). The writers ADOPT any library
 * with the name they ask for, and a viewer chooses that name, so the old
 * record can point at the operator's "Movies" or at another viewer's library;
 * deleting it by name alone let a viewer delete either by naming their library
 * after it and then renaming it. A library that does not say where it reads
 * is left too — nothing proves it ours. Never throws: a left-behind library of
 * ours is found later by the removal job, by the folder it reads.
 */
export async function removeRenamedPersonalLibrary(input: {
  provider: MediaServerProvider
  apiKey: string
  userId: string
  providerUserId: string
  mediaType: 'movies' | 'series'
  old: { name: string; providerLibraryId: string | null }
  newName: string
}): Promise<void> {
  const { provider, apiKey, userId, providerUserId, mediaType, old, newName } = input
  try {
    const libraries = await provider.getLibraries(apiKey)
    const library =
      (old.providerLibraryId ? libraries.find((lib) => lib.id === old.providerLibraryId) : undefined) ??
      libraries.find((lib) => lib.name === old.name)
    // Gone already, or it now carries the NEW name (renamed by hand in the
    // media server) and is the very library this sync is about to use.
    if (!library || library.name === newName) return

    const owned = rowOwnsLibrary(
      { userId, channelId: null, mediaType, ownerProviderUserId: providerUserId },
      { id: library.id, name: library.name, locations: library.locations }
    )
    if (owned !== true) {
      logger.warn(
        { userId, oldName: library.name, locations: library.locations },
        owned === false
          ? 'Library under the old name kept: it does not read this viewer\'s own folder'
          : 'Library under the old name kept: the media server did not say which folders it reads'
      )
      return
    }
    await provider.deleteVirtualLibrary(apiKey, library.name)
    logger.info({ userId, mediaType, oldName: library.name }, 'Library under the old name removed')
  } catch (err) {
    logger.warn({ err, userId, mediaType, oldName: old.name }, 'Could not remove the library under its old name')
  }
}

export interface GeneratedLibraryCounts {
  total: number
  /** Per-viewer AI Picks libraries, movies and series. */
  personal: number
  /** The shared Top Picks libraries. */
  topPicks: number
  /** Pinned-channel libraries, from versions that wrote them. */
  channels: number
}

export async function countGeneratedLibraries(): Promise<GeneratedLibraryCounts> {
  const result = await query<{ personal: string; top_picks: string; channels: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE user_id IS NOT NULL AND channel_id IS NULL) AS personal,
       COUNT(*) FILTER (WHERE user_id IS NULL AND channel_id IS NULL) AS top_picks,
       COUNT(*) FILTER (WHERE channel_id IS NOT NULL) AS channels
     FROM strm_libraries`
  )
  const row = result.rows[0]
  const personal = Number(row?.personal ?? 0)
  const topPicks = Number(row?.top_picks ?? 0)
  const channels = Number(row?.channels ?? 0)
  return { total: personal + topPicks + channels, personal, topPicks, channels }
}

export interface RemoveGeneratedLibrariesResult {
  /** Recorded libraries deleted from the media server. */
  removed: number
  /**
   * Libraries with no record, found by the folders they read and deleted —
   * every library a title-template rename left behind is one of these.
   */
  orphansRemoved: number
  /** Rows whose library had already gone from the server; only the row was cleared. */
  alreadyGone: number
  /** Libraries the media server refused to delete; their rows are KEPT. */
  failed: number
  /** Recorded libraries left alone because they read folders their record's writer never writes. */
  refused: number
  /** Top Picks collections and playlists deleted. */
  containersRemoved: number
  /** Top Picks-named collections and playlists kept because they hold other titles. */
  containersKept: number
  /** Output folders deleted from disk. */
  foldersRemoved: number
  /** Whether the whole output tree under /aperture-libraries was cleared at the end. */
  outputCleared: boolean
  cancelled: boolean
  [key: string]: unknown
}

interface RemovalRow {
  id: string
  user_id: string | null
  channel_id: string | null
  name: string
  media_type: string | null
  provider_library_id: string | null
  provider_user_id: string | null
}

/**
 * Remove everything legacy output made: every library in the media server —
 * recorded or left behind by a rename — its folder under /aperture-libraries
 * and its `strm_libraries` row, plus the Top Picks collections and playlists.
 *
 * Refuses while the output is still on, or while a legacy job is mid-run —
 * either would write the libraries straight back.
 *
 * A row is cleared ONLY when its library is gone from the server. Those rows
 * are what keeps an Aperture library out of the ordinary library list
 * (`getLibraryConfigs(true)`, `getUserAccessibleLibraries`); clearing one whose
 * delete failed would turn a generated library into a "real" one the next
 * library sync offers for recommendations. So a failed delete keeps its row and
 * its files, and the job can simply be run again.
 *
 * The order is load-bearing: the Top Picks collections and playlists go FIRST,
 * while the Top Picks libraries still exist, because what they hold is the only
 * evidence they are ours (`isDisposableTopPicksContainer`).
 */
export async function removeGeneratedLibraries(
  existingJobId?: string
): Promise<RemoveGeneratedLibrariesResult> {
  const jobId = existingJobId || randomUUID()
  createJobProgress(jobId, REMOVE_LEGACY_LIBRARIES_JOB, 4)

  const result: RemoveGeneratedLibrariesResult = {
    removed: 0,
    orphansRemoved: 0,
    alreadyGone: 0,
    failed: 0,
    refused: 0,
    containersRemoved: 0,
    containersKept: 0,
    foldersRemoved: 0,
    outputCleared: false,
    cancelled: false,
  }

  const refuse = (message: string): never => {
    addLog(jobId, 'error', `❌ ${message}`)
    failJob(jobId, message)
    throw new Error(message)
  }

  try {
    setJobStep(jobId, 0, 'Checking it is safe to remove')

    if (await isLegacyLibraryOutputEnabled()) {
      refuse(
        'Legacy library output is still switched on. Switch it off first (Admin → Recommendations → Output format) — while it is on, the next library sync would rebuild everything this removes.'
      )
    }

    const busy = getAllJobProgress().filter(
      (p) =>
        (LEGACY_LIBRARY_JOBS as readonly string[]).includes(p.jobName) &&
        (p.status === 'running' || p.status === 'cancelled')
    )
    if (busy.length > 0) {
      refuse(
        `Wait for ${busy.map((p) => p.jobName).join(', ')} to finish — it started before the output was switched off and may still be writing.`
      )
    }

    const apiKey = await getMediaServerApiKey()
    if (!apiKey) {
      // Without the server there is no way to delete a library, and clearing
      // its row alone would stop excluding it from the library sync.
      refuse('The media server is not configured, so no library can be removed from it.')
    }
    const key = apiKey as string

    const provider = await getMediaServerProvider()
    const { strmRoot, libraryPathPrefix } = await getConfig()
    const serverLibraries = await provider.getLibraries(key)

    const rows = (
      await query<RemovalRow>(
        `SELECT sl.id, sl.user_id, sl.channel_id, sl.name, sl.media_type,
                sl.provider_library_id, u.provider_user_id
         FROM strm_libraries sl
         LEFT JOIN users u ON u.id = sl.user_id`
      )
    ).rows

    const plan = planGeneratedLibraryRemoval(
      rows.map(
        (r): GeneratedLibraryRow => ({
          id: r.id,
          userId: r.user_id,
          channelId: r.channel_id,
          name: r.name,
          mediaType: r.media_type ?? 'movies',
          providerLibraryId: r.provider_library_id,
          ownerProviderUserId: r.provider_user_id,
        })
      ),
      serverLibraries.map((lib) => ({ id: lib.id, name: lib.name, locations: lib.locations })),
      libraryPathPrefix
    )
    const orphanCount = plan.deletions.filter((d) => d.orphan).length
    for (const kept of plan.refused) {
      result.refused++
      addLog(
        jobId,
        'warn',
        `Kept "${kept.serverName}": it reads ${kept.locations.join(', ')}, not the folder its record writes, so it may be one of your own libraries that a generated library was named after. Its record is kept too.`
      )
    }

    addLog(
      jobId,
      'info',
      `📚 ${rows.length} generated librar${rows.length === 1 ? 'y' : 'ies'} recorded (${plan.alreadyGone.length} already gone from the media server); ${orphanCount} more found with no record, reading from ${libraryPathPrefix}.`
    )

    // Step 1: the Top Picks collections and playlists, while the Top Picks
    // libraries still exist to prove which ones are ours.
    setJobStep(jobId, 1, 'Removing the Top Picks collections and playlists')
    // Only rows whose library is ours may vouch for a container: a refused row
    // points at a library that may be the operator's, and a collection holding
    // that library's titles is not proven to be the Top Picks one by it.
    const refusedRowIds = new Set(plan.refused.flatMap((kept) => kept.rowIds))
    const containers = await removeTopPicksContainers(
      jobId,
      provider,
      key,
      rows.filter((r) => !refusedRowIds.has(r.id)),
      serverLibraries
    )
    result.containersRemoved = containers.removed
    result.containersKept = containers.kept

    // Step 2: the media server. Rows are cleared as each delete lands, so a
    // cancel or a crash part-way leaves a list that is still true.
    setJobStep(jobId, 2, 'Removing libraries from the media server', plan.deletions.length)
    const clearedRowIds = new Set<string>(plan.alreadyGone)
    const removedFolders: string[][] = []
    // Folders a library that STAYS still reads. A renamed viewer's old and new
    // libraries read one folder, so deleting the old one's folder after the new
    // one refused to go would empty a library the log says was kept.
    const keptFolders: string[][] = []
    for (const kept of plan.refused) {
      for (const location of kept.locations) {
        const segments = generatedLocationSegments(location, libraryPathPrefix)
        if (segments) keptFolders.push(segments)
      }
    }
    if (plan.alreadyGone.length > 0) {
      await query(`DELETE FROM strm_libraries WHERE id = ANY($1::uuid[])`, [plan.alreadyGone])
      result.alreadyGone = plan.alreadyGone.length
    }

    for (let i = 0; i < plan.deletions.length; i++) {
      if (isJobCancelled(jobId)) {
        result.cancelled = true
        addLog(jobId, 'warn', '🛑 Cancelled — libraries not yet removed are left as they were.')
        break
      }
      const { serverName, rowIds, orphan, folders } = plan.deletions[i]
      try {
        await provider.deleteVirtualLibrary(key, serverName)
        if (rowIds.length > 0) {
          await query(`DELETE FROM strm_libraries WHERE id = ANY($1::uuid[])`, [rowIds])
        }
        for (const id of rowIds) clearedRowIds.add(id)
        removedFolders.push(...folders)
        if (orphan) {
          result.orphansRemoved++
          addLog(jobId, 'info', `🗑️ Removed "${serverName}" from the media server (no record — left behind by an earlier rename)`)
        } else {
          result.removed++
          addLog(jobId, 'info', `🗑️ Removed "${serverName}" from the media server`)
        }
      } catch (err) {
        result.failed++
        keptFolders.push(...folders)
        const message = err instanceof Error ? err.message : String(err)
        logger.warn({ err, serverName }, 'Failed to delete generated library')
        addLog(jobId, 'error', `❌ Could not remove "${serverName}": ${message} — its record and files are kept`)
      }
      updateJobProgress(jobId, i + 1, plan.deletions.length, `${i + 1}/${plan.deletions.length} libraries`)
    }

    // Step 3: the files, for exactly the libraries that are gone — and, once
    // nothing at all is left, the rest of the output tree.
    setJobStep(jobId, 3, 'Removing output folders')
    const root = path.resolve(strmRoot)
    const keptRows = rows.filter((r) => !clearedRowIds.has(r.id))
    result.foldersRemoved = await removeOutputFolders(
      jobId,
      root,
      rows.filter((r) => clearedRowIds.has(r.id)),
      removedFolders,
      new Set([
        ...keptFolders.map((segments) => path.join(root, ...segments)),
        ...(await rowFolders(root, keptRows)),
      ])
    )

    // Their scope records describe libraries that no longer exist.
    const clearedPersonal = rows.filter((r) => clearedRowIds.has(r.id) && r.user_id && !r.channel_id)
    for (const r of clearedPersonal) {
      await query(`DELETE FROM strm_library_scopes WHERE user_id = $1 AND media_type = $2`, [
        r.user_id,
        r.media_type ?? 'movies',
      ])
    }

    if (!result.cancelled && result.failed === 0) {
      const remaining = await query<{ n: string }>(`SELECT COUNT(*) AS n FROM strm_libraries`)
      if (Number(remaining.rows[0]?.n ?? 0) === 0) {
        result.foldersRemoved += await clearOutputTree(jobId, root)
        result.outputCleared = true
        // Nothing is left for a scope record to describe.
        await query(`DELETE FROM strm_library_scopes`)
      }
    }

    const parts = [
      `removed ${result.removed + result.orphansRemoved} librar${result.removed + result.orphansRemoved === 1 ? 'y' : 'ies'} (${result.orphansRemoved} with no record)`,
      `cleared ${result.alreadyGone} already gone`,
      `removed ${result.containersRemoved} Top Picks collection(s)/playlist(s)`,
      `deleted ${result.foldersRemoved} folder(s)`,
    ]
    if (result.containersKept > 0) {
      parts.push(`kept ${result.containersKept} collection(s)/playlist(s) that could not be proven Top Picks`)
    }
    if (result.refused > 0) {
      parts.push(
        `left ${result.refused} recorded librar${result.refused === 1 ? 'y' : 'ies'} that read folders their records never wrote`
      )
    }
    const summary =
      parts.join(', ') +
      (result.failed > 0 ? `; ${result.failed} could not be removed and were kept — run this again to retry` : '')

    if (result.cancelled) {
      // cancelJob has already written the run record.
      return result
    }
    if (result.failed > 0 || result.refused > 0) {
      addLog(jobId, 'warn', `⚠️ ${summary}.`)
    } else {
      addLog(jobId, 'info', `🎉 ${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`)
    }
    completeJob(jobId, result)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    failJob(jobId, message)
    throw err
  }
}

/**
 * Delete the Top Picks collections and playlists, found by the names in the Top
 * Picks settings — but only those holding nothing except Top Picks titles.
 *
 * Playlists belong to a user, and the writer made them for "the first admin"
 * with no ORDER BY, so every admin's playlists are searched rather than
 * guessing which one that was.
 */
async function removeTopPicksContainers(
  jobId: string,
  provider: MediaServerProvider,
  apiKey: string,
  rows: RemovalRow[],
  serverLibraries: Library[]
): Promise<{ removed: number; kept: number }> {
  const byId = new Map(serverLibraries.map((lib) => [lib.id, lib]))
  const byName = new Map(serverLibraries.map((lib) => [lib.name, lib]))

  // What the Top Picks libraries hold — the proof a container is ours. For
  // series that includes every EPISODE: a series added to an Emby playlist is
  // stored as its episodes, so the playlist reads back episode ids.
  const topPicksItemIds = new Set<string>()
  let readFailed = false
  for (const row of rows.filter((r) => !r.user_id && !r.channel_id)) {
    const library = (row.provider_library_id ? byId.get(row.provider_library_id) : undefined) ?? byName.get(row.name)
    if (!library) continue
    try {
      if (row.media_type === 'series') {
        const series = await provider.getSeries(apiKey, { parentIds: [library.id], limit: 1000 })
        for (const item of series.items) topPicksItemIds.add(item.id)
        for (let startIndex = 0; ; startIndex += EPISODE_PAGE) {
          const page = await provider.getEpisodes(apiKey, { parentIds: [library.id], startIndex, limit: EPISODE_PAGE })
          for (const item of page.items) topPicksItemIds.add(item.id)
          if (page.items.length < EPISODE_PAGE || startIndex + EPISODE_PAGE >= page.totalRecordCount) break
        }
      } else {
        const movies = await provider.getMovies(apiKey, { parentIds: [library.id], limit: 1000 })
        for (const item of movies.items) topPicksItemIds.add(item.id)
      }
    } catch (err) {
      readFailed = true
      const message = err instanceof Error ? err.message : String(err)
      addLog(jobId, 'warn', `Could not read the titles in "${library.name}" (${message}) — only an empty Top Picks collection or playlist will be removed`)
    }
  }

  const config = await getTopPicksConfig()
  const names = [...new Set([
    config.moviesCollectionName || 'Top Picks - Movies',
    config.seriesCollectionName || 'Top Picks - Series',
  ])]
  const admins = (
    await query<{ provider_user_id: string }>(
      `SELECT DISTINCT provider_user_id FROM users WHERE is_admin = true AND provider_user_id IS NOT NULL`
    )
  ).rows.map((r) => r.provider_user_id)

  let removed = 0
  let kept = 0
  const seen = new Set<string>()

  const consider = async (
    kind: 'collection' | 'playlist',
    name: string,
    id: string,
    itemIds: string[],
    remove: () => Promise<void>
  ) => {
    if (seen.has(id)) return
    seen.add(id)
    if (!isDisposableTopPicksContainer(itemIds, topPicksItemIds)) {
      kept++
      const foreign = itemIds.filter((itemId) => !topPicksItemIds.has(itemId)).length
      addLog(
        jobId,
        'warn',
        readFailed
          ? `Kept the ${kind} "${name}": a Top Picks library could not be read, so what it holds could not be checked — run this again`
          : `Kept the ${kind} "${name}": it holds ${foreign} title(s) that are not in a Top Picks library, so it is not one the Top Picks job made`
      )
      return
    }
    await remove()
    removed++
    addLog(jobId, 'info', `🗑️ Removed the Top Picks ${kind} "${name}"${itemIds.length === 0 ? ' (empty)' : ''}`)
  }

  for (const name of names) {
    try {
      const collectionId = await provider.findCollectionByName(apiKey, name)
      if (collectionId) {
        const items = await provider.getCollectionItems(apiKey, collectionId)
        await consider('collection', name, collectionId, items, () => provider.deleteCollection(apiKey, collectionId))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addLog(jobId, 'warn', `Could not check the collection "${name}": ${message}`)
    }

    for (const admin of admins) {
      try {
        const playlistId = await provider.findPlaylistByName(apiKey, admin, name)
        if (!playlistId) continue
        const items = (await provider.getPlaylistItems(apiKey, playlistId)).map((item) => item.id)
        await consider('playlist', name, playlistId, items, () => provider.deletePlaylist(apiKey, playlistId))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        addLog(jobId, 'warn', `Could not check the playlist "${name}": ${message}`)
      }
    }
  }

  return { removed, kept }
}

/** Episodes are read in pages this size when proving a series container is ours. */
const EPISODE_PAGE = 500

async function removeOutputFolders(
  jobId: string,
  root: string,
  rows: RemovalRow[],
  libraryFolders: string[][],
  /** Folders a library that stays still reads; never deleted. */
  protectedFolders: ReadonlySet<string>
): Promise<number> {
  const targets = await rowFolders(root, rows)

  // The folders a deleted library read, as the media server named them — the
  // only way to find an orphan's, since no row says whose it was.
  for (const segments of libraryFolders) {
    targets.add(path.join(root, ...segments))
  }

  for (const target of [...targets]) {
    if (protectedFolders.has(target)) {
      targets.delete(target)
      addLog(jobId, 'info', `Kept ${target}: a library that was not removed still reads it`)
    }
  }

  return removeTargets(jobId, root, targets)
}

/** The output folders a set of rows was written to. */
async function rowFolders(root: string, rows: RemovalRow[]): Promise<Set<string>> {
  const targets = new Set<string>()

  const listing = new Map<string, string[]>()
  const entriesOf = async (subfolder: string): Promise<string[]> => {
    if (!listing.has(subfolder)) {
      try {
        listing.set(subfolder, await fs.readdir(path.join(root, subfolder)))
      } catch {
        listing.set(subfolder, [])
      }
    }
    return listing.get(subfolder) as string[]
  }

  for (const row of rows) {
    const shared = sharedOutputFolder({
      userId: row.user_id,
      channelId: row.channel_id,
      mediaType: row.media_type ?? 'movies',
    })
    if (shared) {
      targets.add(path.join(root, ...shared))
      continue
    }
    if (!row.provider_user_id) continue
    const subfolder = personalOutputRoot(row.media_type ?? 'movies')
    for (const folder of personalOutputFolders(await entriesOf(subfolder), row.provider_user_id)) {
      targets.add(path.join(root, subfolder, folder))
    }
  }

  return targets
}

/**
 * Once no generated library is left anywhere, the output subfolders go whole —
 * which catches what no record or library pointed at any more (a viewer deleted
 * from the server, a folder under a display name since changed). Only the five
 * subfolders legacy output writes, never the root: the mount is the operator's.
 */
async function clearOutputTree(jobId: string, root: string): Promise<number> {
  const targets = new Set<string>()
  for (const subfolder of OUTPUT_SUBFOLDERS) {
    try {
      await fs.access(path.join(root, subfolder))
      targets.add(path.join(root, subfolder))
    } catch {
      // Never written, or already gone.
    }
  }
  if (targets.size > 0) {
    addLog(jobId, 'info', '🧹 No generated library is left — clearing the rest of the output folders')
  }
  return removeTargets(jobId, root, targets)
}

async function removeTargets(jobId: string, root: string, targets: Set<string>): Promise<number> {
  let removed = 0
  for (const target of targets) {
    // Every target is built from fixed segments and directory entries, but the
    // root itself must never be one of them, however a row was written.
    if (!target.startsWith(root + path.sep)) {
      addLog(jobId, 'warn', `Skipped ${target}: not inside ${root}`)
      continue
    }
    try {
      await fs.rm(target, { recursive: true, force: true })
      removed++
      addLog(jobId, 'debug', `🧹 Deleted ${target}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addLog(jobId, 'warn', `Could not delete ${target}: ${message}`)
    }
  }
  return removed
}
