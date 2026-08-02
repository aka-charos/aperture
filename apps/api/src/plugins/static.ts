import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import fastifyStatic from '@fastify/static'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { getAppName, DEFAULT_APP_NAME } from '@aperture/core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Rewritten on the way out; matches the built file as well as the source. */
const TITLE_TAG = /<title>[\s\S]*?<\/title>/i

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const staticPlugin: FastifyPluginAsync = async (fastify) => {
  // Only serve static files in production
  if (process.env.NODE_ENV !== 'production') {
    return
  }

  // Path to web dist folder
  // In Docker: __dirname is /app/apps/api/dist/plugins
  //   ../../../web/dist resolves to /app/apps/web/dist ✓
  // In dev (compiled): __dirname is apps/api/dist/plugins
  //   ../../../web/dist resolves to apps/web/dist ✓
  const webDistPath = path.resolve(__dirname, '../../../web/dist')

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
   * Serve the SPA shell with the instance's name already in the <title>.
   *
   * The client sets `document.title` too, but only once `/api/branding` answers
   * — which is one round-trip after first paint. On a renamed instance that
   * showed the wrong name in the tab (and in a bookmark taken right then) for
   * every cold load, so the name is stamped in here on the way out instead.
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

    return reply
      .type('text/html; charset=utf-8')
      // The shell references hashed asset filenames, so it must never be the
      // stale thing a browser holds onto after a deploy.
      .header('Cache-Control', 'no-cache')
      .send(indexTemplate.replace(TITLE_TAG, `<title>${escapeHtml(appName)}</title>`))
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

  fastify.get('/', async (_request, reply) => sendIndex(reply))

  // SPA fallback - serve index.html for non-API routes
  fastify.setNotFoundHandler(async (request, reply) => {
    // Don't intercept API routes, health checks, or OpenAPI docs
    if (
      request.url.startsWith('/api') ||
      request.url.startsWith('/health') ||
      request.url.startsWith('/openapi')
    ) {
      return reply.status(404).send({ error: 'Not Found' })
    }

    return sendIndex(reply)
  })
}

export default fp(staticPlugin, {
  name: 'static',
  dependencies: ['@fastify/cookie'],
})
