import type { FastifyInstance } from 'fastify'
import { query, queryOne } from '../../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../../plugins/auth.js'
import {
  can,
  refusalFor,
  toPermissionSubject,
  PERMISSION_COLUMNS,
  type PermissionRow,
} from '../../../../lib/permissions.js'
import { requireSelfOrAdmin } from './shared.js'

export function registerEmailSettingsHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/users/:id/email-settings
   * Get user's email and notification settings
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/users/:id/email-settings',
    { preHandler: requireAuth, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      try {
        const result = await queryOne<{
          email: string | null
          email_locked: boolean
          email_notifications_enabled: boolean
          email_notifications_allowed: boolean
        }>(
          `SELECT email, email_locked, email_notifications_enabled, email_notifications_allowed FROM users WHERE id = $1`,
          [id]
        )

        if (!result) {
          return reply.status(404).send({ error: 'User not found' })
        }

        return reply.send({
          email: result.email,
          emailLocked: result.email_locked,
          emailNotificationsEnabled: result.email_notifications_enabled,
          emailNotificationsAllowed: result.email_notifications_allowed,
        })
      } catch (error) {
        fastify.log.error({ error, userId: id }, 'Failed to get email settings')
        return reply.status(500).send({ error: 'Failed to get email settings' })
      }
    }
  )

  /**
   * PATCH /api/users/:id/email-settings
   * Update user's email (locks it to prevent Emby sync overwrite)
   */
  fastify.patch<{
    Params: { id: string }
    Body: {
      email?: string | null
      emailNotificationsEnabled?: boolean
    }
  }>(
    '/api/users/:id/email-settings',
    { preHandler: requireAuth, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser
      const { email, emailNotificationsEnabled } = request.body

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      try {
        if (emailNotificationsEnabled) {
          // Read from the row, not from the session: this is a permission the
          // TARGET holds, and an admin editing somebody else must still
          // respect it rather than grant it by being an admin.
          const current = await queryOne<PermissionRow>(
            `SELECT ${PERMISSION_COLUMNS} FROM users WHERE id = $1`,
            [id]
          )
          if (!current) {
            return reply.status(404).send({ error: 'User not found' })
          }
          if (!can(toPermissionSubject(current), 'emailNotifications')) {
            return reply.status(403).send(refusalFor('emailNotifications'))
          }
        }

        const updates: string[] = []
        const values: (string | boolean | null)[] = []
        let paramIndex = 1

        if (email !== undefined) {
          updates.push(`email = $${paramIndex}`)
          values.push(email)
          paramIndex++

          if (email !== null && email.trim() !== '') {
            updates.push(`email_locked = TRUE`)
          } else {
            updates.push(`email_locked = FALSE`)
          }
        }

        if (emailNotificationsEnabled !== undefined) {
          updates.push(`email_notifications_enabled = $${paramIndex}`)
          values.push(emailNotificationsEnabled)
          paramIndex++
        }

        if (updates.length === 0) {
          return reply.status(400).send({ error: 'No updates provided' })
        }

        updates.push('updated_at = NOW()')
        values.push(id)

        await query(
          `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
          values
        )

        const result = await queryOne<{
          email: string | null
          email_locked: boolean
          email_notifications_enabled: boolean
          email_notifications_allowed: boolean
        }>(
          `SELECT email, email_locked, email_notifications_enabled, email_notifications_allowed FROM users WHERE id = $1`,
          [id]
        )

        return reply.send({
          email: result?.email,
          emailLocked: result?.email_locked,
          emailNotificationsEnabled: result?.email_notifications_enabled,
          emailNotificationsAllowed: result?.email_notifications_allowed,
        })
      } catch (error) {
        fastify.log.error({ error, userId: id }, 'Failed to update email settings')
        return reply.status(500).send({ error: 'Failed to update email settings' })
      }
    }
  )
}
