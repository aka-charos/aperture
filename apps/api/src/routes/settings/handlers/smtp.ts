/**
 * Outgoing email (SMTP) settings handlers.
 *
 * Endpoints (all admin):
 * - GET  /api/settings/smtp       - config (password masked) + what is missing
 * - PUT  /api/settings/smtp       - partial update
 * - POST /api/settings/smtp/test  - check the card's settings, saved or not,
 *                                   and optionally send a test message
 *
 * Nothing in the app sends email through this yet. It is the connection that
 * features send through, by calling core `sendEmail`; see core `email/`.
 */
import type { FastifyInstance } from 'fastify'
import {
  getAppName,
  getSmtpConfig,
  isEmailAddress,
  isSmtpSecurity,
  sanitizeSmtpConfig,
  sendTestEmail,
  setSmtpConfig,
  smtpConfigError,
  smtpProblems,
  storedPasswordFor,
  verifySmtp,
  SMTP_DEFAULT_PORTS,
  type SmtpConfig,
  type SmtpProblem,
} from '@aperture/core'
import { queryOne } from '../../../lib/db.js'
import { requireAdmin, type SessionUser } from '../../../plugins/auth.js'

interface SmtpUpdateBody {
  enabled?: boolean
  host?: string
  port?: number
  security?: string
  allowSelfSigned?: boolean
  username?: string
  /**
   * Omitted keeps the stored password — but only while the host stays the
   * one it was saved for. An empty string clears it.
   */
  password?: string
  fromAddress?: string
  fromName?: string
}

interface SmtpTestBody extends SmtpUpdateBody {
  /** Also send a test message here once the check passes. Omitted means check only. */
  sendTo?: string
}

interface PublicSmtpConfig {
  enabled: boolean
  host: string
  port: number
  security: SmtpConfig['security']
  allowSelfSigned: boolean
  username: string
  hasPassword: boolean
  fromAddress: string
  fromName: string
}

function toPublicConfig(config: SmtpConfig): PublicSmtpConfig {
  return {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    security: config.security,
    allowSelfSigned: config.allowSelfSigned,
    username: config.username,
    hasPassword: !!config.password,
    fromAddress: config.fromAddress,
    fromName: config.fromName,
  }
}

/**
 * The body has no JSON schema, so a field can arrive as anything. A wrong type
 * is refused here, before `sanitizeSmtpConfig` would quietly turn it into a
 * default — a mistyped port silently becoming 587 is a setting nobody chose.
 */
function typeError(body: SmtpTestBody): string | null {
  for (const key of ['enabled', 'allowSelfSigned'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') return `${key} must be true or false`
  }
  for (const key of ['host', 'security', 'username', 'password', 'fromAddress', 'fromName', 'sendTo'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') return `${key} must be a string`
  }
  if (body.port !== undefined && !(Number.isInteger(body.port) && body.port >= 1 && body.port <= 65535)) {
    return 'Port must be a whole number from 1 to 65535'
  }
  if (body.security !== undefined && !isSmtpSecurity(body.security)) {
    return 'Security must be starttls, tls or none'
  }
  return null
}

/**
 * The settings as they would stand after this body. Two rules about the
 * password live here so Save and Test cannot differ on them: a stored password
 * follows only the host it was saved for (`storedPasswordFor`), and a config
 * with no username keeps no password, since nothing would ever send it.
 */
function merge(current: SmtpConfig, body: SmtpUpdateBody): SmtpConfig {
  const host = body.host ?? current.host
  const username = (body.username ?? current.username).trim()
  return sanitizeSmtpConfig({
    enabled: body.enabled ?? current.enabled,
    host,
    port: body.port ?? current.port,
    security: isSmtpSecurity(body.security) ? body.security : current.security,
    allowSelfSigned: body.allowSelfSigned ?? current.allowSelfSigned,
    username,
    password: !username ? '' : body.password === undefined ? storedPasswordFor(current, host) : body.password,
    fromAddress: body.fromAddress ?? current.fromAddress,
    fromName: body.fromName ?? current.fromName,
  })
}

const PROBLEM_WORDS: Record<SmtpProblem, string> = {
  host: 'the server',
  fromAddress: 'a From address',
  password: 'the password',
}

function missingSentence(problems: SmtpProblem[], before: string): string {
  return `Fill in ${problems.map((p) => PROBLEM_WORDS[p]).join(', ')} ${before}`
}

/** The admin's own address, offered as the test recipient. Absent when none is on file. */
async function ownAddress(userId: string): Promise<string | null> {
  const row = await queryOne<{ email: string | null }>('SELECT email FROM users WHERE id = $1', [userId])
  return row?.email && isEmailAddress(row.email) ? row.email : null
}

/**
 * Everything the card renders, as decided values: what is missing, the
 * conventional port per mode, the name used when no From name is set, and who
 * a test goes to by default. The bundle never imports core, so none of these
 * may be recomputed there.
 */
async function settingsResponse(config: SmtpConfig, user: SessionUser) {
  return {
    config: toPublicConfig(config),
    problems: smtpProblems(config),
    defaultPorts: SMTP_DEFAULT_PORTS,
    defaultFromName: await getAppName(),
    testRecipient: await ownAddress(user.id),
  }
}

export function registerSmtpHandlers(fastify: FastifyInstance) {
  fastify.get('/api/settings/smtp', { preHandler: requireAdmin, schema: { tags: ['settings'] } }, async (request, reply) => {
    try {
      return reply.send(await settingsResponse(await getSmtpConfig(), request.user as SessionUser))
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get SMTP config')
      return reply.status(500).send({ error: 'Failed to get the email settings' })
    }
  })

  fastify.put<{ Body: SmtpUpdateBody }>(
    '/api/settings/smtp',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const body = request.body ?? {}
        const wrongType = typeError(body)
        if (wrongType) return reply.status(400).send({ error: wrongType })

        const next = merge(await getSmtpConfig(), body)
        const invalid = smtpConfigError(next)
        if (invalid) return reply.status(400).send({ error: invalid })
        // Switching sending on with something missing would store a switch
        // that reads as on and sends nothing, so it is refused instead.
        const problems = smtpProblems(next)
        if (next.enabled && problems.length > 0) {
          return reply.status(400).send({ error: missingSentence(problems, 'before switching sending on') })
        }

        await setSmtpConfig(next)
        return reply.send(await settingsResponse(next, request.user as SessionUser))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to save SMTP config')
        return reply.status(500).send({ error: 'Failed to save the email settings' })
      }
    }
  )

  /**
   * Tests what is on the card, saved or not, whether or not sending is
   * switched on — the point is to find out before switching it on. The check
   * runs first (connect, upgrade, log in) and the test message only after it
   * passes, so a refused login and a refused From address are told apart.
   *
   * A blank password means the stored one, for the host it was stored for.
   */
  fastify.post<{ Body: SmtpTestBody }>(
    '/api/settings/smtp/test',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const body = request.body ?? {}
        const wrongType = typeError(body)
        if (wrongType) return reply.status(400).send({ success: false, error: wrongType })

        const config = merge(await getSmtpConfig(), { ...body, password: body.password || undefined })
        const invalid = smtpConfigError(config)
        if (invalid) return reply.status(400).send({ success: false, error: invalid })

        const sendTo = body.sendTo?.trim() || null
        // A check needs a server and, with a login, its password; only
        // sending needs a From address.
        const missing = smtpProblems(config).filter((p) => p !== 'fromAddress' || sendTo)
        if (missing.length > 0) {
          return reply.status(400).send({ success: false, error: missingSentence(missing, 'to run the test') })
        }
        if (sendTo && !isEmailAddress(sendTo)) {
          return reply.status(400).send({ success: false, error: 'Send the test to one plain email address' })
        }

        const check = await verifySmtp(config)
        if (!check.ok) {
          return reply.send({ success: false, stage: 'connect', failure: check.failure, detail: check.detail })
        }
        if (!sendTo) return reply.send({ success: true, stage: 'connect' })

        const user = request.user as SessionUser
        const sent = await sendTestEmail(config, sendTo, user.displayName || user.username)
        if (!sent.ok) {
          return reply.send({ success: false, stage: 'send', failure: sent.failure, detail: sent.detail })
        }
        return reply.send({ success: true, stage: 'send', sentTo: sendTo })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to test SMTP')
        return reply.status(500).send({ success: false, error: 'Failed to test the email settings' })
      }
    }
  )
}
