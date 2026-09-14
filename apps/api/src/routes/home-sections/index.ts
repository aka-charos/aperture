/**
 * Managed Emby home-screen rows — settings and server support.
 *
 * Endpoints:
 * - GET   /api/home-sections         config, live server support, and the limits the form enforces
 * - PATCH /api/home-sections/config  save settings; switching the feature ON is gated on the server
 * - GET   /api/home-sections/availability  any viewer: may they put a playlist on their home screen?
 *
 * There is deliberately no "sync" endpoint here. Sync now is
 * `POST /api/jobs/sync-home-sections/run`: that route goes through `startJob`,
 * which claims the job name, so a button press cannot run beside the nightly
 * schedule and write the same rows twice — and it gets progress, a log and a
 * Cancel button for free.
 */
import type { FastifyPluginAsync } from 'fastify'
import { requireAdmin, requireAuth, type SessionUser } from '../../plugins/auth.js'
import {
  HOME_SECTION_SORTS,
  MAX_RECOMMENDATIONS_LIMIT,
  MAX_ROW_NAME_LENGTH,
  MAX_SECTION_POSITION,
  MIN_RECOMMENDATIONS_LIMIT,
  getHomeSectionsConfig,
  getHomeSectionsServerStatus,
  isPlaylistHomeSectionAvailable,
  sanitizeHomeSectionsUpdate,
  updateHomeSectionsConfig,
} from '@aperture/core'

const LIMITS = {
  sorts: HOME_SECTION_SORTS,
  maxSectionPosition: MAX_SECTION_POSITION,
  minRecommendationsLimit: MIN_RECOMMENDATIONS_LIMIT,
  maxRecommendationsLimit: MAX_RECOMMENDATIONS_LIMIT,
  maxNameLength: MAX_ROW_NAME_LENGTH,
}

const homeSectionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/home-sections',
    {
      preHandler: requireAdmin,
      schema: { tags: ['home-sections'], summary: 'Home section settings and server support' },
    },
    async (_request, reply) => {
      try {
        const [config, status] = await Promise.all([getHomeSectionsConfig(), getHomeSectionsServerStatus()])
        return reply.send({ config, status, limits: LIMITS })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to load home section settings')
        return reply.status(500).send({ error: 'Failed to load home section settings' })
      }
    }
  )

  /**
   * Whether this viewer should be offered "show on my home screen" for their
   * generated playlists. Any signed-in viewer may ask; the rule is decided here
   * so the playlist pages and the chat never hold a copy of it. A failure reads
   * as "not offered" — a missing control is safer than one that does nothing.
   */
  fastify.get(
    '/api/home-sections/availability',
    {
      preHandler: requireAuth,
      schema: { tags: ['home-sections'], summary: 'Whether playlists may be shown on your home screen' },
    },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      try {
        return reply.send({ playlists: await isPlaylistHomeSectionAvailable(currentUser.id) })
      } catch (err) {
        request.log.warn({ err }, 'Could not work out home section availability')
        return reply.send({ playlists: false })
      }
    }
  )

  fastify.patch<{ Body: Record<string, unknown> }>(
    '/api/home-sections/config',
    {
      preHandler: requireAdmin,
      schema: {
        tags: ['home-sections'],
        summary: 'Save home section settings',
        body: { type: 'object' },
      },
    },
    async (request, reply) => {
      const { update, errors } = sanitizeHomeSectionsUpdate(request.body)
      if (errors.length > 0) {
        return reply.status(400).send({ error: errors.join('; ') })
      }

      try {
        const current = await getHomeSectionsConfig()

        // Only the transition to ON is gated. Editing a name while the server
        // happens to be unreachable must still save, and switching OFF must
        // always be possible — it is how rows get removed.
        if (update.enabled === true && !current.enabled) {
          const status = await getHomeSectionsServerStatus()
          if (!status.supported) {
            const reasons: Record<string, string> = {
              'not-configured': 'No media server is configured.',
              'unsupported-provider': 'Managed home sections are only available on Emby.',
              'unsupported-server': `Emby ${status.minVersion} or newer is required (found ${status.serverVersion ?? 'unknown'}).`,
              unreachable: 'The media server did not answer, so its version could not be checked.',
            }
            return reply.status(400).send({ error: reasons[status.reason] ?? 'Unsupported media server', status })
          }
        }

        const config = await updateHomeSectionsConfig(update)
        return reply.send({ config })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to save home section settings')
        return reply.status(500).send({ error: 'Failed to save home section settings' })
      }
    }
  )
}

export default homeSectionsRoutes
