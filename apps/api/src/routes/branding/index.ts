/**
 * Branding Routes
 *
 * - GET  /api/branding         (public) - display name + brand colors + any mounted artwork
 * - GET  /api/branding/:kind   (public) - the mounted logo or favicon itself
 * - PUT  /api/branding         (admin)  - rename the instance and/or recolor it
 *
 * The GETs are deliberately unauthenticated: the login page and the setup
 * wizard both show the name, colors, and the logo, and they run before anyone
 * has a session. They expose nothing an anonymous visitor can't already read
 * off the page they're looking at.
 *
 * The artwork is not uploaded — it is bind-mounted (see lib/brandingAssets).
 */
import type { FastifyPluginAsync } from 'fastify'
import { promises as fs } from 'fs'
import {
  getAppName,
  setAppName,
  APP_NAME_MAX_LENGTH,
  DEFAULT_APP_NAME,
  getThemeColors,
  setThemeColors,
  normalizeThemeColors,
  DEFAULT_THEME_COLORS,
} from '@aperture/core'
import { requireAdmin } from '../../plugins/auth.js'
import {
  resolveBrandingAsset,
  brandingAssetUrl,
  isBrandingAssetKind,
} from '../../lib/brandingAssets.js'

/**
 * A mounted SVG is operator-supplied, so it is trusted the way the compose file
 * is. It is still served under a policy that neuters script: the asset is only
 * ever drawn through <img> and <link rel="icon">, where nothing would run
 * anyway, and this covers someone opening the URL directly.
 */
const ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"

const brandingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/branding', { schema: { tags: ['settings'] } }, async (_request, reply) => {
    try {
      // The name is read on every cold load and changes about once ever, but a
      // stale tab title after a rename is exactly the confusing case this
      // feature exists to avoid.
      void reply.header('Cache-Control', 'no-store')

      // The name/colors come from the database and the artwork from disk. One
      // being unavailable shouldn't take the others down, so each degrades to
      // its default rather than failing the whole response.
      let appName = DEFAULT_APP_NAME
      try {
        appName = await getAppName()
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to read instance name; serving the default')
      }

      let themeColors = DEFAULT_THEME_COLORS
      try {
        themeColors = await getThemeColors()
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to read theme colors; serving the default')
      }

      const [logo, favicon] = await Promise.all([
        resolveBrandingAsset('logo'),
        resolveBrandingAsset('favicon'),
      ])

      return reply.send({
        appName,
        themeColors,
        // null means "nothing mounted" — the client keeps the bundled artwork.
        logo: logo ? { url: brandingAssetUrl(logo), filename: logo.filename } : null,
        favicon: favicon ? { url: brandingAssetUrl(favicon), filename: favicon.filename } : null,
      })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to read branding')
      return reply.status(500).send({ error: 'Failed to read branding' })
    }
  })

  /**
   * GET /api/branding/:kind
   *
   * Streams the mounted logo or favicon. 404 when the operator mounted nothing,
   * which is the signal the client uses to stay on the bundled default.
   */
  fastify.get<{ Params: { kind: string }; Querystring: { v?: string } }>(
    '/api/branding/:kind',
    { schema: { tags: ['settings'] } },
    async (request, reply) => {
      const { kind } = request.params
      if (!isBrandingAssetKind(kind)) {
        return reply.status(400).send({ error: 'Unknown branding asset' })
      }

      try {
        const asset = await resolveBrandingAsset(kind)
        if (!asset) {
          return reply.status(404).send({ error: 'No branding asset mounted' })
        }

        const etag = `"${asset.version}-${asset.size}"`
        if (request.headers['if-none-match'] === etag) {
          return reply.status(304).send()
        }

        // A versioned URL names one immutable revision of the file; a bare one
        // has to notice the operator swapping it out.
        const cacheControl = request.query.v
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=60, must-revalidate'

        const body = await fs.readFile(asset.absolutePath)

        return reply
          .header('Content-Type', asset.mimeType)
          .header('Content-Length', body.length)
          .header('Cache-Control', cacheControl)
          .header('ETag', etag)
          .header('Last-Modified', asset.modifiedAt.toUTCString())
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Security-Policy', ASSET_CSP)
          .send(body)
      } catch (err) {
        // Losing the logo must not take the page down; the client falls back.
        fastify.log.warn({ err, kind }, 'Failed to read mounted branding asset')
        return reply.status(404).send({ error: 'No branding asset mounted' })
      }
    }
  )

  fastify.put<{ Body: { appName?: unknown; themeColors?: unknown } }>(
    '/api/branding',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const { appName, themeColors } = request.body ?? {}
        if (appName !== undefined && typeof appName !== 'string') {
          return reply.status(400).send({ error: 'appName must be a string' })
        }
        if (typeof appName === 'string' && appName.length > APP_NAME_MAX_LENGTH * 4) {
          // Generous: setAppName trims to the real limit. This only rejects
          // something pasted in by mistake, so the DB never stores an essay.
          return reply.status(400).send({ error: 'appName is too long' })
        }

        const normalizedColors = themeColors !== undefined ? normalizeThemeColors(themeColors) : undefined
        if (themeColors !== undefined && !normalizedColors) {
          return reply
            .status(400)
            .send({ error: 'themeColors must include valid #rrggbb primary and secondary colors' })
        }

        // Each field is only touched when present — omitting one must not
        // reset the other, since this section saves them independently.
        const savedAppName = appName !== undefined ? await setAppName(appName) : await getAppName()
        if (normalizedColors) await setThemeColors(normalizedColors)
        const savedThemeColors = normalizedColors ?? (await getThemeColors())

        return reply.send({ appName: savedAppName, themeColors: savedThemeColors })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update branding')
        return reply.status(500).send({ error: 'Failed to update branding' })
      }
    }
  )
}

export default brandingRoutes
