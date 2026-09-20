import type { FastifyInstance } from 'fastify'
import { createChildLogger } from '@aperture/core'
import { cleanupUserLibraries } from '@aperture/core/strm'
import { query, queryOne } from '../../../lib/db.js'
import {
  requireAuth,
  requireAdmin,
  deleteAllUserSessions,
  type SessionUser,
} from '../../../plugins/auth.js'
import { accountEnabledSql, type AccountSwitchColumn } from '../../../lib/accountEnabled.js'
import { discoverRequestSql } from '../../../lib/permissions.js'
import {
  auditUserPermissions,
  getPermissionHistory,
  readUserPermissions,
} from '@aperture/core'
import type { UserRow, UserListResponse, UserUpdateBody } from '../types.js'

const listLogger = createChildLogger('users-list')

// `provider_disabled` and `ai_explanation_override_allowed` are here for the
// permission audit, which diffs the row it just wrote. They are not part of
// `UserRow`, so nothing else sees them.
const USER_ROW_SELECT = `id, username, display_name, email, provider, provider_user_id, is_admin, is_enabled, movies_enabled, series_enabled, discover_enabled, discover_request_enabled, collections_enabled, email_notifications_allowed, can_manage_watch_history, provider_disabled, ai_explanation_override_allowed, seerr_user_id, created_at, updated_at`

export function registerListHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/users
   * List all users (admin only)
   */
  fastify.get<{ Reply: UserListResponse }>(
    '/api/users',
    { preHandler: requireAdmin, schema: { tags: ["users"] } },
    async (_request, reply) => {
      const result = await query<UserRow>(
        `SELECT ${USER_ROW_SELECT}
         FROM users
         ORDER BY username ASC`
      )

      return reply.send({
        users: result.rows,
        total: result.rows.length,
      })
    }
  )

  /**
   * GET /api/users/:id
   * Get user by ID (admin only, or own user)
   */
  fastify.get<{ Params: { id: string }; Reply: UserRow }>(
    '/api/users/:id',
    { preHandler: requireAuth, schema: { tags: ["users"] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser

      // Allow access to own user or admin
      if (id !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' } as never)
      }

      const user = await queryOne<UserRow>(
        `SELECT ${USER_ROW_SELECT}
         FROM users WHERE id = $1`,
        [id]
      )

      if (!user) {
        return reply.status(404).send({ error: 'User not found' } as never)
      }

      return reply.send(user)
    }
  )

  /**
   * GET /api/users/:id/permission-history
   *
   * Admin only, and deliberately not self-service: the answer names the
   * admin who made each change, which is a fact about somebody else.
   */
  fastify.get<{ Params: { id: string }; Querystring: { limit?: number } }>(
    '/api/users/:id/permission-history',
    { preHandler: requireAdmin, schema: { tags: ['users'] } },
    async (request, reply) => {
      const changes = await getPermissionHistory(request.params.id, request.query.limit ?? 50)
      return reply.send({ changes })
    }
  )

  /**
   * PUT /api/users/:id
   * Update user (admin only)
   */
  fastify.put<{ Params: { id: string }; Body: UserUpdateBody; Reply: UserRow }>(
    '/api/users/:id',
    { preHandler: requireAdmin, schema: { tags: ["users"] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser
      const { displayName, isEnabled, moviesEnabled, seriesEnabled, discoverEnabled, discoverRequestEnabled, collectionsEnabled, emailNotificationsAllowed, canManageWatchHistory, seerrUserId } = request.body

      // Build update query dynamically
      const updates: string[] = []
      const values: unknown[] = []
      let paramIndex = 1

      if (displayName !== undefined) {
        updates.push(`display_name = $${paramIndex++}`)
        values.push(displayName)
      }

      // The switches this request writes, by column, so is_enabled is derived from
      // their NEW values (accountEnabledSql says why the bare column would not do).
      const writtenSwitches: Partial<Record<AccountSwitchColumn, string>> = {}
      const setSwitch = (column: AccountSwitchColumn, value: boolean | undefined) => {
        if (value === undefined) return
        writtenSwitches[column] = `$${paramIndex}`
        updates.push(`${column} = $${paramIndex++}`)
        values.push(value)
      }

      setSwitch('movies_enabled', moviesEnabled)
      setSwitch('series_enabled', seriesEnabled)
      setSwitch('discover_enabled', discoverEnabled)

      // Content requests depend on Discover, and that rule used to live only in
      // the browser: the Users page cleared one with the other, while the API
      // wrote the two columns independently and routes/seerr checked the request
      // flag alone. So a PUT naming `discoverRequestEnabled` on its own granted
      // Seerr request rights to an account with Discover switched off.
      //
      // Derived from the whole row rather than from this request, for the same
      // reason `is_enabled` is: the page sends one switch per request, so
      // switching Discover off has to clear request rights in that same
      // statement, without the caller having to remember to send both.
      const writtenRequest: { discover_enabled?: string; discover_request_enabled?: string } = {}
      if (writtenSwitches.discover_enabled) {
        writtenRequest.discover_enabled = writtenSwitches.discover_enabled
      }
      if (discoverRequestEnabled !== undefined) {
        writtenRequest.discover_request_enabled = `$${paramIndex}`
        values.push(discoverRequestEnabled)
        paramIndex++
      }
      if (Object.keys(writtenRequest).length > 0) {
        updates.push(`discover_request_enabled = ${discoverRequestSql(writtenRequest)}`)
      }

      setSwitch('collections_enabled', collectionsEnabled)

      if (emailNotificationsAllowed !== undefined) {
        updates.push(`email_notifications_allowed = $${paramIndex++}`)
        values.push(emailNotificationsAllowed)
        // Revoking the permission also turns off the user's own opt-in, so a
        // later re-grant doesn't silently reactivate a stale preference.
        if (emailNotificationsAllowed === false) {
          updates.push(`email_notifications_enabled = false`)
        }
      }

      if (canManageWatchHistory !== undefined) {
        updates.push(`can_manage_watch_history = $${paramIndex++}`)
        values.push(canManageWatchHistory)
      }

      if (seerrUserId !== undefined) {
        updates.push(`seerr_user_id = $${paramIndex++}`)
        values.push(seerrUserId)
      }

      // An explicit isEnabled is the caller's decision. Otherwise changing any switch
      // re-derives it from the whole row, not from this request: the Users page
      // sends one switch per request, and deciding from the request alone left
      // accounts switched off one at a time enabled (lib/accountEnabled.ts).
      if (isEnabled !== undefined) {
        updates.push(`is_enabled = $${paramIndex++}`)
        values.push(isEnabled)
      } else if (Object.keys(writtenSwitches).length > 0) {
        updates.push(`is_enabled = ${accountEnabledSql(writtenSwitches)}`)
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'No fields to update' } as never)
      }

      // Read BEFORE the write, so the audit can diff the row rather than the
      // request. The request says which switch an admin touched; only the two
      // rows together say that request rights went with Discover, or that the
      // account stopped being able to sign in (permissionAudit.ts rule 1).
      const before = await readUserPermissions(id)

      values.push(id)
      const user = await queryOne<UserRow>(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING ${USER_ROW_SELECT}`,
        values
      )

      if (!user) {
        return reply.status(404).send({ error: 'User not found' } as never)
      }

      // Never awaited into the response path beyond this: the change already
      // happened, and the recorder swallows its own failures.
      await auditUserPermissions(
        { userId: currentUser.id, label: currentUser.username },
        { kind: 'user', id: user.id, label: user.username },
        before,
        user
      )

      // Disabling an account must end its existing sessions, not just block the
      // next login. Keyed off the written row so it covers every path that can
      // clear is_enabled, including the derived one when the last switch goes off.
      if (!user.is_enabled) {
        await deleteAllUserSessions(id).catch((err: unknown) =>
          listLogger.error({ err, userId: id }, 'Failed to revoke sessions for disabled user')
        )
      }

      const disableAllRecommendations =
        isEnabled === false ||
        (moviesEnabled === false && seriesEnabled === false)

      if (disableAllRecommendations) {
        void cleanupUserLibraries(id).catch((err: unknown) =>
          listLogger.error({ err, userId: id }, 'cleanupUserLibraries after disabling recommendations')
        )
      } else {
        if (moviesEnabled === false) {
          void cleanupUserLibraries(id, 'movies').catch((err: unknown) =>
            listLogger.error({ err, userId: id }, 'cleanupUserLibraries after disabling movie recommendations')
          )
        }
        if (seriesEnabled === false) {
          void cleanupUserLibraries(id, 'series').catch((err: unknown) =>
            listLogger.error({ err, userId: id }, 'cleanupUserLibraries after disabling series recommendations')
          )
        }
      }

      return reply.send(user)
    }
  )
}

