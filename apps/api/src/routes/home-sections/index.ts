/**
 * Managed Emby home-screen rows — settings, placement and server support.
 *
 * Endpoints:
 * - GET    /api/home-sections                          admin: config (with per-feature placements), live server support, limits
 * - PATCH  /api/home-sections/config                   admin: save, then start a sync so the change reaches home screens now
 * - GET    /api/home-sections/anchors                  admin: rows found across accounts, for after/before placements
 * - GET    /api/home-sections/availability             any viewer: may they put a playlist on their home screen?
 * - GET    /api/home-sections/me                       any viewer: rows reaching them, the defaults, their overrides, their own rows
 * - PUT    /api/home-sections/me/placements/:feature   any viewer: override a feature's placement, applied at once
 * - DELETE /api/home-sections/me/placements/:feature   any viewer: back to the default, applied at once
 *
 * A saved setting reaches home screens through `sync-home-sections`, started
 * with `startJob` rather than a bespoke apply path: the job claims its name, so a
 * save cannot run beside the nightly schedule and write the same rows twice, and
 * the run has a log and a Cancel button.
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { requireAdmin, requireAuth, type SessionUser } from '../../plugins/auth.js'
import { startJob } from '../jobs/startJob.js'
import {
  FALLBACK_MODES,
  HOME_SECTION_SORTS,
  MAX_RECOMMENDATIONS_LIMIT,
  MAX_ROW_NAME_LENGTH,
  MAX_SECTION_POSITION,
  MIN_RECOMMENDATIONS_LIMIT,
  PLACEMENT_FEATURES,
  PLACEMENT_MODES,
  getHomeSectionsConfig,
  getHomeSectionsServerStatus,
  getUserHomeScreenSettings,
  isPlacementFeature,
  isPlaylistHomeSectionAvailable,
  listSharedHomeRows,
  resetUserPlacement,
  sanitizeHomeSectionsUpdate,
  saveUserPlacement,
  updateHomeSectionsConfig,
  type SaveUserPlacementResult,
} from '@aperture/core'

const LIMITS = {
  sorts: HOME_SECTION_SORTS,
  maxSectionPosition: MAX_SECTION_POSITION,
  minRecommendationsLimit: MIN_RECOMMENDATIONS_LIMIT,
  maxRecommendationsLimit: MAX_RECOMMENDATIONS_LIMIT,
  maxNameLength: MAX_ROW_NAME_LENGTH,
  features: PLACEMENT_FEATURES,
  modes: PLACEMENT_MODES,
  fallbackModes: FALLBACK_MODES,
}

const SYNC_JOB = 'sync-home-sections'

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
   * Rows an after/before placement can anchor to, read from every account's home
   * screen right now, with how many accounts each would resolve for. Live and
   * uncached on purpose: the count of accounts lacking a row is what the admin
   * chooses a fallback from.
   */
  fastify.get(
    '/api/home-sections/anchors',
    {
      preHandler: requireAdmin,
      schema: { tags: ['home-sections'], summary: 'Home screen rows shared across accounts' },
    },
    async (_request, reply) => {
      try {
        return reply.send(await listSharedHomeRows())
      } catch (err) {
        fastify.log.warn({ err }, 'Could not read home screen rows from the media server')
        return reply.status(502).send({ error: 'The media server did not return home screen rows' })
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

        // Every field here changes which rows exist, what they are called, how
        // they sort or where they sit — so a save is applied now, not at 05:45.
        // With the feature off before and after, no home screen holds anything to change.
        let sync: { started: boolean; reason?: 'nothing-saved' | 'feature-off' | 'already-running' }
        if (Object.keys(update).length === 0) {
          sync = { started: false, reason: 'nothing-saved' }
        } else if (!config.enabled && !current.enabled) {
          sync = { started: false, reason: 'feature-off' }
        } else {
          const started = startJob(SYNC_JOB)
          sync = started.ok ? { started: true } : { started: false, reason: 'already-running' }
        }

        return reply.send({ config, sync })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to save home section settings')
        return reply.status(500).send({ error: 'Failed to save home section settings' })
      }
    }
  )

  fastify.get(
    '/api/home-sections/me',
    {
      preHandler: requireAuth,
      schema: { tags: ['home-sections'], summary: 'The managed rows on your home screen and where they go' },
    },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      try {
        return reply.send(await getUserHomeScreenSettings(currentUser.id))
      } catch (err) {
        request.log.error({ err }, 'Failed to load home screen placement settings')
        return reply.status(500).send({ error: 'Failed to load home screen settings' })
      }
    }
  )

  const sendPlacementResult = (reply: FastifyReply, result: SaveUserPlacementResult) =>
    result.ok
      ? reply.send({ placement: result.placement, outcome: result.outcome })
      : reply.status(result.status).send({ error: result.error })

  fastify.put<{ Params: { feature: string }; Body: Record<string, unknown> }>(
    '/api/home-sections/me/placements/:feature',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['home-sections'],
        summary: 'Choose where one of your managed rows goes',
        body: { type: 'object' },
      },
    },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { feature } = request.params
      if (!isPlacementFeature(feature)) return reply.status(404).send({ error: 'Unknown row' })
      try {
        return sendPlacementResult(reply, await saveUserPlacement(currentUser.id, feature, request.body))
      } catch (err) {
        request.log.error({ err, feature }, 'Failed to save a home screen placement')
        return reply.status(500).send({ error: 'Failed to save the placement' })
      }
    }
  )

  fastify.delete<{ Params: { feature: string } }>(
    '/api/home-sections/me/placements/:feature',
    {
      preHandler: requireAuth,
      schema: { tags: ['home-sections'], summary: 'Put one of your managed rows back where the default says' },
    },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { feature } = request.params
      if (!isPlacementFeature(feature)) return reply.status(404).send({ error: 'Unknown row' })
      try {
        return sendPlacementResult(reply, await resetUserPlacement(currentUser.id, feature))
      } catch (err) {
        request.log.error({ err, feature }, 'Failed to reset a home screen placement')
        return reply.status(500).send({ error: 'Failed to reset the placement' })
      }
    }
  )
}

export default homeSectionsRoutes
