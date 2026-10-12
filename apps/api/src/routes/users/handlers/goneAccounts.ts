/**
 * Accounts the media server no longer has.
 *
 * Endpoints:
 * - DELETE /api/users/:id - Remove such an account and everything stored for it
 *
 * The list itself rides on `GET /api/users/provider` (`loadGoneAccounts`), the
 * one call the Users page already makes: that page is drawn from the media
 * server's list, so these accounts had nowhere to appear, and the same
 * listing is what decides they are gone.
 *
 * Gone is decided by core `accountsGoneFromMediaServer`, the rule the user
 * sync marks them by, and the remove route asks the media server again rather
 * than trusting the page: a removal cannot be undone, so an account still on
 * the server, or a listing that cannot be trusted, refuses it.
 */
import type { FastifyInstance } from 'fastify'
import {
  accountsGoneFromMediaServer,
  cleanupUserLibraries,
  getMediaServerApiKey,
  getMediaServerProvider,
  recordPermissionChanges,
  WATCH_HISTORY_PLAYED_SQL,
  type GoneRefusal,
} from '@aperture/core'
import { query, queryOne } from '../../../lib/db.js'
import { requireAdmin } from '../../../plugins/auth.js'

export interface GoneAccount {
  id: string
  username: string
  email: string | null
  accessEnabled: boolean
  createdAt: Date
  lastLoginAt: Date | null
  /** When the user sync noticed, or null if it has not run since. */
  missingSince: Date | null
  /** Movies and shows they watched, and titles they rated: what removing them deletes. */
  watchedTitles: number
  ratings: number
}

interface AccountRow {
  id: string
  username: string
  provider_user_id: string | null
  email: string | null
  is_enabled: boolean | null
  created_at: Date
  last_login_at: Date | null
  provider_missing_at: Date | null
}

async function readAccounts(): Promise<Array<AccountRow & { providerUserId: string | null }>> {
  const rows = await query<AccountRow>(
    `SELECT id, username, provider_user_id, email, is_enabled, created_at, last_login_at, provider_missing_at
       FROM users`
  )
  return rows.rows.map((row) => ({ ...row, providerUserId: row.provider_user_id }))
}

/**
 * The accounts missing from this listing, or null when the listing cannot be
 * trusted to say (empty, or sharing no account with Aperture).
 */
export async function loadGoneAccounts(listedIds: string[]): Promise<GoneAccount[] | null> {
  const decision = accountsGoneFromMediaServer(await readAccounts(), listedIds)
  if (!decision.ok) return null
  if (decision.gone.length === 0) return []

  const counts = await query<{ user_id: string; watched: number; rated: number }>(
    `SELECT u.id AS user_id,
            (SELECT COUNT(DISTINCT COALESCE(wh.movie_id, e.series_id))::int
               FROM watch_history wh
               LEFT JOIN episodes e ON e.id = wh.episode_id
              WHERE wh.user_id = u.id AND ${WATCH_HISTORY_PLAYED_SQL}) AS watched,
            (SELECT COUNT(*)::int FROM user_ratings r WHERE r.user_id = u.id) AS rated
       FROM users u
      WHERE u.id = ANY($1::uuid[])`,
    [decision.gone.map((account) => account.id)]
  )
  const byId = new Map(counts.rows.map((row) => [row.user_id, row]))

  return decision.gone
    .map((account) => ({
      id: account.id,
      username: account.username,
      email: account.email,
      accessEnabled: account.is_enabled === true,
      createdAt: account.created_at,
      lastLoginAt: account.last_login_at,
      missingSince: account.provider_missing_at,
      watchedTitles: byId.get(account.id)?.watched ?? 0,
      ratings: byId.get(account.id)?.rated ?? 0,
    }))
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REFUSAL_TEXT: Record<GoneRefusal, string> = {
  emptyListing: 'The media server listed no users, so it cannot confirm this account is gone',
  noOverlap: 'The media server lists none of the accounts Aperture knows, so it cannot confirm this account is gone',
}

export function registerGoneAccountHandlers(fastify: FastifyInstance) {
  fastify.delete<{ Params: { id: string } }>(
    '/api/users/:id',
    { preHandler: requireAdmin, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id } = request.params
      const admin = request.user!
      if (!UUID.test(id)) return reply.status(404).send({ error: 'User not found' })
      if (admin.id === id) return reply.status(409).send({ error: 'You cannot remove your own account' })

      const account = await queryOne<{ id: string; username: string }>(
        'SELECT id, username FROM users WHERE id = $1',
        [id]
      )
      if (!account) return reply.status(404).send({ error: 'User not found' })

      const apiKey = await getMediaServerApiKey()
      if (!apiKey) return reply.status(503).send({ error: 'Media server API key not configured' })

      let listed: string[]
      try {
        const provider = await getMediaServerProvider()
        listed = (await provider.getUsers(apiKey)).map((user) => user.id)
      } catch (err) {
        fastify.log.warn({ err }, 'Could not list media-server users to confirm a removal')
        return reply
          .status(502)
          .send({ error: 'Could not reach the media server to confirm the account is gone' })
      }

      const decision = accountsGoneFromMediaServer(await readAccounts(), listed)
      if (!decision.ok) return reply.status(409).send({ error: REFUSAL_TEXT[decision.reason] })
      if (!decision.gone.some((gone) => gone.id === id)) {
        return reply.status(409).send({ error: 'This account is still on the media server' })
      }

      // Its generated libraries go first: their records are deleted with the
      // account, and a library nothing records is one no later run removes.
      try {
        await cleanupUserLibraries(id)
      } catch (err) {
        fastify.log.warn({ err, userId: id }, 'Could not remove generated libraries before removing the account')
      }

      // Every reference to users cascades or is set to null, so this takes the
      // account's history, ratings, recommendations, settings and sessions.
      await query('DELETE FROM users WHERE id = $1', [id])

      // permission_changes has no foreign key on the subject, so this record
      // outlives the account it describes.
      await recordPermissionChanges(
        { userId: admin.id, label: admin.username },
        { kind: 'user', id, label: account.username },
        [{ field: 'account', oldValue: 'present', newValue: 'removed', detail: 'no longer on the media server' }]
      )
      fastify.log.info({ userId: id, username: account.username, by: admin.username }, 'Removed an account gone from the media server')

      return reply.send({ removed: true })
    }
  )
}
