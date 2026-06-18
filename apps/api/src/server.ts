import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import { createLogger } from './lib/logger.js'
import { refreshQuietPollState, shouldLogIncoming, shouldLogCompleted } from './config/logging.js'
import requestIdPlugin from './plugins/requestId.js'
import authPlugin from './plugins/auth.js'
import staticPlugin from './plugins/static.js'
import routes from './routes/index.js'
import { getSwaggerConfig, swaggerUIConfig } from './config/openapi.js'

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
    ajv: {
      customOptions: {
        // Allow OpenAPI 'example' keyword in schemas for documentation
        keywords: ['example'],
      },
    },
  })

  // Load the quiet-poll-logs setting (DB setting, else QUIET_POLL_LOGS env).
  await refreshQuietPollState()

  // Custom access logging that reproduces Fastify's default req/res pair, but
  // can skip the silenced poll routes (failures are always logged). This is the
  // documented way to customise request logging alongside disableRequestLogging.
  fastify.addHook('onRequest', (request, _reply, done) => {
    if (shouldLogIncoming(request.url)) {
      request.log.info(
        {
          req: {
            method: request.method,
            url: request.url,
            host: request.headers.host,
            remoteAddress: request.ip,
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
      logger.warn({ origin, appBaseUrl }, 'CORS request rejected - origin not allowed')
      cb(new Error('Not allowed by CORS'), false)
    },
    credentials: true,
  })

  // Register cookie support
  // Only use secure cookies if APP_BASE_URL is HTTPS
  const appBaseUrl = process.env.APP_BASE_URL || ''
  const useSecureCookies = appBaseUrl.startsWith('https://')
  
  await fastify.register(cookie, {
    secret: process.env.SESSION_SECRET || 'development-secret-change-me',
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: useSecureCookies,
      path: '/',
    },
  })

  // Register request ID plugin
  await fastify.register(requestIdPlugin)

  // Register Swagger/OpenAPI documentation
  await fastify.register(swagger, getSwaggerConfig(appBaseUrl))
  await fastify.register(swaggerUI, swaggerUIConfig)

  // Register auth plugin
  await fastify.register(authPlugin)

  // Register routes
  await fastify.register(routes)

  // Register static file serving (production only)
  await fastify.register(staticPlugin)

  return fastify
}
