/**
 * Setup Output Configuration Handlers
 */

import type { FastifyInstance } from 'fastify'
import {
  getOutputPathConfig,
  setOutputPathConfig,
  detectPathMappings,
  initUploads,
  uploadImage,
  type LibraryType,
} from '@aperture/core'
import { setupSchemas } from '../schemas.js'
import { requireSetupWritable } from './status.js'

interface LibraryImageBody {
  dataBase64: string
  mimeType: string
  filename?: string
}

/**
 * The setup wizard no longer asks about legacy library output (F-142): a new
 * install starts with it off, and the STRM-vs-symlink choice lives in Admin →
 * Output format. What stays here is what the admin File locations section
 * still calls — the paths and their auto-detection.
 */
export async function registerOutputHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/setup/output-config
   * Get output path configuration for STRM/symlink files
   */
  fastify.get(
    '/api/setup/output-config',
    { schema: setupSchemas.getOutputConfig },
    async (request, reply) => {
      const { complete, isAdmin } = await requireSetupWritable(request)
      if (complete && !isAdmin) return reply.status(404).send({ error: 'Not Found' })
      return reply.send(await getOutputPathConfig())
    }
  )

  /**
   * POST /api/setup/output-config
   * Set output path configuration for STRM/symlink files
   */
  fastify.post<{ Body: Partial<Awaited<ReturnType<typeof getOutputPathConfig>>> }>(
    '/api/setup/output-config',
    { schema: setupSchemas.setOutputConfig },
    async (request, reply) => {
      const { complete, isAdmin } = await requireSetupWritable(request)
      if (complete && !isAdmin) return reply.status(404).send({ error: 'Not Found' })
      const updated = await setOutputPathConfig(request.body ?? {})
      return reply.send(updated)
    }
  )

  /**
   * POST /api/setup/detect-paths
   * Auto-detect path mappings by comparing media server paths with local filesystem
   */
  fastify.post(
    '/api/setup/detect-paths',
    { schema: setupSchemas.detectPaths },
    async (request, reply) => {
      const { complete, isAdmin } = await requireSetupWritable(request)
      if (complete && !isAdmin) return reply.status(404).send({ error: 'Not Found' })

      const result = await detectPathMappings()

      if (!result) {
        return reply.status(400).send({
          error: 'Could not auto-detect paths',
          message:
            'Unable to find media server files in Aperture\'s /media/ mount. ' +
            'Make sure your media folder is mounted at /media in Aperture\'s container.',
        })
      }

      return reply.send(result)
    }
  )

  /**
   * POST /api/setup/library-image/:libraryType
   * Upload a global library banner image (16:9) for AI recs / Top Picks libraries.
   */
  fastify.post<{ Params: { libraryType: LibraryType }; Body: LibraryImageBody }>(
    '/api/setup/library-image/:libraryType',
    { schema: setupSchemas.uploadLibraryImage },
    async (request, reply) => {
      const { complete, isAdmin } = await requireSetupWritable(request)
      if (complete && !isAdmin) return reply.status(404).send({ error: 'Not Found' })

      const { libraryType } = request.params
      const { dataBase64, mimeType, filename } = request.body || ({} as LibraryImageBody)

      if (!dataBase64 || !mimeType) {
        return reply.status(400).send({ error: 'dataBase64 and mimeType are required' })
      }

      const buffer = Buffer.from(dataBase64, 'base64')
      await initUploads()
      const image = await uploadImage({
        entityType: 'library',
        entityId: libraryType,
        imageType: 'Primary',
        buffer,
        originalFilename: filename || `${libraryType}.jpg`,
        mimeType,
        isDefault: true,
      })

      return reply.send({ success: true, image })
    }
  )
}
