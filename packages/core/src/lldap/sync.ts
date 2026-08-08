/**
 * LLDAP Email Sync
 *
 * Imports each Aperture user's email from LLDAP, matching by username. This only
 * works when the media server itself authenticates against the same LLDAP server,
 * so the Aperture username (synced from Emby/Jellyfin) equals the LLDAP user ID —
 * see docs/scripting.md in the lldap repo. There is deliberately no fuzzy matching:
 * a user not found in LLDAP is just skipped.
 *
 * Honors `email_locked` the same way the Emby/Jellyfin sync does (packages/core/src/users/sync.ts) —
 * an email a user (or admin) has set manually is never overwritten by this job.
 */

import { randomUUID } from 'crypto'
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getLldapConfig, getLldapAdminPassword } from '../settings/systemSettings.js'
import { authenticateLldap, fetchLldapUserEmails } from './client.js'
import {
  createJobProgress,
  setJobStep,
  updateJobProgress,
  addLog,
  completeJob,
  failJob,
} from '../jobs/progress.js'

const logger = createChildLogger('lldap-sync')

export interface SyncLldapEmailsResult {
  /** Aperture users whose username matched an LLDAP user with an email set */
  matched: number
  /** Of those matches, how many actually changed the stored email */
  updated: number
  /** Aperture users with no matching LLDAP username (not an error — just unmapped) */
  skipped: number
  total: number
  jobId: string
}

export async function syncLldapEmails(existingJobId?: string): Promise<SyncLldapEmailsResult> {
  const jobId = existingJobId || randomUUID()

  // createJobProgress() runs unconditionally, even when we're about to skip —
  // the manual "Run Now" button in Admin -> Jobs opens an SSE connection keyed
  // on this jobId the instant the run request returns, and that connection
  // only ever gets a completion event if something calls completeJob()/failJob()
  // for this exact jobId. Returning before createJobProgress() (as the
  // MDBList-enrichment "not configured" skip does) leaves the progress store
  // with no record at all: the stream sends nothing but heartbeats forever and
  // the button spins indefinitely. Always opening and closing progress avoids
  // that regardless of which path below we take.
  createJobProgress(jobId, 'sync-lldap-emails', 2)

  // LLDAP is optional and off by default — the job is scheduled daily regardless,
  // so an unconfigured instance just skips quietly rather than showing a daily
  // failure in the job history.
  const config = await getLldapConfig()
  const adminPassword = await getLldapAdminPassword()
  if (!config.enabled || !config.url || !config.adminUsername || !adminPassword) {
    logger.warn('LLDAP not configured - skipping email sync')
    addLog(jobId, 'warn', '⚠️ LLDAP is not configured — nothing to do. Set it up in Settings → Integrations.')
    const summary = { matched: 0, updated: 0, skipped: 0, total: 0, jobId }
    completeJob(jobId, summary)
    return summary
  }

  try {
    setJobStep(jobId, 0, 'Authenticating with LLDAP')
    addLog(jobId, 'info', '🔐 Logging in to LLDAP...')

    const auth = await authenticateLldap(config.url, config.adminUsername, adminPassword)
    if (!auth.ok) {
      throw new Error(auth.error)
    }

    addLog(jobId, 'info', '📡 Fetching user emails from LLDAP...')
    const result = await fetchLldapUserEmails(config.url, auth.value.token)
    if (!result.ok) {
      throw new Error(result.error)
    }

    // LLDAP user IDs are the login usernames. Matched in memory (not via SQL) so
    // it's case-insensitive on both sides regardless of how either system stores
    // case — cheap insurance against the two directories disagreeing on it.
    const lldapUsers = result.value.users
    const lldapEmailByUsername = new Map(
      lldapUsers.filter((u) => !!u.email).map((u) => [u.id.toLowerCase(), u.email])
    )

    addLog(
      jobId,
      'info',
      `👥 Found ${lldapUsers.length} LLDAP user(s), ${lldapEmailByUsername.size} with an email set`
    )

    const existingUsers = await query<{
      id: string
      username: string
      email: string | null
      email_locked: boolean
    }>('SELECT id, username, email, email_locked FROM users')

    setJobStep(jobId, 1, 'Matching Aperture users', existingUsers.rows.length)

    let matched = 0
    let updated = 0
    let skipped = 0

    for (let i = 0; i < existingUsers.rows.length; i++) {
      const user = existingUsers.rows[i]
      updateJobProgress(jobId, i, existingUsers.rows.length, user.username)

      const lldapEmail = lldapEmailByUsername.get(user.username.toLowerCase())
      if (!lldapEmail) {
        skipped++
        continue
      }
      matched++

      if (user.email_locked || user.email === lldapEmail) {
        continue
      }

      await query('UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2', [lldapEmail, user.id])
      updated++
      addLog(jobId, 'info', `✉️ Set email for ${user.username} from LLDAP`)
    }

    updateJobProgress(jobId, existingUsers.rows.length, existingUsers.rows.length)

    // Deliberately not annotated as SyncLldapEmailsResult here: completeJob() takes
    // a Record<string, unknown>, and a named-interface-typed value (unlike a fresh
    // object literal) has no implicit index signature, so TS would reject the call.
    const summary = {
      matched,
      updated,
      skipped,
      total: existingUsers.rows.length,
      jobId,
    }

    addLog(
      jobId,
      'info',
      `✅ LLDAP email sync complete: ${matched} matched, ${updated} updated, ${skipped} not found in LLDAP`
    )
    completeJob(jobId, summary)
    logger.info(summary, 'LLDAP email sync completed')
    return summary
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err }, 'LLDAP email sync failed')
    addLog(jobId, 'error', `❌ LLDAP email sync failed: ${error}`)
    failJob(jobId, error)
    throw err
  }
}
