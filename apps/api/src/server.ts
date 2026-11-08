import Fastify, { type FastifyBaseLogger, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import { createLogger } from './lib/logger.js'
import { refreshQuietPollState, shouldLogIncoming, shouldLogCompleted } from './config/logging.js'
import { isContainerProbe, shouldLogContainerProbe } from './config/healthProbe.js'
import { refreshLogMaskingState, maskHost, maskAddress, maskUrl } from './config/logMasking.js'
import requestIdPlugin from './plugins/requestId.js'
import authPlugin, { requireAdmin } from './plugins/auth.js'
import staticPlugin from './plugins/static.js'
import routes from './routes/index.js'
import { getSwaggerConfig, swaggerUIConfig } from './config/openapi.js'
import { useSecureCookies, apiDocsMode, helmetOptions, robotsTagHook } from './config/security.js'
import { buildTrustProxyOption, isTrustedPeer, refreshProxyTrust } from './config/proxyTrust.js'
import { corsDelegator } from './config/cors.js'
import { AJV_OPTIONS } from './config/ajv.js'
import { warnOnWeakSecurityPosture, noteRequest } from './config/deploymentPosture.js'

export interface ServerOptions {
  logger?: boolean
  /** Replaces the app's logger, so a test can read the lines it writes. */
  loggerInstance?: FastifyBaseLogger
}

/** Ceiling for a multipart upload unless its route sets another; backups do (`BACKUP_UPLOAD_MAX_BYTES`). */
const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024

function fromContainerProbe(request: FastifyRequest): boolean {
  return isContainerProbe(
    request.url,
    request.socket.remoteAddress,
    request.headers['x-forwarded-for'] !== undefined
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildServer(options: ServerOptions = {}): Promise<any> {
  const logger = createLogger('api')

  const fastify = Fastify({
    loggerInstance: options.loggerInstance ?? (options.logger !== false ? logger : undefined),
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
    ajv: AJV_OPTIONS,
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
    // The container's own health check says nothing about who reaches this
    // server: it would raise "all traffic from one address" on an idle instance
    // and hide it on one where it is true, and its lines would swamp the log.
    if (fromContainerProbe(request)) {
      done()
      return
    }

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
    const probe = fromContainerProbe(request)
    const logIt = probe
      ? shouldLogContainerProbe(reply.statusCode)
      : shouldLogCompleted(request.url, reply.statusCode)
    if (logIt) {
      request.log.info(
        {
          res: { statusCode: reply.statusCode },
          responseTime: reply.elapsedTime,
          // A silenced request has no "incoming request" line naming it.
          ...(probe || !shouldLogIncoming(request.url) ? { url: request.url } : {}),
        },
        'request completed'
      )
    }
    done()
  })

  // Security headers. Policy lives in config/security.ts so it is one
  // reviewable object and can be asserted in tests.
  await fastify.register(helmet, helmetOptions())

  // Keep the instance out of search results. A separate hook because helmet has
  // no option for this header; onRequest at root scope so it covers static
  // assets and the SPA fallback as well as every API route.
  fastify.addHook('onRequest', robotsTagHook)

  // Register CORS. Which origins pass, and how, is decided in config/cors.ts.
  await fastify.register(cors, {
    delegator: corsDelegator({
      peerIsTrusted: isTrustedPeer,
      onRefused: (origin) =>
        logger.warn(
          { origin: maskUrl(origin), appBaseUrl: maskUrl(process.env.APP_BASE_URL) },
          'CORS request rejected - origin not allowed'
        ),
    }),
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

  // Multipart support for file uploads.
  //
  // This has to be registered at the root. A plugin-scoped registration is
  // invisible to sibling plugins: the parser and `request.file()` land in the
  // scope that registered them and go no further. It previously lived inside
  // the image routes, which left every multipart POST under /api/backup and
  // /api/setup/backup failing with 415 before the handler ever ran.
  //
  // Routes needing another bound pass their own `limits` to `request.file()`. Over
  // the bound the stream ends early with no error: read `file.truncated`.
  await fastify.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_FILE_SIZE,
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
