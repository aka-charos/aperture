/**
 * Media Proxy Routes
 * Proxies images from Emby/Jellyfin to avoid mixed content issues
 * when accessing Aperture through a reverse proxy
 */

import type { FastifyPluginAsync } from 'fastify'
import { getMediaServerConfig } from '@aperture/core'
import { mediaProxySchemas } from './schemas.js'
import { requireAuth } from '../../plugins/auth.js'
import { withDefaultImageSize } from './imageSize.js'

/**
 * How long one image may take, reading the body included. A longer wait only holds
 * a browser connection for longer: a failure here costs one poster, which the next
 * page view asks for again, since only a success is cached. Set well above the
 * median measured for these images on the live instance, about half a second, so
 * it catches a stall rather than a slow resize.
 */
const IMAGE_DEADLINE_MS = 15_000

const mediaProxyRoutes: FastifyPluginAsync<{ timeoutMs?: number }> = async (
  fastify,
  { timeoutMs = IMAGE_DEADLINE_MS }
) => {
  // Register schemas
  for (const [name, schema] of Object.entries(mediaProxySchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  /**
   * GET /api/media/images/*
   * Proxies image requests to the media server
   * 
   * Examples:
   * - /api/media/images/Items/{itemId}/Images/Primary
   * - /api/media/images/Items/{itemId}/Images/Backdrop
   * - /api/media/images/Persons/{name}/Images/Primary
   * - /api/media/images/Users/{userId}/Images/Primary
   */
  // Gated: this proxies ANY media-server image path using the admin API key,
  // so open it is an unauthenticated read of the media server through us --
  // including `/Users/{id}/Images/Primary`. Posters are loaded by same-origin
  // `<img>` tags, which carry the session cookie, so nothing in the app has
  // to change.
  fastify.get('/api/media/images/*', { preHandler: requireAuth }, async (request, reply) => {
    // Extract the path after /api/media/images/
    const imagePath = (request.params as { '*': string })['*']

    if (!imagePath) {
      return reply.status(400).send({ error: 'Image path required' })
    }

    // Get media server config
    let config
    try {
      config = await getMediaServerConfig()
    } catch {
      return reply.status(503).send({ error: 'Media server not configured' })
    }

    if (!config.baseUrl || !config.apiKey) {
      return reply.status(503).send({ error: 'Media server not configured' })
    }

    // Build the full URL to the media server
    // Preserve any query parameters from the original request, adding a width
    // when the caller named none, or the server sends the original file
    // (imageSize.ts).
    const rawQuery = request.url.includes('?')
      ? request.url.substring(request.url.indexOf('?'))
      : ''
    const queryString = withDefaultImageSize(imagePath, rawQuery)
    const imageUrl = `${config.baseUrl}/${imagePath}${queryString}`

    // Ends the upstream request on the deadline, or as soon as the browser leaves.
    const disconnected = new AbortController()
    const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(timeoutMs)])
    const cancel = () => {
      if (!reply.raw.writableEnded) disconnected.abort()
    }
    reply.raw.once('close', cancel)

    try {
      // Fetch image from media server
      const response = await fetch(imageUrl, {
        signal,
        headers: {
          'X-Emby-Authorization': `MediaBrowser Client="Aperture", Device="Aperture Server", DeviceId="aperture-server", Version="1.0.0", Token="${config.apiKey}"`,
        },
      })

      if (!response.ok) {
        await response.body?.cancel()
        if (response.status === 404) {
          return reply.status(404).send({ error: 'Image not found' })
        }
        throw new Error(`Media server returned ${response.status}`)
      }

      // Get image data
      const contentType = response.headers.get('content-type') || 'image/jpeg'
      const buffer = Buffer.from(await response.arrayBuffer())

      // Set caching headers - images don't change often
      // Cache for 24 hours, allow stale-while-revalidate for 7 days
      reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
      reply.header('Content-Type', contentType)

      return reply.send(buffer)
    } catch (err) {
      if (disconnected.signal.aborted) return reply.status(499).send({ error: 'Client closed the request' })
      if (signal.aborted) return reply.status(504).send({ error: 'Media server image timed out' })
      fastify.log.error({ err, imagePath }, 'Failed to fetch image from media server')
      return reply.status(502).send({ error: 'Failed to fetch image from media server' })
    } finally {
      reply.raw.removeListener('close', cancel)
    }
  })
}

export default mediaProxyRoutes
