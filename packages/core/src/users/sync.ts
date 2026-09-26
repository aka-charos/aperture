/**
 * User Sync Module
 * 
 * Syncs users from Emby/Jellyfin media server to Aperture database.
 * - Imports new users automatically
 * - Updates email for existing users (if not locked)
 * - Updates admin status
 * - Updates provider_disabled from media server Policy.IsDisabled
 * - Refreshes each account's library access (lib/libraryScope.ts)
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
import { auditUserPermissions, SYSTEM_ACTORS } from '../permissionAudit.js'
import { libraryIdsFromFolderAccess, saveUserLibraryAccess } from '../lib/libraryScope.js'
import type { Library } from '../media/types.js'

const logger = createChildLogger('user-sync')

export interface SyncUsersResult {
  imported: number
  updated: number
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
  createJobProgress(jobId, 'sync-users', 2)

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
      library_access: string[] | null
    }>(
      'SELECT id, provider_user_id, email, email_locked, is_admin, provider_disabled, library_access FROM users WHERE provider_user_id IS NOT NULL'
    )
    const existingUserMap = new Map(
      existingUsers.rows.map(u => [u.provider_user_id, u])
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
    const refreshAccess = async (
      userId: string,
      folderAccess: (typeof providerUsers)[number]['folderAccess'],
      before: string[] | null | undefined
    ) => {
      if (!libraries || !folderAccess) return
      const ids = libraryIdsFromFolderAccess(folderAccess, libraries)
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

    const result = {
      imported,
      updated,
      total: providerUsers.length,
      jobId,
    }

    if (accessChanged > 0) {
      addLog(jobId, 'info', `📚 Library access changed for ${accessChanged} user(s)`)
    }
    addLog(jobId, 'info', `✅ User sync complete: ${imported} imported, ${updated} updated, ${providerUsers.length} total`)
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
