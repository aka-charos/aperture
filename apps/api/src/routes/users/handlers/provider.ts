import type { FastifyInstance } from 'fastify'
import { query, queryOne } from '../../../lib/db.js'
import { requireAdmin } from '../../../plugins/auth.js'
import {
  getMediaServerProvider,
  getMediaServerApiKey,
  auditUserPermissions,
  loadConfiguredLibraries,
  resolveLibraryScope,
} from '@aperture/core'
import { isAccountEnabled } from '../../../lib/accountEnabled.js'
import type { UserRow } from '../types.js'

export function registerProviderHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/users/provider
   * Get all users from the media server (Emby/Jellyfin)
   * Returns users with their import status in Aperture
   */
  fastify.get(
    '/api/users/provider',
    { preHandler: requireAdmin, schema: { tags: ["users"] } },
    async (_request, reply) => {
      const apiKey = await getMediaServerApiKey()
      if (!apiKey) {
        return reply.status(500).send({ error: 'Media server API key not configured' })
      }

      try {
        const provider = await getMediaServerProvider()
        const providerUsers = await provider.getUsers(apiKey)

        // Get existing users from our DB to check import status
        const existingResult = await query<{ provider_user_id: string; id: string; is_enabled: boolean; recommendations_enabled: boolean; discover_enabled: boolean; discover_request_enabled: boolean; collections_enabled: boolean; assistant_enabled: boolean; email_notifications_allowed: boolean; ai_explanation_override_allowed: boolean; email: string | null; last_login_at: Date | null; library_access: string[] | null; library_access_synced_at: Date | null; max_parental_rating: number | null }>(
          `SELECT provider_user_id, id, is_enabled, recommendations_enabled, discover_enabled, discover_request_enabled, collections_enabled, assistant_enabled, email_notifications_allowed, COALESCE(ai_explanation_override_allowed, false) as ai_explanation_override_allowed, email, last_login_at, library_access, library_access_synced_at, max_parental_rating FROM users WHERE provider = $1`,
          [provider.type]
        )
        // Which kinds each account would get recommendations for, decided here
        // (lib/libraryScope.ts) rather than in the page: it depends on the
        // libraries the media server lets them see, which the bundle never holds.
        const libraries = await loadConfiguredLibraries()
        const existingMap = new Map(
          existingResult.rows.map((row) => [row.provider_user_id, {
            id: row.id,
            isEnabled: row.is_enabled,
            recommendationsEnabled: row.recommendations_enabled,
            discoverEnabled: row.discover_enabled,
            discoverRequestEnabled: row.discover_request_enabled,
            collectionsEnabled: row.collections_enabled,
            assistantEnabled: row.assistant_enabled,
            emailNotificationsAllowed: row.email_notifications_allowed,
            aiOverrideAllowed: row.ai_explanation_override_allowed,
            email: row.email,
            lastLoginAt: row.last_login_at,
            libraryKinds: (() => {
              const scope = resolveLibraryScope({
                libraries,
                userLibraryIds: row.library_access,
                maxParentalRating: row.max_parental_rating,
              })
              return {
                movies: scope.hasMovies,
                series: scope.hasSeries,
                // Never read yet: the kinds above are the unrestricted default.
                unread: row.library_access_synced_at === null,
              }
            })(),
          }])
        )

        // Combine provider users with import status
        const usersWithStatus = providerUsers.map((user) => {
          const existing = existingMap.get(user.id)
          return {
            providerUserId: user.id,
            name: user.name,
            isAdmin: user.isAdmin,
            isDisabled: user.isDisabled,
            lastActivityDate: user.lastActivityDate,
            // Aperture status
            apertureUserId: existing?.id || null,
            isImported: !!existing,
            isEnabled: existing?.isEnabled || false,
            recommendationsEnabled: existing?.recommendationsEnabled || false,
            discoverEnabled: existing?.discoverEnabled || false,
            discoverRequestEnabled: existing?.discoverRequestEnabled || false,
            collectionsEnabled: existing?.collectionsEnabled || false,
            assistantEnabled: existing?.assistantEnabled || false,
            emailNotificationsAllowed: existing?.emailNotificationsAllowed || false,
            aiOverrideAllowed: existing?.aiOverrideAllowed || false,
            email: existing?.email || null,
            lastLoginAt: existing?.lastLoginAt || null,
            libraryKinds: existing?.libraryKinds ?? null,
          }
        })

        return reply.send({
          provider: provider.type,
          users: usersWithStatus,
        })
      } catch (error) {
        fastify.log.error({ error }, 'Failed to fetch provider users')
        return reply.status(500).send({ error: 'Failed to fetch users from media server' })
      }
    }
  )

  /**
   * POST /api/users/import
   * Import a user from the media server into Aperture
   */
  fastify.post<{ Body: { providerUserId: string; isEnabled?: boolean; recommendationsEnabled?: boolean } }>(
    '/api/users/import',
    { preHandler: requireAdmin, schema: { tags: ["users"] } },
    async (request, reply) => {
      const { providerUserId, isEnabled = false, recommendationsEnabled } = request.body

      // "Import and enable" means recommendations too, as it always did.
      const enableRecommendations = recommendationsEnabled ?? isEnabled

      if (!providerUserId) {
        return reply.status(400).send({ error: 'providerUserId is required' })
      }

      const apiKey = await getMediaServerApiKey()
      if (!apiKey) {
        return reply.status(500).send({ error: 'Media server API key not configured' })
      }

      try {
        const provider = await getMediaServerProvider()
        
        // Check if user already exists
        const existing = await queryOne<UserRow>(
          `SELECT * FROM users WHERE provider = $1 AND provider_user_id = $2`,
          [provider.type, providerUserId]
        )

        if (existing) {
          return reply.status(409).send({ 
            error: 'User already imported',
            user: existing 
          })
        }

        // Get user info from provider
        const providerUser = await provider.getUserById(apiKey, providerUserId)

        // Insert user into our database
        const newUser = await queryOne<UserRow>(
          `INSERT INTO users (username, display_name, provider, provider_user_id, is_admin, is_enabled, recommendations_enabled, max_parental_rating)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            providerUser.name,
            providerUser.name,
            provider.type,
            providerUserId,
            providerUser.isAdmin,
            // Discover and Collections are not written here and default to off (0080, 0116).
            isAccountEnabled({
              recommendationsEnabled: enableRecommendations,
              discoverEnabled: false,
              collectionsEnabled: false,
              isAdmin: providerUser.isAdmin,
              wasEnabled: false,
            }),
            enableRecommendations,
            providerUser.maxParentalRating ?? null,
          ]
        )

        fastify.log.info({ userId: newUser?.id, providerUserId, name: providerUser.name }, 'User imported from media server')

        if (newUser) {
          // A creation records grants only, so an import with both switches
          // off writes nothing and one that enables Movies writes two rows
          // (the switch, and the `is_enabled` it derived).
          await auditUserPermissions(
            { userId: request.user!.id, label: request.user!.username },
            { kind: 'user', id: newUser.id, label: newUser.username },
            null,
            newUser
          )
        }

        return reply.status(201).send({ user: newUser })
      } catch (error) {
        fastify.log.error({ error, providerUserId }, 'Failed to import user')
        return reply.status(500).send({ error: 'Failed to import user from media server' })
      }
    }
  )
}

