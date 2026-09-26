/**
 * Setup Users Handlers
 */

import type { FastifyInstance } from 'fastify'
import {
  getMediaServerApiKey,
  getMediaServerProvider,
} from '@aperture/core'
import { query, queryOne } from '../../../lib/db.js'
import { accountEnabledSql, isAccountEnabled } from '../../../lib/accountEnabled.js'
// The wizard grants the first permissions this instance ever has, and does it
// before any admin exists to attribute them to.
import {
  auditUserPermissions,
  readUserPermissions,
  SYSTEM_ACTORS,
} from '@aperture/core'
import { setupSchemas } from '../schemas.js'
import { requireSetupWritable } from './status.js'

interface SetupUserImportBody {
  providerUserId: string
  recommendationsEnabled?: boolean
}

interface SetupUserEnableBody {
  apertureUserId: string
  recommendationsEnabled?: boolean
}

export async function registerUsersHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/setup/users
   * Fetch users from media server using saved API key.
   */
  fastify.get(
    '/api/setup/users',
    { schema: setupSchemas.getUsers },
    async (request, reply) => {
      const { complete, isAdmin } = await requireSetupWritable(request)
      if (complete && !isAdmin) {
        return reply.status(403).send({
          error: 'Setup is complete. Manage users in Admin → Users.',
        })
      }

      const apiKey = await getMediaServerApiKey()
      if (!apiKey) {
        return reply.status(400).send({ error: 'Media server must be configured first' })
      }

      try {
        const provider = await getMediaServerProvider()
        const providerUsers = await provider.getUsers(apiKey)

        const existingResult = await query<{
          provider_user_id: string
          id: string
          is_enabled: boolean
          recommendations_enabled: boolean
        }>(
          `SELECT provider_user_id, id, is_enabled, recommendations_enabled
           FROM users WHERE provider = $1`,
          [provider.type]
        )

        const existingMap = new Map(
          existingResult.rows.map((row) => [
            row.provider_user_id,
            {
              id: row.id,
              isEnabled: row.is_enabled,
              recommendationsEnabled: row.recommendations_enabled,
            },
          ])
        )

        const usersWithStatus = providerUsers.map((user) => {
          const existing = existingMap.get(user.id)
          return {
            providerUserId: user.id,
            name: user.name,
            isAdmin: user.isAdmin,
            isDisabled: user.isDisabled,
            lastActivityDate: user.lastActivityDate,
            apertureUserId: existing?.id || null,
            isImported: !!existing,
            isEnabled: existing?.isEnabled || false,
            recommendationsEnabled: existing?.recommendationsEnabled || false,
          }
        })

        return reply.send({
          provider: provider.type,
          users: usersWithStatus,
        })
      } catch (error) {
        fastify.log.error({ error }, 'Failed to fetch provider users during setup')
        return reply.status(500).send({ error: 'Failed to fetch users from media server' })
      }
    }
  )

  /**
   * POST /api/setup/users/import
   * Import a user from media server into Aperture DB.
   */
  fastify.post<{ Body: SetupUserImportBody }>(
    '/api/setup/users/import',
    { schema: setupSchemas.importUser },
    async (request, reply) => {
      const { complete, isAdmin } = await requireSetupWritable(request)
      if (complete && !isAdmin) {
        return reply.status(403).send({
          error: 'Setup is complete. Manage users in Admin → Users.',
        })
      }

      const { providerUserId, recommendationsEnabled = false } = request.body || {}

      if (!providerUserId) {
        return reply.status(400).send({ error: 'providerUserId is required' })
      }

      const apiKey = await getMediaServerApiKey()
      if (!apiKey) {
        return reply.status(400).send({ error: 'Media server must be configured first' })
      }

      try {
        const provider = await getMediaServerProvider()

        const existing = await queryOne<{ id: string }>(
          `SELECT id FROM users WHERE provider = $1 AND provider_user_id = $2`,
          [provider.type, providerUserId]
        )

        if (existing) {
          const updated = await queryOne<{
            id: string
            username: string
            is_enabled: boolean
            recommendations_enabled: boolean
          }>(
            `UPDATE users 
             SET recommendations_enabled = $1,
                 is_enabled = ${accountEnabledSql({ recommendations_enabled: '$1' })},
                 updated_at = NOW()
             WHERE id = $2
             RETURNING id, username, is_enabled, recommendations_enabled`,
            [recommendationsEnabled, existing.id]
          )
          return reply.send({ user: updated, alreadyImported: true })
        }

        const providerUser = await provider.getUserById(apiKey, providerUserId)

        const newUser = await queryOne<{
          id: string
          username: string
          is_admin: boolean
          is_enabled: boolean
          recommendations_enabled: boolean
        }>(
          `INSERT INTO users (username, display_name, provider, provider_user_id, is_admin, is_enabled, recommendations_enabled, max_parental_rating)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, username, is_admin, is_enabled, recommendations_enabled`,
          [
            providerUser.name,
            providerUser.name,
            provider.type,
            providerUserId,
            providerUser.isAdmin,
            // Discover and Collections are not written here and default to off (0080, 0116).
            isAccountEnabled({
              recommendationsEnabled,
              discoverEnabled: false,
              collectionsEnabled: false,
              isAdmin: providerUser.isAdmin,
              wasEnabled: false,
            }),
            recommendationsEnabled,
            providerUser.maxParentalRating ?? null,
          ]
        )

        fastify.log.info(
          { userId: newUser?.id, providerUserId, name: providerUser.name },
          'User imported during setup'
        )

        if (newUser) {
          await auditUserPermissions(
            SYSTEM_ACTORS.setupWizard,
            { kind: 'user', id: newUser.id, label: newUser.username },
            null,
            newUser
          )
        }

        return reply.status(201).send({ user: newUser })
      } catch (error) {
        fastify.log.error({ error, providerUserId }, 'Failed to import user during setup')
        return reply.status(500).send({ error: 'Failed to import user from media server' })
      }
    }
  )

  /**
   * POST /api/setup/users/enable
   * Update movies/series enabled status for an imported user.
   */
  fastify.post<{ Body: SetupUserEnableBody }>(
    '/api/setup/users/enable',
    { schema: setupSchemas.enableUser },
    async (request, reply) => {
      const { complete, isAdmin } = await requireSetupWritable(request)
      if (complete && !isAdmin) {
        return reply.status(403).send({
          error: 'Setup is complete. Manage users in Admin → Users.',
        })
      }

      const { apertureUserId, recommendationsEnabled } = request.body || {}

      if (!apertureUserId) {
        return reply.status(400).send({ error: 'apertureUserId is required' })
      }

      try {
        const updates: string[] = []
        const values: unknown[] = []
        let paramIndex = 1

        const written: { recommendations_enabled?: string } = {}
        if (recommendationsEnabled !== undefined) {
          written.recommendations_enabled = `$${paramIndex}`
          updates.push(`recommendations_enabled = $${paramIndex++}`)
          values.push(recommendationsEnabled)
        }

        if (updates.length === 0) {
          return reply
            .status(400)
            .send({ error: 'recommendationsEnabled is required' })
        }

        // The switches written here are read from their new values; the rest of the
        // row, admin clause included, as it was (lib/accountEnabled.ts).
        updates.push(`is_enabled = ${accountEnabledSql(written)}`)

        const beforeEnable = await readUserPermissions(apertureUserId)

        updates.push('updated_at = NOW()')
        values.push(apertureUserId)

        const updated = await queryOne<{
          id: string
          username: string
          is_enabled: boolean
          recommendations_enabled: boolean
        }>(
          `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}
           RETURNING id, username, is_enabled, recommendations_enabled`,
          values
        )

        if (!updated) {
          return reply.status(404).send({ error: 'User not found' })
        }

        await auditUserPermissions(
          SYSTEM_ACTORS.setupWizard,
          { kind: 'user', id: updated.id, label: updated.username },
          beforeEnable,
          updated
        )

        return reply.send({ user: updated })
      } catch (error) {
        fastify.log.error({ error, apertureUserId }, 'Failed to update user during setup')
        return reply.status(500).send({ error: 'Failed to update user' })
      }
    }
  )
}
