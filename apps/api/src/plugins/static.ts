import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import fastifyStatic from '@fastify/static'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { getAppName, DEFAULT_APP_NAME } from '@aperture/core'
import { resolveBrandingAsset, brandingAssetUrl } from '../lib/brandingAssets.js'
import { isRoutePath } from '../config/cors.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Rewritten on the way out; matches the built file as well as the source. */
const TITLE_TAG = /<title>[\s\S]*?<\/title>/i

/** The bundled `<link rel="icon">`, replaced when artwork is mounted. */
const ICON_LINK_TAG = /<link\b[^>]*\brel=["']icon["'][^>]*>/i

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A year: everything under /assets/ is named after its own content. */
const ASSET_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

interface StaticPluginOptions {
  /** The built web app. Only a test passes this. */
  webDistPath?: string
}

const staticPlugin: FastifyPluginAsync<StaticPluginOptions> = async (fastify, options) => {
  // Only serve static files in production
  if (process.env.NODE_ENV !== 'production') {
    return
  }

  // Path to web dist folder
  // In Docker: __dirname is /app/apps/api/dist/plugins
  //   ../../../web/dist resolves to /app/apps/web/dist ✓
  // In dev (compiled): __dirname is apps/api/dist/plugins
  //   ../../../web/dist resolves to apps/web/dist ✓
  const webDistPath = options.webDistPath ?? path.resolve(__dirname, '../../../web/dist')

  // Check if dist folder exists
  if (!fs.existsSync(webDistPath)) {
    fastify.log.warn({ path: webDistPath }, 'Web dist folder not found, skipping static file serving')
    return
  }

  const indexPath = path.join(webDistPath, 'index.html')
  // Read once — the file is baked into the image and cannot change at runtime.
  // The name interpolated into it can, so that part is resolved per request.
  const indexTemplate = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null

  /**
   * Serve the SPA shell with the instance's name already in the <title> and any
   * mounted favicon already in the <link>.
   *
   * The client sets `document.title` too, but only once `/api/branding` answers
   * — which is one round-trip after first paint. On a renamed instance that
   * showed the wrong name in the tab (and in a bookmark taken right then) for
   * every cold load, so the name is stamped in here on the way out instead.
   *
   * The favicon gets the same treatment for a stronger reason: browsers request
   * it off the parsed HTML before React runs, and they cache what they get. A
   * client-side swap means the bundled icon is fetched and remembered first.
   */
  async function sendIndex(reply: FastifyReply) {
    if (!indexTemplate) {
      return reply.status(404).send({ error: 'Not Found' })
    }

    let appName = DEFAULT_APP_NAME
    try {
      appName = await getAppName()
    } catch (err) {
      // A database that is down must not take the whole app offline — the shell
      // still boots and the client will fill in the name if it recovers.
      fastify.log.warn({ err }, 'Failed to read instance name for index.html')
    }

    let html = indexTemplate.replace(TITLE_TAG, `<title>${escapeHtml(appName)}</title>`)

    try {
      const favicon = await resolveBrandingAsset('favicon')
      if (favicon) {
        html = html.replace(
          ICON_LINK_TAG,
          `<link rel="icon" type="${escapeHtml(favicon.mimeType)}" href="${escapeHtml(brandingAssetUrl(favicon))}" />`
        )
      }
    } catch (err) {
      // An unreadable mount just means the bundled icon stays.
      fastify.log.warn({ err }, 'Failed to resolve mounted favicon for index.html')
    }

    return reply
      .type('text/html; charset=utf-8')
      // The shell references hashed asset filenames, so it must never be the
      // stale thing a browser holds onto after a deploy.
      .header('Cache-Control', 'no-cache')
      .send(html)
  }

  // Register static file serving
  // decorateReply: true enables reply.sendFile() for SPA fallback
  await fastify.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
    decorateReply: true,
    // Directory requests would otherwise be answered with the file straight off
    // disk, bypassing the title rewrite. They fall through to the handlers below.
    index: false,
  })

  // The bundle's chunks: a new build gets new names, so a browser never needs to
  // ask about one again, and each has a .br and .gz from scripts/precompress.mjs.
  // A chunk gone after a deploy falls through to the handler below, whose page
  // carries no-cache and is what starts the client's one reload (lib/staleChunk.ts).
  await fastify.register(async (assets) => {
    // The plugin does not say so itself, and a shared cache in front of this that
    // isn't told could hand brotli to a client that never asked for it. A hook, not
    // the plugin's setHeaders: that writes to the raw response, and the Vary CORS
    // puts on the reply replaces it. Appended, because that one has to stay too.
    assets.addHook('onSend', async (_request, reply) => {
      const vary = reply.getHeader('vary')
      reply.header('vary', vary ? `${String(vary)}, Accept-Encoding` : 'Accept-Encoding')
    })
    await assets.register(fastifyStatic, {
      root: path.join(webDistPath, 'assets'),
      prefix: '/assets/',
      decorateReply: false,
      index: false,
      preCompressed: true,
      immutable: true,
      maxAge: ASSET_MAX_AGE_MS,
    })
  })

  fastify.get('/', async (_request, reply) => sendIndex(reply))

  // SPA fallback - serve index.html for non-API routes
  fastify.setNotFoundHandler(async (request, reply) => {
    // Don't intercept API routes, health checks, or OpenAPI docs
    if (isRoutePath(request.url)) {
      return reply.status(404).send({ error: 'Not Found' })
    }

    return sendIndex(reply)
  })
}

export default fp(staticPlugin, {
  name: 'static',
  dependencies: ['@fastify/cookie'],
})
