import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import { createLogger } from './lib/logger.js'
import { refreshQuietPollState, shouldLogIncoming, shouldLogCompleted } from './config/logging.js'
import { refreshLogMaskingState, maskHost, maskAddress, maskUrl } from './config/logMasking.js'
import requestIdPlugin from './plugins/requestId.js'
import authPlugin, { requireAdmin } from './plugins/auth.js'
import staticPlugin from './plugins/static.js'
import routes from './routes/index.js'
import { getSwaggerConfig, swaggerUIConfig } from './config/openapi.js'
import { useSecureCookies, apiDocsMode, helmetOptions } from './config/security.js'
import { buildTrustProxyOption, refreshProxyTrust } from './config/proxyTrust.js'
import { warnOnWeakSecurityPosture, noteRequest } from './config/deploymentPosture.js'

export interface ServerOptions {
  logger?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildServer(options: ServerOptions = {}): Promise<any> {
  const logger = createLogger('api')

  const fastify = Fastify({
    loggerInstance: options.logger !== false ? logger : undefined,
    // Default per-request logging is disabled so we can suppress noisy
    // high-frequency poll routes at runtime (see the onRequest/onResponse hooks
    // below and the Settings > System "Quiet poll-route logs" toggle).
    disableRequestLogging: true,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    // Off unless configured. Behind a reverse proxy this must be set, or
    // request.ip is the proxy for every caller and the login rate limiter
    // buckets the whole internet together.
    //
    // Usually a function rather than a value: Fastify consults it per request,
    // which is what lets Settings > Deployment change trusted proxies without a
    // restart. See config/proxyTrust.ts.
    trustProxy: buildTrustProxyOption(),
    ajv: {
      customOptions: {
        // Allow OpenAPI 'example' keyword in schemas for documentation
        keywords: ['example'],
      },
    },
  })

  // Load the stored trusted-proxy list into the matcher the trustProxy function
  // consults. Must happen before the server accepts traffic, or the first
  // requests resolve client IPs as if nothing were trusted.
  await refreshProxyTrust()

  warnOnWeakSecurityPosture((msg) => logger.warn(`⚠️  ${msg}`))

  // Load the quiet-poll-logs setting (DB setting, else QUIET_POLL_LOGS env).
  await refreshQuietPollState()
  // Load the log-masking setting (DB setting, else MASK_LOG_URLS env).
  await refreshLogMaskingState()

  // Custom access logging that reproduces Fastify's default req/res pair, but
  // can skip the silenced poll routes (failures are always logged). This is the
  // documented way to customise request logging alongside disableRequestLogging.
  fastify.addHook('onRequest', (request, _reply, done) => {
    // Cheap sample of what the traffic looks like, so Settings > Deployment can
    // tell a correctly-configured instance from one whose proxy headers are
    // being ignored. Config alone cannot distinguish those two.
    noteRequest(
      request.ip,
      request.socket.remoteAddress,
      request.headers['x-forwarded-for'] !== undefined
    )

    if (shouldLogIncoming(request.url)) {
      request.log.info(
        {
          req: {
            method: request.method,
            url: request.url,
            // Host and client address identify the deployment and its users;
            // both are masked when Settings > System > "Mask server address in
            // logs" is on, so a log can be shared as-is.
            host: maskHost(request.headers.host),
            remoteAddress: maskAddress(request.ip),
            remotePort: request.socket.remotePort,
          },
        },
        'incoming request'
      )
    }
    done()
  })

  fastify.addHook('onResponse', (request, reply, done) => {
    if (shouldLogCompleted(request.url, reply.statusCode)) {
      request.log.info(
        { res: { statusCode: reply.statusCode }, responseTime: reply.elapsedTime },
        'request completed'
      )
    }
    done()
  })

  // Security headers. Policy lives in config/security.ts so it is one
  // reviewable object and can be asserted in tests.
  await fastify.register(helmet, helmetOptions())

  // Register CORS
  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps, curl, etc.)
      if (!origin) {
        cb(null, true)
        return
      }

      // Helper to normalize URLs for comparison (remove trailing slash)
      const normalizeUrl = (url: string) => url.replace(/\/$/, '')
      const normalizedOrigin = normalizeUrl(origin)

      // In development, allow localhost origins and configured external domains
      if (process.env.NODE_ENV !== 'production') {
        const allowedOrigins = [
          'http://localhost:3456',
          'http://localhost:3457',
          'http://127.0.0.1:3456',
          'http://127.0.0.1:3457',
        ]
        // Also allow APP_BASE_URL in development for external access
        const appBaseUrl = process.env.APP_BASE_URL
        if (appBaseUrl) {
          allowedOrigins.push(normalizeUrl(appBaseUrl))
        }
        if (allowedOrigins.some(allowed => normalizedOrigin === normalizeUrl(allowed))) {
          cb(null, true)
          return
        }
      }

      // In production, check against APP_BASE_URL
      const appBaseUrl = process.env.APP_BASE_URL
      if (appBaseUrl && normalizedOrigin === normalizeUrl(appBaseUrl)) {
        cb(null, true)
        return
      }

      // Log the rejected origin for debugging
      logger.warn(
        { origin: maskUrl(origin), appBaseUrl: maskUrl(appBaseUrl) },
        'CORS request rejected - origin not allowed'
      )
      cb(new Error('Not allowed by CORS'), false)
    },
    credentials: true,
  })

  // Register cookie support
  const appBaseUrl = process.env.APP_BASE_URL || ''

  await fastify.register(cookie, {
    secret: process.env.SESSION_SECRET || 'development-secret-change-me',
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: useSecureCookies(),
      path: '/',
    },
  })

  // Register request ID plugin
  await fastify.register(requestIdPlugin)

  // Register auth plugin
  await fastify.register(authPlugin)

  // Rate limiting. Registered after the auth plugin so `keyGenerator` can see
  // the resolved user — hooks run in registration order. Global limiting is off
  // so ordinary browsing (which is poll-heavy) is untouched; routes opt in via
  // `config.rateLimit`. The login route's own limit lives in routes/auth.
  await fastify.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    // Prefer the authenticated identity so several users behind one NAT do not
    // share a bucket; fall back to IP for anonymous callers.
    keyGenerator: (request) => request.user?.id ?? request.ip,
    // Must be an Error carrying statusCode — see rateLimitError in
    // config/rateLimits.ts for why a plain object yields a 500.
    errorResponseBuilder: (_request, context) => {
      const err = new Error(`Rate limit exceeded. Try again in ${context.after}.`) as Error & {
        statusCode: number
      }
      err.statusCode = context.statusCode
      return err
    },
  })

  // Register Swagger/OpenAPI documentation.
  //
  // The UI documents every route and body schema with "Try it out" enabled, so
  // in production it is admin-only by default (API_DOCS=public|admin|off).
  const docsMode = apiDocsMode()
  if (docsMode !== 'off') {
    await fastify.register(swagger, getSwaggerConfig(appBaseUrl))
    await fastify.register(swaggerUI, {
      ...swaggerUIConfig,
      uiHooks: {
        onRequest: async (request, reply) => {
          // Swagger UI bootstraps from an inline script, which the app-wide CSP
          // (scriptSrc 'self') would block, leaving a blank page. Relaxed for
          // this prefix only — it is admin-gated in production. Helmet set the
          // header in an earlier hook; reply.header overwrites it.
          reply.header(
            'Content-Security-Policy',
            [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
            ].join('; ')
          )

          // requireAdmin sends its own 401/403 and resolves; awaiting it lets
          // Fastify short-circuit without invoking the handler.
          if (docsMode === 'admin') await requireAdmin(request, reply)
        },
      },
    })
  } else {
    logger.info('OpenAPI documentation disabled (API_DOCS=off)')
  }

  // Register routes
  await fastify.register(routes)

  // Register static file serving (production only)
  await fastify.register(staticPlugin)

  return fastify
}
