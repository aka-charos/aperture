/**
 * Outgoing email (SMTP) settings handlers.
 *
 * Endpoints (all admin):
 * - GET  /api/settings/smtp       - config (password masked) + what is missing
 * - PUT  /api/settings/smtp       - partial update
 * - POST /api/settings/smtp/test  - check the card's settings, saved or not,
 *                                   or send a test message with them
 * - POST /api/settings/smtp/preview - the test message as it would be sent,
 *                                   rendered for the card, in any language
 *
 * Newsletters send through this (core `newsletter/`). It is the connection that
 * features send through, by calling core `sendEmail`/`sendEmails`; see core
 * `email/`. What an update may change, and where the stored password may go,
 * is core `email/settings.ts` — pure and pinned, not decided here.
 */
import type { FastifyInstance } from 'fastify'
import {
  APP_LOCALE_OPTIONS,
  buildTestEmail,
  emailLinkBaseFor,
  getAppName,
  getSmtpConfig,
  getSystemLanguageDefaults,
  isValidAppLocale,
  resolveEffectiveUiLanguage,
  isEmailAddress,
  mergeSmtpSettings,
  publicSmtpConfig,
  sendTestEmail,
  setSmtpConfig,
  smtpConfigError,
  smtpProblems,
  smtpUpdateTypeError,
  storedPasswordScope,
  verifySmtp,
  SMTP_DEFAULT_PORTS,
  SMTP_SECURITY_MODES,
  type SmtpConfig,
  type SmtpProblem,
  type SmtpSettingsUpdate,
  type SmtpTestRequest,
} from '@aperture/core'
import { queryOne } from '../../../lib/db.js'
import { requireAdmin, type SessionUser } from '../../../plugins/auth.js'

const PROBLEM_WORDS: Record<SmtpProblem, string> = {
  host: 'the server',
  fromAddress: 'a From address',
  password: 'the password',
}

/**
 * A refusal for missing settings. `problems` rides beside the sentence as
 * stable ids, so the card can name the missing fields in the reader's language
 * rather than showing this English sentence.
 */
function missing(problems: SmtpProblem[], before: string) {
  return {
    error: `Fill in ${problems.map((p) => PROBLEM_WORDS[p]).join(', ')} ${before}`,
    problems,
  }
}

/** The admin's own address, offered as the test recipient. Absent when none is on file. */
async function ownAddress(userId: string): Promise<string | null> {
  const row = await queryOne<{ email: string | null }>('SELECT email FROM users WHERE id = $1', [userId])
  return row?.email && isEmailAddress(row.email) ? row.email : null
}

/**
 * Everything the card renders, as decided values: what is missing, the
 * security modes and their conventional ports, where the stored password may
 * be used, the name used when no From name is set, and who a test goes to by
 * default. The bundle never imports core, so none of these may be recomputed
 * there.
 */
async function settingsResponse(config: SmtpConfig, user: SessionUser) {
  return {
    config: publicSmtpConfig(config),
    problems: smtpProblems(config),
    securityModes: SMTP_SECURITY_MODES,
    defaultPorts: SMTP_DEFAULT_PORTS,
    storedPassword: storedPasswordScope(config),
    // Where links in emails point now, and where they would point with the
    // public address left blank (APP_BASE_URL, unless it is a loopback).
    linkBase: emailLinkBaseFor(config),
    fallbackLinkBase: emailLinkBaseFor({ ...config, publicUrl: '' }),
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

  fastify.put<{ Body: SmtpSettingsUpdate }>(
    '/api/settings/smtp',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const wrongType = smtpUpdateTypeError(request.body)
        if (wrongType) return reply.status(400).send({ error: wrongType })

        const next = mergeSmtpSettings(await getSmtpConfig(), request.body ?? {}, 'save')
        const invalid = smtpConfigError(next)
        if (invalid) return reply.status(400).send({ error: invalid })
        // Switching sending on with something missing would store a switch
        // that reads as on and sends nothing, so it is refused instead.
        const problems = smtpProblems(next)
        if (next.enabled && problems.length > 0) {
          return reply.status(400).send(missing(problems, 'before switching sending on'))
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
   * switched on — the point is to find out before switching it on. Without
   * `sendTo` it checks the connection (connect, upgrade, log in); with it, it
   * sends the test message, which does all of that on its own connection, so
   * there is no separate check first. The failure id says which step refused.
   */
  fastify.post<{ Body: SmtpTestRequest }>(
    '/api/settings/smtp/test',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const wrongType = smtpUpdateTypeError(request.body)
        if (wrongType) return reply.status(400).send({ success: false, error: wrongType })
        const body = request.body ?? {}

        const config = mergeSmtpSettings(await getSmtpConfig(), body, 'test')
        const invalid = smtpConfigError(config)
        if (invalid) return reply.status(400).send({ success: false, error: invalid })

        const sendTo = body.sendTo?.trim() || null
        // A check needs a server and, with a login, its password; only
        // sending needs a From address.
        const problems = smtpProblems(config).filter((p) => p !== 'fromAddress' || sendTo)
        if (problems.length > 0) {
          return reply.status(400).send({ success: false, ...missing(problems, 'to run the test') })
        }
        if (sendTo && !isEmailAddress(sendTo)) {
          return reply.status(400).send({ success: false, error: 'Send the test to one plain email address' })
        }

        if (!sendTo) {
          const check = await verifySmtp(config)
          return reply.send(
            check.ok
              ? { success: true, stage: 'connect', host: config.host }
              : { success: false, stage: 'connect', host: config.host, failure: check.failure, detail: check.detail }
          )
        }

        const user = request.user as SessionUser
        // In the language of the admin who asked: they are the one reading it.
        const sent = await sendTestEmail(
          config,
          sendTo,
          user.displayName || user.username,
          await resolveEffectiveUiLanguage(user.id)
        )
        return reply.send(
          sent.ok
            ? { success: true, stage: 'send', host: config.host, sentTo: sendTo }
            : { success: false, stage: 'send', host: config.host, failure: sent.failure, detail: sent.detail }
        )
      } catch (err) {
        fastify.log.error({ err }, 'Failed to test SMTP')
        return reply.status(500).send({ success: false, error: 'Failed to test the email settings' })
      }
    }
  )

  /**
   * The test message as it would be sent with the card's settings, rendered
   * for display: subject, HTML and plain text. Sends nothing and connects to
   * nothing. `lang` picks the language (default: the admin's own), so an admin
   * can see what a recipient reading another language — or right to left —
   * would get.
   */
  fastify.post<{ Body: SmtpTestRequest & { lang?: string } }>(
    '/api/settings/smtp/preview',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const { lang, ...update } = request.body ?? {}
        const wrongType = smtpUpdateTypeError(update)
        if (wrongType) return reply.status(400).send({ error: wrongType })
        if (lang !== undefined && !isValidAppLocale(lang)) {
          return reply.status(400).send({ error: 'Unknown language' })
        }

        const config = mergeSmtpSettings(await getSmtpConfig(), update, 'test')
        const invalid = smtpConfigError(config)
        if (invalid) return reply.status(400).send({ error: invalid })

        const user = request.user as SessionUser
        const locale = lang ?? (await resolveEffectiveUiLanguage(user.id))
        // A preview with no server set yet still reads sensibly.
        const shown = config.host ? config : { ...config, host: 'smtp.example.com' }
        const rendered = await buildTestEmail(shown, locale, user.displayName || user.username)
        // Only the languages a recipient can actually have on this instance.
        const { enabledUiLanguages } = await getSystemLanguageDefaults()
        const languages = APP_LOCALE_OPTIONS.filter((o) => enabledUiLanguages.includes(o.code) || o.code === locale)
        return reply.send({ ...rendered, lang: locale, languages })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to render the email preview')
        return reply.status(500).send({ error: 'Failed to render the email preview' })
      }
    }
  )
}
