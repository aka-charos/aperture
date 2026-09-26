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
import { accessChangeRefusal } from '../../../lib/accountEnabled.js'
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
const USER_ROW_SELECT = `id, username, display_name, email, provider, provider_user_id, is_admin, is_enabled, recommendations_enabled, discover_enabled, discover_request_enabled, collections_enabled, assistant_enabled, email_notifications_allowed, can_manage_watch_history, provider_disabled, ai_explanation_override_allowed, seerr_user_id, created_at, updated_at`

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
      const { displayName, isEnabled, recommendationsEnabled, discoverEnabled, discoverRequestEnabled, collectionsEnabled, assistantEnabled, emailNotificationsAllowed, canManageWatchHistory, seerrUserId } = request.body

      // Movies and Series were folded into one switch (F-136). A caller still
      // sending them is told so, rather than having a switch silently ignored.
      if (request.body && ('moviesEnabled' in request.body || 'seriesEnabled' in request.body)) {
        return reply.status(400).send({
          error: 'moviesEnabled and seriesEnabled were replaced by recommendationsEnabled',
        } as never)
      }

      const refusal = accessChangeRefusal({ actorId: currentUser.id, targetId: id, isEnabled })
      if (refusal) {
        return reply.status(400).send({ error: refusal } as never)
      }

      // Build update query dynamically
      const updates: string[] = []
      const values: unknown[] = []
      let paramIndex = 1

      if (displayName !== undefined) {
        updates.push(`display_name = $${paramIndex++}`)
        values.push(displayName)
      }

      // The switches this request writes, by column. Discover's is read back by
      // the request-rights derivation below, which needs its NEW value.
      const writtenSwitches: Partial<Record<string, string>> = {}
      const setSwitch = (column: string, value: boolean | undefined) => {
        if (value === undefined) return
        writtenSwitches[column] = `$${paramIndex}`
        updates.push(`${column} = $${paramIndex++}`)
        values.push(value)
      }

      setSwitch('recommendations_enabled', recommendationsEnabled)
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
      setSwitch('assistant_enabled', assistantEnabled)

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

      // Access is written from an explicit isEnabled and from nothing else. It
      // used to be re-derived from the feature switches on every save, so the
      // only way to shut someone out was to switch all their features off, and
      // letting them back in meant re-ticking everything from memory. A feature
      // switch now leaves access alone, and access leaves the features alone
      // (lib/accountEnabled.ts, F-135).
      if (isEnabled !== undefined) {
        updates.push(`is_enabled = $${paramIndex++}`)
        values.push(isEnabled)
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
      // next login. Keyed off the written row rather than the request, so an
      // account that was already off cannot be left holding a session.
      if (!user.is_enabled) {
        await deleteAllUserSessions(id).catch((err: unknown) =>
          listLogger.error({ err, userId: id }, 'Failed to revoke sessions for disabled user')
        )
      }

      // With access off the account's generated libraries go, like its personal
      // home rows do; everything they are built from (runs, taste profile,
      // identity, every switch) stays, so turning access back on rebuilds them on
      // the next run. STRM cleanup would remove them on its own sweep anyway,
      // since it already treats `NOT is_enabled` as grounds.
      if (isEnabled === false || recommendationsEnabled === false) {
        void cleanupUserLibraries(id).catch((err: unknown) =>
          listLogger.error({ err, userId: id }, 'cleanupUserLibraries after disabling recommendations')
        )
      }

      return reply.send(user)
    }
  )
}

