/**
 * Admin-wide taste profile rebuild.
 *
 * Taste profiles only rebuild when they age past their own
 * `refresh_interval_days` (30 by default), so a change to how profiles are
 * built — the engagement ladder, what counts as a watched episode, which items
 * feed the vector at all — does not reach a user until their profile happens to
 * go stale. After deploying that kind of change every profile in the instance
 * is silently running the old maths, and the only fix on offer was the per-user
 * button in User Settings.
 *
 * This is that button for every user at once. It reuses getUserTasteProfile's
 * rebuild path rather than reimplementing it, so profile, clusters, detected
 * franchise/genre preferences and custom-interest embeddings all refresh
 * exactly as they do on the single-user path.
 *
 * Deliberately not scheduled: the per-profile refresh interval is the ongoing
 * mechanism, and this is the one-off you reach for after an algorithm change.
 */

import crypto from 'crypto'
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import {
  createJobProgress,
  setJobStep,
  updateJobProgress,
  addLog,
  completeJob,
  failJob,
} from '../jobs/index.js'
import type { MediaType } from './types.js'
import { getUserTasteProfile, getStoredProfile } from './index.js'

const logger = createChildLogger('taste-profile-rebuild-all')

export interface RebuildAllTasteProfilesResult {
  jobId: string
  /** Users we attempted at least one media type for */
  usersProcessed: number
  /** Profiles that were rebuilt and stored */
  rebuilt: number
  /** Profiles left alone because the user locked them */
  skippedLocked: number
  /** Profiles that could not be built (no watch history, or no embeddings yet) */
  skippedNoData: number
  failed: number
}

interface UserRow {
  id: string
  username: string
  movies_enabled: boolean
  series_enabled: boolean
  discover_enabled: boolean
}

/**
 * Rebuild one media type for one user.
 *
 * Locks are honoured: `skipLockCheck` stays at its default, so a profile the
 * user pinned is reported as skipped rather than silently overwritten by an
 * admin-run job. The per-user rebuild endpoint passes `skipLockCheck: true`
 * because there the person asking owns the profile.
 */
async function rebuildOne(
  userId: string,
  mediaType: MediaType
): Promise<'rebuilt' | 'locked' | 'no-data'> {
  const before = await getStoredProfile(userId, mediaType)
  if (before?.isLocked) return 'locked'

  const after = await getUserTasteProfile(userId, mediaType, { forceRebuild: true })

  // getUserTasteProfile falls back to the previous profile when the build
  // produces nothing (no watch history, or no embeddings for what was
  // watched). An unchanged auto_updated_at is the tell — a real rebuild always
  // stamps it with NOW().
  if (!after?.autoUpdatedAt) return 'no-data'
  if (before?.autoUpdatedAt && before.autoUpdatedAt.getTime() === after.autoUpdatedAt.getTime()) {
    return 'no-data'
  }

  return 'rebuilt'
}

/**
 * Rebuild the taste profile of every enabled user, for both media types.
 *
 * Per-media-type gating matches the recommenders: a user with movies disabled
 * has no use for a movie taste profile, and rebuilding it would embed a history
 * nothing reads.
 */
export async function rebuildAllTasteProfiles(
  jobId?: string
): Promise<RebuildAllTasteProfilesResult> {
  const actualJobId = jobId || crypto.randomUUID()

  createJobProgress(actualJobId, 'rebuild-taste-profiles', 2)

  const result: RebuildAllTasteProfilesResult = {
    jobId: actualJobId,
    usersProcessed: 0,
    rebuilt: 0,
    skippedLocked: 0,
    skippedNoData: 0,
    failed: 0,
  }

  try {
    setJobStep(actualJobId, 0, 'Finding enabled users')
    addLog(actualJobId, 'info', '🔍 Finding enabled users...')

    // `discover_enabled` belongs in this gate, not just the recommendations
    // flags.
    //
    // Discovery scores a viewer's taste exactly as the recommender does -- it
    // reads the same clusters through getUserTasteClusters -- but it has its own
    // enablement flag, which this WHERE clause never consulted. So a viewer with
    // discover_enabled = true and both recommendation flags false was SCORED by
    // Discover on a profile that no job would ever refresh: measured on a live
    // instance, four such users were still on profiles built weeks earlier under
    // a since-replaced embedding model, and their similarity spread was a sixth
    // of everyone else's. Anything that scores a profile has to be able to
    // maintain it.
    const users = await query<UserRow>(
      `SELECT id, username, movies_enabled, series_enabled, discover_enabled
         FROM users
        WHERE is_enabled = true
          AND provider_disabled = false
          AND (movies_enabled = true OR series_enabled = true OR discover_enabled = true)
        ORDER BY username`
    )

    const totalUsers = users.rows.length

    if (totalUsers === 0) {
      addLog(actualJobId, 'warn', '⚠️ No enabled users found')
      completeJob(actualJobId, { ...result })
      return result
    }

    addLog(actualJobId, 'info', `👥 Rebuilding taste profiles for ${totalUsers} user(s)`)
    setJobStep(actualJobId, 1, 'Rebuilding taste profiles', totalUsers)

    for (let i = 0; i < users.rows.length; i++) {
      const user = users.rows[i]
      result.usersProcessed++

      // Discovery runs BOTH media types for every discovery-enabled viewer --
      // its pipeline loops them unconditionally -- so a discover-only viewer
      // needs both profiles. Widening the WHERE clause without this would admit
      // them and then rebuild nothing, since both recommendation flags are
      // false and the list would come out empty.
      const mediaTypes: MediaType[] = []
      if (user.movies_enabled || user.discover_enabled) mediaTypes.push('movie')
      if (user.series_enabled || user.discover_enabled) mediaTypes.push('series')

      const outcomes: string[] = []

      for (const mediaType of mediaTypes) {
        try {
          const outcome = await rebuildOne(user.id, mediaType)
          if (outcome === 'rebuilt') {
            result.rebuilt++
            outcomes.push(`${mediaType} rebuilt`)
          } else if (outcome === 'locked') {
            result.skippedLocked++
            outcomes.push(`${mediaType} locked`)
          } else {
            result.skippedNoData++
            outcomes.push(`${mediaType} no data`)
          }
        } catch (err) {
          // One user's failure must not abandon the rest of the instance — the
          // whole point of this job is reaching everyone in one pass.
          result.failed++
          outcomes.push(`${mediaType} failed`)
          logger.error(
            { err, userId: user.id, username: user.username, mediaType },
            'Failed to rebuild taste profile'
          )
        }
      }

      addLog(actualJobId, 'info', `👤 ${user.username}: ${outcomes.join(', ')}`)
      updateJobProgress(actualJobId, i + 1, totalUsers, `${i + 1}/${totalUsers} users`)
    }

    addLog(
      actualJobId,
      'info',
      `✅ Rebuilt ${result.rebuilt} profile(s) — ${result.skippedLocked} locked, ${result.skippedNoData} without usable history, ${result.failed} failed`
    )

    completeJob(actualJobId, { ...result })

    logger.info({ ...result }, '✅ Taste profile rebuild complete')

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err }, '❌ Taste profile rebuild failed')
    failJob(actualJobId, message)
    throw err
  }
}
