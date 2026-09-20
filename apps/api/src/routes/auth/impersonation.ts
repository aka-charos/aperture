/**
 * Admin account assumption — "view as user".
 *
 * Starting one layers a second cookie on top of the admin's own session, which
 * is left untouched; stopping one drops that cookie. Nothing on either side
 * writes to the target account, which is the promise the feature makes and the
 * reason an assumed session is read-only (see lib/impersonation.ts).
 */

import type { FastifyPluginAsync } from 'fastify'
import { queryOne } from '../../lib/db.js'
import {
  createImpersonation,
  deleteImpersonation,
  setImpersonationCookie,
  clearImpersonationCookie,
  requireAdmin,
  requireAuth,
  USER_COLUMNS,
  toSessionUser,
  type UserLookupRow,
} from '../../plugins/auth.js'
import { IMPERSONATION_COOKIE_NAME } from '../../lib/impersonation.js'
import { startImpersonationSchema, stopImpersonationSchema } from './schemas.js'

/**
 * The target, in the same shape and read from the same column list the
 * session lookup uses — the admin is about to BE this user, so anything the
 * two disagree about is a permission the assumed session would hold or lack
 * differently from the real one.
 */
type TargetRow = UserLookupRow

const impersonationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/auth/impersonate
   *
   * Not reachable from inside an assumed session: the read-only guard refuses
   * every unsafe method except the two that end one, so assumptions cannot be
   * chained and there is only ever one account to come back to.
   */
  fastify.post<{ Body: { userId: string } }>(
    '/api/auth/impersonate',
    { preHandler: requireAdmin, schema: startImpersonationSchema },
    async (request, reply) => {
      const admin = request.user!
      const { userId } = request.body

      // An assumption hangs off a session row. An API key has none, and no
      // browser to hand the cookie back to.
      if (request.isApiKeyAuth || !request.sessionRowId) {
        return reply.status(400).send({
          error: 'Viewing as another user requires a signed-in browser session.',
        })
      }

      if (userId === admin.id) {
        return reply.status(400).send({ error: 'You are already viewing your own account.' })
      }

      const row = await queryOne<TargetRow>(
        `SELECT ${USER_COLUMNS('users')}
           FROM users WHERE id = $1`,
        [userId]
      )

      if (!row) {
        return reply.status(404).send({ error: 'User not found' })
      }

      // Mirrors the login and session checks: a disabled account is not
      // browsable by anyone, including through this door. `provider_disabled`
      // counts as disabled here for the reason it now refuses a session — the
      // media server has dropped the account, so there is nobody to look at.
      if (!row.is_enabled || row.provider_disabled) {
        return reply.status(403).send({
          error: 'This account is disabled and cannot be viewed.',
        })
      }

      const { token, expiresAt } = await createImpersonation(
        admin.id,
        request.sessionRowId,
        row.id
      )
      setImpersonationCookie(reply, token)

      // The audit line. Deliberately at info, not debug: acting as another user
      // is the kind of thing an operator should be able to find afterwards.
      request.log.info(
        { adminUserId: admin.id, adminUsername: admin.username, targetUserId: row.id, targetUsername: row.username },
        'Started viewing the app as another user'
      )

      return reply.send({
        user: toSessionUser(row),
        impersonation: { admin, expiresAt: expiresAt.toISOString() },
      })
    }
  )

  /**
   * POST /api/auth/impersonate/stop
   *
   * The way out, and one of the only two writes an assumed session is allowed.
   * It succeeds even when there is nothing to stop, so a client that has lost
   * track of the state can always call it and land somewhere sane.
   */
  fastify.post(
    '/api/auth/impersonate/stop',
    { preHandler: requireAuth, schema: stopImpersonationSchema },
    async (request, reply) => {
      const token = request.cookies[IMPERSONATION_COOKIE_NAME]
      if (token) {
        await deleteImpersonation(token)
      }
      clearImpersonationCookie(reply)

      const impersonation = request.impersonation
      if (impersonation) {
        request.log.info(
          {
            adminUserId: impersonation.admin.id,
            targetUserId: request.user!.id,
          },
          'Stopped viewing the app as another user'
        )
      }

      // The admin when there was something to stop; otherwise whoever is
      // already signed in — which is the same answer, just already true.
      return reply.send({ user: impersonation?.admin ?? request.user!, impersonation: null })
    }
  )
}

export default impersonationRoutes
