/**
 * Remove Aperture AI recommendation virtual libraries from the media server,
 * delete output folders on disk, and clear strm_libraries rows.
 */

import fs from 'fs/promises'
import path from 'path'
import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getMediaServerProvider } from '../media/index.js'
import { getMediaServerApiKey } from '../settings/systemSettings.js'
import { getConfig } from './config.js'
import { addLog } from '../jobs/progress.js'
import {
  loadConfiguredLibraries,
  resolveLibraryScope,
  scopeHas,
} from '../lib/libraryScope.js'
import {
  frozenLibraryStillPermitted,
  personalOutputFolders,
  personalOutputRoot,
  planGeneratedLibraryRemoval,
} from './legacyOutputRules.js'

const logger = createChildLogger('strm-cleanup')

export type StrmLibraryMediaType = 'movies' | 'series'

interface StrmLibraryRow {
  id: string
  name: string
  media_type: string
  provider_library_id: string | null
}

interface UserForCleanup {
  id: string
  provider_user_id: string
  display_name: string | null
  username: string
}

/**
 * Remove STRM library records for a user: delete virtual library in Emby/Jellyfin,
 * remove local output directory, delete DB rows.
 *
 * @param mediaType - If set, only removes that library type; otherwise removes both AI library types when present.
 */
export async function cleanupUserLibraries(
  userId: string,
  mediaType?: StrmLibraryMediaType
): Promise<void> {
  const user = await queryOne<UserForCleanup>(
    `SELECT id, provider_user_id, display_name, username FROM users WHERE id = $1`,
    [userId]
  )
  if (!user) {
    logger.warn({ userId }, 'cleanupUserLibraries: user not found')
    return
  }

  const sql = `SELECT id, name, media_type, provider_library_id FROM strm_libraries
     WHERE user_id = $1
     AND (
       ($2::text IS NULL AND (
         (channel_id IS NULL AND media_type = 'movies') OR media_type = 'series'
       ))
       OR ($2 = 'movies' AND channel_id IS NULL AND media_type = 'movies')
       OR ($2 = 'series' AND media_type = 'series')
     )`
  const params: unknown[] = [userId, mediaType ?? null]

  const result = await query<StrmLibraryRow>(sql, params)
  if (result.rows.length === 0) {
    return
  }

  await removeStrmLibraryRecords(user, result.rows)
}

/**
 * A row is cleared only once its library is gone from the media server — the
 * rule `remove-legacy-libraries` follows too, through the same planner. The
 * row is what keeps a generated library out of the ordinary library list
 * (`getLibraryConfigs(true)`), so clearing it after a failed delete turned the
 * library into a "real" one the next library sync offered for recommendations.
 * A failed delete now keeps its row and its folder; the next reconcile retries.
 */
async function removeStrmLibraryRecords(
  user: UserForCleanup,
  rows: StrmLibraryRow[]
): Promise<void> {
  const apiKey = await getMediaServerApiKey()
  if (!apiKey) {
    logger.warn({ userId: user.id }, 'cleanup: no media server API key; libraries and their records are kept')
    return
  }

  const provider = await getMediaServerProvider()
  const serverLibraries = await provider.getLibraries(apiKey)
  const plan = planGeneratedLibraryRemoval(
    rows.map((r) => ({
      id: r.id,
      userId: user.id,
      channelId: null,
      name: r.name,
      mediaType: r.media_type,
      providerLibraryId: r.provider_library_id,
    })),
    serverLibraries.map((lib) => ({ id: lib.id, name: lib.name }))
  )

  const cleared = new Set<string>(plan.alreadyGone)
  for (const { serverName, rowIds } of plan.deletions) {
    try {
      await provider.deleteVirtualLibrary(apiKey, serverName)
      for (const id of rowIds) cleared.add(id)
      logger.info({ userId: user.id, name: serverName }, 'Deleted virtual library from media server')
    } catch (err) {
      logger.warn(
        { err, userId: user.id, name: serverName },
        'cleanup: media server delete failed; the library and its record are kept for the next reconcile'
      )
    }
  }

  if (cleared.size === 0) return
  const ids = [...cleared]
  await query(`DELETE FROM strm_libraries WHERE id = ANY($1::uuid[])`, [ids])
  await query(
    `DELETE FROM strm_library_scopes WHERE user_id = $1 AND media_type = ANY($2::text[])`,
    [user.id, rows.filter((r) => cleared.has(r.id)).map((r) => r.media_type)]
  )
  logger.info({ userId: user.id, count: ids.length }, 'Removed strm_libraries rows')

  // Found by the provider id at the end of the folder name, not rebuilt from
  // the display name, which can have changed since the folder was written.
  const config = await getConfig()
  const roots = new Set(rows.filter((r) => cleared.has(r.id)).map((r) => personalOutputRoot(r.media_type)))
  for (const subfolder of roots) {
    const parent = path.join(config.strmRoot, subfolder)
    const entries = await fs.readdir(parent).catch(() => [] as string[])
    for (const folder of personalOutputFolders(entries, user.provider_user_id)) {
      const local = path.join(parent, folder)
      try {
        await fs.rm(local, { recursive: true, force: true })
        logger.info({ path: local }, 'Removed local output directory')
      } catch (err) {
        logger.warn({ err, path: local }, 'cleanup: failed to remove output directory')
      }
    }
  }
}

/**
 * Remove AI STRM libraries for users who are disabled or have recommendations off,
 * but still have strm_libraries rows (e.g. toggle happened while API was down).
 *
 * `frozen` is set while legacy library output is switched off. Nothing
 * rewrites a library then, so the per-title scoping the writers do on every
 * sync no longer happens, and a library is also removed when its owner may no
 * longer open everything it was written from (`frozenLibraryStillPermitted`,
 * F-142). This only ever deletes.
 */
export async function reconcileStaleStrmLibraries(
  jobId?: string,
  options: { frozen?: boolean } = {}
): Promise<void> {
  const log = (level: 'info' | 'warn' | 'error', message: string) => {
    if (jobId) {
      addLog(jobId, level, message)
    }
    if (level === 'error') logger.error({ msg: message })
    else if (level === 'warn') logger.warn({ msg: message })
    else logger.info({ msg: message })
  }

  type StaleRow = StrmLibraryRow & {
    user_id: string
    provider_user_id: string
    display_name: string | null
    username: string
    eligible: boolean
    library_access: string[] | null
    max_parental_rating: number | null
    scope_recorded: boolean
    written_library_ids: string[] | null
    written_max_parental_rating: number | null
  }

  // A personal library is stale when its owner may not have recommendations at
  // all, or can no longer see any library of its kind — the same two questions
  // recipients.ts asks before writing one, or a library the writer stopped
  // updating would sit in Emby forever with the last picks in it.
  const candidates = await query<StaleRow>(
    `SELECT sl.id, sl.name, sl.media_type, sl.provider_library_id, sl.user_id,
            u.provider_user_id, u.display_name, u.username,
            (u.is_enabled AND u.recommendations_enabled AND NOT u.provider_disabled) AS eligible,
            u.library_access, u.max_parental_rating,
            (sc.user_id IS NOT NULL) AS scope_recorded,
            sc.library_ids AS written_library_ids,
            sc.max_parental_rating AS written_max_parental_rating
     FROM strm_libraries sl
     JOIN users u ON u.id = sl.user_id
     LEFT JOIN strm_library_scopes sc ON sc.user_id = sl.user_id AND sc.media_type = sl.media_type
     WHERE sl.user_id IS NOT NULL
       AND (sl.media_type = 'series' OR (sl.media_type = 'movies' AND sl.channel_id IS NULL))`
  )
  const libraries = await loadConfiguredLibraries()
  const result = {
    rows: candidates.rows.filter((row) => {
      if (!row.eligible) return true
      const scope = resolveLibraryScope({
        libraries,
        userLibraryIds: row.library_access,
        maxParentalRating: row.max_parental_rating,
      })
      if (!scopeHas(scope, row.media_type === 'series' ? 'series' : 'movies')) return true
      if (!options.frozen) return false
      return !frozenLibraryStillPermitted(
        row.scope_recorded
          ? { libraryIds: row.written_library_ids, maxParentalRating: row.written_max_parental_rating }
          : null,
        { libraryAccess: row.library_access, maxParentalRating: row.max_parental_rating }
      )
    }),
  }

  if (result.rows.length === 0) {
    log('info', 'Reconcile: no stale STRM libraries found')
    return
  }

  log('info', `Reconcile: cleaning ${result.rows.length} stale STRM library record(s)`)

  const byUser = new Map<
    string,
    { user: UserForCleanup; rows: StrmLibraryRow[] }
  >()

  for (const row of result.rows) {
    const key = row.user_id
    let entry = byUser.get(key)
    if (!entry) {
      entry = {
        user: {
          id: row.user_id,
          provider_user_id: row.provider_user_id,
          display_name: row.display_name,
          username: row.username,
        },
        rows: [],
      }
      byUser.set(key, entry)
    }
    entry.rows.push({
      id: row.id,
      name: row.name,
      media_type: row.media_type,
      provider_library_id: row.provider_library_id,
    })
  }

  for (const { user, rows } of byUser.values()) {
    try {
      await removeStrmLibraryRecords(user, rows)
    } catch (err) {
      logger.error({ err, userId: user.id }, 'reconcile: failed to clean user libraries')
      log('error', `Reconcile failed for user ${user.username}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
