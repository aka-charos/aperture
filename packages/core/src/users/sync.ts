/**
 * User Sync Module
 * 
 * Syncs users from Emby/Jellyfin media server to Aperture database.
 * - Imports new users automatically
 * - Updates email for existing users (if not locked)
 * - Updates admin status
 * - Updates provider_disabled from media server Policy.IsDisabled
 * - Refreshes each account's library access (lib/libraryScope.ts)
 * - Marks an account the media server no longer lists (provider_missing_at,
 *   with provider_disabled), and unmarks it when it is listed again
 */

import { randomUUID } from 'crypto'
import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getMediaServerProvider } from '../media/index.js'
import { getMediaServerConfig, getMediaServerApiKey } from '../settings/systemSettings.js'
import {
  createJobProgress,
  setJobStep,
  updateJobProgress,
  addLog,
  completeJob,
  failJob,
} from '../jobs/progress.js'
import { cleanupUserLibraries } from '../strm/cleanup.js'
// The audit trail: this job is the only writer of provider_disabled, and one of
// two writers of is_admin, so a change here is invisible unless it says so.
import { auditUserPermissions, diffUserPermissions, recordPermissionChanges, SYSTEM_ACTORS } from '../permissionAudit.js'
import { accountsGoneFromMediaServer } from './providerPresence.js'
import { libraryIdsFromFolderAccess, saveUserLibraryAccess } from '../lib/libraryScope.js'
import type { Library } from '../media/types.js'

const logger = createChildLogger('user-sync')

export interface SyncUsersResult {
  imported: number
  updated: number
  /** Accounts marked this run as no longer on the media server. */
  gone: number
  total: number
  jobId: string
}

/**
 * Sync all users from media server to Aperture database
 */
export async function syncUsersFromMediaServer(
  existingJobId?: string
): Promise<SyncUsersResult> {
  const jobId = existingJobId || randomUUID()
  createJobProgress(jobId, 'sync-users', 3)

  try {
    const provider = await getMediaServerProvider()
    const apiKey = await getMediaServerApiKey()

    if (!apiKey) {
      throw new Error('MEDIA_SERVER_API_KEY environment variable is required')
    }

    // Step 1: Fetch all users from media server
    setJobStep(jobId, 0, 'Fetching users from media server')
    addLog(jobId, 'info', '📡 Fetching user list from media server...')

    const providerUsers = await provider.getUsers(apiKey)
    addLog(jobId, 'info', `👥 Found ${providerUsers.length} user(s) on media server`)

    // Get existing users from our database
    const existingUsers = await query<{ 
      id: string
      provider_user_id: string
      email: string | null
      email_locked: boolean
      is_admin: boolean
      provider_disabled: boolean
      provider_missing_at: Date | null
      library_access: string[] | null
    }>(
      'SELECT id, provider_user_id, email, email_locked, is_admin, provider_disabled, provider_missing_at, library_access FROM users WHERE provider_user_id IS NOT NULL'
    )
    const existingUserMap = new Map(
      existingUsers.rows.map(u => [u.provider_user_id, u])
    )

    // Which accounts the server no longer lists, decided against the accounts
    // that existed BEFORE this run imports anything: a listing from a
    // different server would otherwise import its own users first and then
    // look like it shares accounts with Aperture (see providerPresence.ts).
    const allAccounts = await query<{
      id: string
      username: string
      provider_user_id: string | null
      provider_disabled: boolean
      provider_missing_at: Date | null
    }>('SELECT id, username, provider_user_id, provider_disabled, provider_missing_at FROM users')
    const goneDecision = accountsGoneFromMediaServer(
      allAccounts.rows.map((row) => ({ ...row, providerUserId: row.provider_user_id })),
      providerUsers.map((pu) => pu.id)
    )

    // Step 2: Process users
    setJobStep(jobId, 1, 'Syncing users', providerUsers.length)

    const msConfig = await getMediaServerConfig()
    const providerType = msConfig.type || 'emby'

    // The server names a user's permitted libraries by GUID; titles carry the
    // library's item id. One listing translates every account. If it cannot be
    // read, every stored permission is left as it was rather than guessed at.
    let libraries: Library[] | null = null
    try {
      libraries = await provider.getLibraries(apiKey)
    } catch (err) {
      logger.warn({ err }, 'Could not list libraries; library access left unchanged this run')
      addLog(jobId, 'warn', '⚠️ Could not list libraries — library access not refreshed this run')
    }
    let accessChanged = 0
    let accessUntranslated = 0
    const refreshAccess = async (
      userId: string,
      folderAccess: (typeof providerUsers)[number]['folderAccess'],
      before: string[] | null | undefined
    ) => {
      if (!libraries || !folderAccess) return
      // Library access must never be what fails the user sync.
      try {
        await refreshAccessFor(userId, folderAccess, before, libraries)
      } catch (err) {
        logger.warn({ err, userId }, 'Could not refresh library access; left unchanged')
      }
    }
    const refreshAccessFor = async (
      userId: string,
      folderAccess: NonNullable<(typeof providerUsers)[number]['folderAccess']>,
      before: string[] | null | undefined,
      libraries: Library[]
    ) => {
      const ids = libraryIdsFromFolderAccess(folderAccess, libraries)
      // Untranslatable: keep what is stored rather than save "no library" —
      // see libraryIdsFromFolderAccess for why that answer is destructive.
      if (ids === undefined) {
        accessUntranslated++
        logger.warn(
          { userId, folders: folderAccess.enabledFolders.length },
          'None of this account\'s permitted folders matched a library; library access left unchanged'
        )
        return
      }
      await saveUserLibraryAccess(userId, ids)
      if (before !== undefined && !sameLibraries(before, ids)) accessChanged++
    }

    let imported = 0
    let updated = 0

    for (let i = 0; i < providerUsers.length; i++) {
      const pu = providerUsers[i]
      updateJobProgress(jobId, i, providerUsers.length, pu.name)

      const existing = existingUserMap.get(pu.id)

      if (!existing) {
        // New user - import
        const created = await queryOne<{ id: string }>(
          `INSERT INTO users (username, provider_user_id, provider, is_admin, is_enabled, recommendations_enabled, email, provider_disabled)
           VALUES ($1, $2, $3, $4, false, false, $5, $6)
           RETURNING id`,
          [pu.name, pu.id, providerType, pu.isAdmin || false, pu.email || null, !!pu.isDisabled]
        )

        // A creation records grants only, so an ordinary import (everything
        // off) writes nothing and an imported administrator writes one row.
        if (created) {
          await refreshAccess(created.id, pu.folderAccess, undefined)
          await auditUserPermissions(
            SYSTEM_ACTORS.userSync,
            { kind: 'user', id: created.id, label: pu.name },
            null,
            { is_admin: pu.isAdmin || false, provider_disabled: !!pu.isDisabled }
          )
        }
        imported++
        addLog(jobId, 'info', `➕ Imported new user: ${pu.name}${pu.email ? ` (${pu.email})` : ''}`)
      } else {
        await refreshAccess(existing.id, pu.folderAccess, existing.library_access)

        // Existing user - check for updates
        const updates: string[] = []
        const values: (string | boolean | null)[] = []
        let paramIndex = 1

        // Update admin status if changed
        if (existing.is_admin !== (pu.isAdmin || false)) {
          updates.push(`is_admin = $${paramIndex}`)
          values.push(pu.isAdmin || false)
          paramIndex++
        }

        // Update email if not locked and different
        if (!existing.email_locked && pu.email && existing.email !== pu.email) {
          updates.push(`email = $${paramIndex}`)
          values.push(pu.email)
          paramIndex++
        }

        // Listed again after being marked gone: the mark goes, and
        // provider_disabled then follows the server just below.
        if (existing.provider_missing_at) {
          updates.push('provider_missing_at = NULL')
          addLog(jobId, 'info', `↩️ Back on the media server: ${pu.name}`)
        }

        // Sync media-server disabled flag (recommendation jobs skip these users)
        if (existing.provider_disabled !== !!pu.isDisabled) {
          updates.push(`provider_disabled = $${paramIndex}`)
          values.push(!!pu.isDisabled)
          paramIndex++
          addLog(
            jobId,
            'info',
            pu.isDisabled
              ? `🚫 User disabled on media server: ${pu.name}`
              : `✅ User re-enabled on media server: ${pu.name}`
          )
        }

        if (updates.length > 0) {
          updates.push('updated_at = NOW()')
          values.push(pu.id)

          await query(
            `UPDATE users SET ${updates.join(', ')} WHERE provider_user_id = $${paramIndex}`,
            values
          )
          updated++

          // Both snapshots carry only the two permission columns this loop can
          // write, and an absent column reads as false on BOTH sides, so
          // nothing else is reported as changed.
          await auditUserPermissions(
            SYSTEM_ACTORS.userSync,
            { kind: 'user', id: existing.id, label: pu.name },
            { is_admin: existing.is_admin, provider_disabled: existing.provider_disabled },
            { is_admin: pu.isAdmin || false, provider_disabled: !!pu.isDisabled }
          )
          addLog(jobId, 'info', `🔄 Updated user: ${pu.name}`)

          if (pu.isDisabled && !existing.provider_disabled) {
            void cleanupUserLibraries(existing.id).catch((err) =>
              logger.error({ err, userId: existing.id }, 'Failed to clean STRM libraries after user disabled on media server')
            )
          }
        }
      }
    }

    updateJobProgress(jobId, providerUsers.length, providerUsers.length)

    // Step 3: accounts the media server no longer has. Marked, never deleted:
    // provider_disabled is what every sign-in door and per-user job already
    // refuses on, so setting it signs the account out and pauses its work
    // while keeping everything stored for it. Removing it is the admin's act
    // (the Users page). provider_missing_at says why the flag is set.
    setJobStep(jobId, 2, 'Checking for accounts the media server no longer has')
    let gone = 0
    if (!goneDecision.ok) {
      addLog(
        jobId,
        'warn',
        goneDecision.reason === 'emptyListing'
          ? '⚠️ The media server listed no users, so no account is treated as removed'
          : '⚠️ The media server lists none of the accounts Aperture knows (a different server?), so no account is treated as removed'
      )
    } else {
      for (const account of goneDecision.gone) {
        if (account.provider_missing_at) continue
        const marked = await queryOne<{ id: string }>(
          `UPDATE users SET provider_missing_at = NOW(), provider_disabled = true, updated_at = NOW()
           WHERE id = $1 AND provider_missing_at IS NULL
           RETURNING id`,
          [account.id]
        )
        if (!marked) continue
        gone++
        await recordPermissionChanges(
          SYSTEM_ACTORS.userSync,
          { kind: 'user', id: account.id, label: account.username },
          diffUserPermissions(
            { provider_disabled: account.provider_disabled },
            { provider_disabled: true }
          ).map((change) => ({ ...change, detail: 'no longer on the media server' }))
        )
        addLog(jobId, 'info', `👋 No longer on the media server: ${account.username} (signed out, work paused)`)
        if (!account.provider_disabled) {
          void cleanupUserLibraries(account.id).catch((err) =>
            logger.error({ err, userId: account.id }, 'Failed to clean STRM libraries after user left the media server')
          )
        }
      }
    }

    const result = {
      imported,
      updated,
      gone,
      total: providerUsers.length,
      jobId,
    }

    if (accessChanged > 0) {
      addLog(jobId, 'info', `📚 Library access changed for ${accessChanged} user(s)`)
    }
    if (accessUntranslated > 0) {
      addLog(
        jobId,
        'warn',
        `⚠️ ${accessUntranslated} user(s): permitted folders matched no library, access left unchanged`
      )
    }
    addLog(
      jobId,
      'info',
      `✅ User sync complete: ${imported} imported, ${updated} updated, ${gone} no longer on the media server, ${providerUsers.length} total`
    )
    completeJob(jobId, result)

    logger.info(result, 'User sync completed')
    return result

  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err }, 'User sync failed')
    addLog(jobId, 'error', `❌ User sync failed: ${error}`)
    failJob(jobId, error)
    throw err
  }
}


/** Whether two stored permissions name the same libraries (NULL = all). */
function sameLibraries(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}
