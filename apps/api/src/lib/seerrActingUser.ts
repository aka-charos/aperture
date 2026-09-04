/**
 * Which Seerr user Aperture acts as on someone's behalf.
 *
 * Shared by every route that talks to Seerr for a person — requests today,
 * issues and their comments now — because the resolution has three failure
 * modes that must be answered identically everywhere: no match, a contested
 * match, and a cached id that has outlived its account. A second copy would
 * answer one of them differently and nobody would notice until an issue was
 * filed under the wrong name.
 */
import type { FastifyBaseLogger } from 'fastify'
import { listAllSeerrUsers, resolveSeerrUserMatch } from '@aperture/core'
import { query, queryOne } from './db.js'

/**
 * The Seerr user to act as for this Aperture user, or null to act as the API
 * key's own account.
 *
 * Null is always safe: it is exactly the behaviour every request had before
 * `X-API-User` existed. A *wrong* id is not safe, which is why a contested
 * match is refused rather than guessed.
 */
export async function ensureSeerrUserIdForRequest(
  userId: string,
  log: FastifyBaseLogger
): Promise<number | null> {
  const row = await queryOne<{
    seerr_user_id: number | null
    email: string | null
    username: string
    display_name: string | null
    provider: 'emby' | 'jellyfin'
    provider_user_id: string
  }>(
    `SELECT seerr_user_id, email, username, display_name, provider, provider_user_id
     FROM users WHERE id = $1`,
    [userId]
  )
  if (!row) return null
  if (row.seerr_user_id != null) return row.seerr_user_id

  const seerrUsers = await listAllSeerrUsers()
  const match = resolveSeerrUserMatch(
    {
      email: row.email,
      username: row.username,
      displayName: row.display_name,
      provider: row.provider,
      providerUserId: row.provider_user_id,
    },
    seerrUsers
  )

  if (match.userId == null) {
    log.warn(
      { userId, ambiguous: match.ambiguous, matchedBy: match.matchedBy },
      match.ambiguous
        ? 'Several Seerr users match this account; requests will be filed by the API key owner'
        : 'No Seerr user matches this account; requests will be filed by the API key owner'
    )
    return null
  }

  try {
    await query(`UPDATE users SET seerr_user_id = $1, updated_at = NOW() WHERE id = $2`, [
      match.userId,
      userId,
    ])
  } catch (err) {
    // idx_users_seerr_user_id_unique (0104). Another Aperture account already
    // claims this Seerr user, so at least one of the two matches is wrong.
    // Acting as a contested identity would file this request under someone
    // else's name; declining to send the header only costs attribution.
    if ((err as { code?: string }).code === '23505') {
      log.warn(
        { userId, seerrUserId: match.userId, matchedBy: match.matchedBy },
        'Seerr user already linked to another Aperture account; not acting as them'
      )
      return null
    }
    throw err
  }

  log.info({ userId, seerrUserId: match.userId, matchedBy: match.matchedBy }, 'Linked Seerr user')
  return match.userId
}

/**
 * Forget a Seerr link that no longer names a live account, so the next
 * request re-resolves instead of failing the same way forever.
 */
export async function clearStaleSeerrUserId(userId: string, log: FastifyBaseLogger): Promise<void> {
  await query(`UPDATE users SET seerr_user_id = NULL, updated_at = NOW() WHERE id = $1`, [userId])
  log.warn({ userId }, 'Cleared stale Seerr user link')
}
