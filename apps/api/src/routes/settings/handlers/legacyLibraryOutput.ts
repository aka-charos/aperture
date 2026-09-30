import type { FastifyInstance } from 'fastify'
import {
  countGeneratedLibraries,
  isLegacyLibraryOutputEnabled,
  setLegacyLibraryOutputEnabled,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'
import {
  legacyLibraryOutputSchema,
  updateLegacyLibraryOutputSchema,
} from '../schemas.js'

/**
 * The switch for the file-system way recommendations reached the media server:
 * per-viewer AI Picks libraries and the shared Top Picks libraries, written as
 * STRM files or symlinks. Emby home rows replace it; this is the interim step
 * of phasing it out.
 *
 * Switching off stops every write at once and leaves what exists alone. The
 * libraries already in the media server are removed only by the
 * `remove-legacy-libraries` job, run from the Jobs console or the button on the
 * settings card — so the count below is what that job would find.
 */
export function registerLegacyLibraryOutputHandlers(fastify: FastifyInstance) {
  const describe = async () => ({
    enabled: await isLegacyLibraryOutputEnabled(),
    generatedLibraries: await countGeneratedLibraries(),
  })

  fastify.get(
    '/api/settings/legacy-library-output',
    { preHandler: requireAdmin, schema: legacyLibraryOutputSchema },
    async (_request, reply) => {
      try {
        return reply.send(await describe())
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get legacy library output setting')
        return reply.status(500).send({ error: 'Failed to get legacy library output setting' })
      }
    }
  )

  fastify.patch<{ Body: { enabled: boolean } }>(
    '/api/settings/legacy-library-output',
    { preHandler: requireAdmin, schema: updateLegacyLibraryOutputSchema },
    async (request, reply) => {
      try {
        await setLegacyLibraryOutputEnabled(request.body.enabled)
        return reply.send(await describe())
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update legacy library output setting')
        return reply.status(500).send({ error: 'Failed to update legacy library output setting' })
      }
    }
  )
}
