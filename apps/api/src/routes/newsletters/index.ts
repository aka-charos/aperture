/**
 * Newsletters: admin-written email to send groups, and each viewer's opt-in.
 *
 * Admin (all `requireAdmin`):
 * - GET    /api/newsletters/options          - languages, title fields, whether email can send one
 * - GET    /api/newsletters                  - every newsletter, newest edit first
 * - POST   /api/newsletters                  - a new draft
 * - GET    /api/newsletters/:id
 * - PUT    /api/newsletters/:id              - save a draft (or a failed send)
 * - DELETE /api/newsletters/:id
 * - POST   /api/newsletters/:id/duplicate    - a new draft with the same content
 * - POST   /api/newsletters/preview          - the editor's content rendered in a language
 * - POST   /api/newsletters/test             - the editor's content sent to the admin's own address
 * - POST   /api/newsletters/audience         - who a send to these groups would reach
 * - POST   /api/newsletters/:id/send         - start sending; 202, then poll the newsletter
 * - GET    /api/newsletters/:id/deliveries
 * - GET/POST/PUT/DELETE /api/newsletter-groups[...]   - send groups and their hand-picked members
 *
 * Viewer:
 * - GET/PUT /api/newsletter/subscription     - the signed-in person's OWN opt-in
 *
 * Public:
 * - GET/POST /api/newsletter/unsubscribe?token=  - the link in every newsletter
 *
 * Who receives what is core `newsletter/audience.ts`; how a copy is built per
 * reader (language, library scope) is core `newsletter/build.ts`.
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import {
  APP_LOCALE_OPTIONS,
  DEFAULT_TITLE_FIELDS,
  GROUP_ROLES,
  TITLE_FIELDS,
  createNewsletter,
  createNewsletterGroup,
  deleteNewsletter,
  deleteNewsletterGroup,
  emailLocale,
  emailText,
  escapeHtml,
  findNewsletterToken,
  getAppName,
  getGroupMemberModes,
  getNewsletter,
  getNewsletterGroup,
  getNewsletterSubscription,
  getSystemLanguageDefaults,
  isEmailAddress,
  isValidAppLocale,
  listNewsletterDeliveries,
  listNewsletterGroups,
  listNewsletters,
  loadAudienceUsers,
  loadGroupDefinitions,
  membership,
  newsletterDocumentProblem,
  newsletterEligibility,
  newsletterSendingProblem,
  previewNewsletter,
  readGroupRules,
  resolveEffectiveUiLanguage,
  sendNewsletterTest,
  setGroupMemberMode,
  setNewsletterOptIn,
  startNewsletterSend,
  summarizeAudience,
  updateNewsletter,
  updateNewsletterGroup,
  type AppLocaleCode,
  type NewsletterDraft,
} from '@aperture/core'
import { queryOne } from '../../lib/db.js'
import { requireAdmin, requireAuth } from '../../plugins/auth.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUBJECT_MAX = 200
const PREHEADER_MAX = 200
const GROUP_NAME_MAX = 80

const draftBody = {
  type: 'object',
  properties: {
    subject: { type: 'string', maxLength: SUBJECT_MAX },
    preheader: { type: 'string', maxLength: PREHEADER_MAX },
    content: { type: 'object', additionalProperties: true },
    groupIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
  },
} as const

interface DraftBody {
  subject?: string
  preheader?: string
  content?: unknown
  groupIds?: string[]
}

const EMPTY_DOC = { type: 'doc', content: [] }

/** A draft from a request body, or why it cannot be saved. */
function readDraft(body: DraftBody): NewsletterDraft | { error: string } {
  const content = body.content ?? EMPTY_DOC
  const problem = newsletterDocumentProblem(content)
  if (problem) return { error: problem }
  const groupIds = [...new Set(body.groupIds ?? [])]
  if (groupIds.some((id) => !UUID.test(id))) return { error: 'Unknown send group' }
  return {
    subject: (body.subject ?? '').trim(),
    preheader: (body.preheader ?? '').trim(),
    content,
    groupIds,
  }
}

const groupBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: GROUP_NAME_MAX },
    description: { type: 'string', maxLength: 500 },
    rules: {
      type: 'object',
      properties: {
        match: { type: 'string', enum: ['rules', 'none'] },
        languages: { type: 'array', items: { type: 'string' } },
        role: { type: 'string', enum: [...GROUP_ROLES] },
      },
    },
  },
} as const

interface GroupBody {
  name: string
  description?: string
  rules?: unknown
}

function readGroup(body: GroupBody) {
  return {
    name: body.name.trim(),
    description: (body.description ?? '').trim(),
    rules: readGroupRules(body.rules),
  }
}

/** Why a send was refused, as an HTTP answer. */
const START_REFUSAL: Record<string, { status: number; error: string }> = {
  notFound: { status: 404, error: 'Newsletter not found' },
  notEditable: { status: 409, error: 'This newsletter has already been sent or is being sent' },
  noSubject: { status: 400, error: 'Give the newsletter a subject first' },
  noGroups: { status: 400, error: 'Choose at least one send group' },
  noRecipients: {
    status: 400,
    error: 'Nobody in these groups can receive it: they need an email address and to have switched newsletters on',
  },
  invalidContent: { status: 400, error: 'The newsletter content cannot be sent' },
  sending: { status: 409, error: 'Outgoing email cannot send newsletters yet' },
}

const SENDING_PROBLEM_TEXT: Record<string, string> = {
  smtpOff: 'Outgoing email is switched off',
  smtpIncomplete: 'Outgoing email is not fully set up',
  noPublicUrl: 'Set a public address under Outgoing email: every newsletter carries an unsubscribe link',
}

function previewLanguage(value: unknown, fallback: AppLocaleCode): AppLocaleCode {
  return typeof value === 'string' && isValidAppLocale(value) ? value : fallback
}

const newslettersRoutes: FastifyPluginAsync = async (fastify) => {
  // ------------------------------------------------------------ options

  fastify.get('/api/newsletters/options', { preHandler: requireAdmin }, async () => {
    const [defaults, sendingProblem] = await Promise.all([getSystemLanguageDefaults(), newsletterSendingProblem()])
    return {
      languages: APP_LOCALE_OPTIONS.filter((option) => defaults.enabledUiLanguages.includes(option.code)),
      defaultLanguage: defaults.defaultUiLanguage,
      titleFields: TITLE_FIELDS,
      defaultTitleFields: DEFAULT_TITLE_FIELDS,
      sendingProblem,
      sendingProblemText: sendingProblem ? SENDING_PROBLEM_TEXT[sendingProblem] : null,
    }
  })

  // -------------------------------------------------------- newsletters

  fastify.get('/api/newsletters', { preHandler: requireAdmin }, async () => ({ newsletters: await listNewsletters() }))

  fastify.post<{ Body: DraftBody }>(
    '/api/newsletters',
    { preHandler: requireAdmin, schema: { body: draftBody } },
    async (request, reply) => {
      const draft = readDraft(request.body ?? {})
      if ('error' in draft) return reply.status(400).send({ error: draft.error })
      return reply.status(201).send({ newsletter: await createNewsletter(draft, request.user!.id) })
    }
  )

  fastify.get<{ Params: { id: string } }>('/api/newsletters/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const newsletter = UUID.test(request.params.id) ? await getNewsletter(request.params.id) : null
    if (!newsletter) return reply.status(404).send({ error: 'Newsletter not found' })
    return { newsletter }
  })

  fastify.put<{ Params: { id: string }; Body: DraftBody }>(
    '/api/newsletters/:id',
    { preHandler: requireAdmin, schema: { body: draftBody } },
    async (request, reply) => {
      if (!UUID.test(request.params.id)) return reply.status(404).send({ error: 'Newsletter not found' })
      const draft = readDraft(request.body ?? {})
      if ('error' in draft) return reply.status(400).send({ error: draft.error })
      const newsletter = await updateNewsletter(request.params.id, draft)
      if (!newsletter) {
        return reply
          .status(409)
          .send({ error: 'Only a draft can be edited; duplicate a sent or partly sent newsletter to reuse it' })
      }
      return { newsletter }
    }
  )

  fastify.delete<{ Params: { id: string } }>(
    '/api/newsletters/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!UUID.test(request.params.id) || !(await deleteNewsletter(request.params.id))) {
        return reply.status(404).send({ error: 'Newsletter not found, or it is being sent' })
      }
      return { ok: true }
    }
  )

  fastify.post<{ Params: { id: string } }>(
    '/api/newsletters/:id/duplicate',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const source = UUID.test(request.params.id) ? await getNewsletter(request.params.id) : null
      if (!source) return reply.status(404).send({ error: 'Newsletter not found' })
      const newsletter = await createNewsletter(
        { subject: source.subject, preheader: source.preheader, content: source.content, groupIds: source.groupIds },
        request.user!.id
      )
      return reply.status(201).send({ newsletter })
    }
  )

  fastify.post<{ Body: DraftBody & { language?: string } }>(
    '/api/newsletters/preview',
    {
      preHandler: requireAdmin,
      schema: { body: { ...draftBody, properties: { ...draftBody.properties, language: { type: 'string' } } } },
    },
    async (request, reply) => {
      const draft = readDraft(request.body ?? {})
      if ('error' in draft) return reply.status(400).send({ error: draft.error })
      const language = previewLanguage(request.body?.language, await resolveEffectiveUiLanguage(request.user!.id))
      const rendered = await previewNewsletter(draft, language)
      return { language, subject: rendered.subject, html: rendered.html, text: rendered.text }
    }
  )

  fastify.post<{ Body: DraftBody & { language?: string } }>(
    '/api/newsletters/test',
    {
      preHandler: requireAdmin,
      schema: { body: { ...draftBody, properties: { ...draftBody.properties, language: { type: 'string' } } } },
    },
    async (request, reply) => {
      const draft = readDraft(request.body ?? {})
      if ('error' in draft) return reply.status(400).send({ error: draft.error })
      const row = await queryOne<{ email: string | null }>(`SELECT email FROM users WHERE id = $1`, [request.user!.id])
      if (!isEmailAddress(row?.email)) {
        return reply.status(400).send({ error: 'Your account has no email address to send a test to' })
      }
      const language = previewLanguage(request.body?.language, await resolveEffectiveUiLanguage(request.user!.id))
      const outcome = await sendNewsletterTest(
        { ...draft, subject: draft.subject || '(no subject)' },
        row!.email!,
        language
      )
      if (!outcome.ok) return reply.status(502).send({ error: outcome.detail, failure: outcome.failure })
      return { ok: true, to: row!.email }
    }
  )

  fastify.post<{ Body: { groupIds?: string[] } }>(
    '/api/newsletters/audience',
    {
      preHandler: requireAdmin,
      schema: {
        body: { type: 'object', properties: { groupIds: { type: 'array', items: { type: 'string' }, maxItems: 50 } } },
      },
    },
    async (request) => {
      const ids = (request.body?.groupIds ?? []).filter((id) => UUID.test(id))
      return summarizeAudience(ids)
    }
  )

  fastify.post<{ Params: { id: string } }>(
    '/api/newsletters/:id/send',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!UUID.test(request.params.id)) return reply.status(404).send({ error: 'Newsletter not found' })
      const result = await startNewsletterSend(request.params.id)
      if (!result.ok) {
        const refusal = START_REFUSAL[result.reason] ?? { status: 400, error: 'The newsletter cannot be sent' }
        const detail =
          result.reason === 'sending' && result.detail ? SENDING_PROBLEM_TEXT[result.detail] : result.detail
        return reply.status(refusal.status).send({ error: detail ? `${refusal.error}: ${detail}` : refusal.error })
      }
      request.log.info({ newsletterId: request.params.id, recipients: result.recipients }, 'Newsletter send started')
      return reply.status(202).send({ recipients: result.recipients })
    }
  )

  fastify.get<{ Params: { id: string } }>(
    '/api/newsletters/:id/deliveries',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!UUID.test(request.params.id)) return reply.status(404).send({ error: 'Newsletter not found' })
      return { deliveries: await listNewsletterDeliveries(request.params.id) }
    }
  )

  // ------------------------------------------------------------- groups

  fastify.get('/api/newsletter-groups', { preHandler: requireAdmin }, async () => {
    const [groups, users] = await Promise.all([listNewsletterGroups(), loadAudienceUsers()])
    // Counts per group, from the same rules and member loader the send uses.
    const definitions = new Map((await loadGroupDefinitions(groups.map((g) => g.id))).map((d) => [d.id, d]))
    return {
      groups: groups.map((group) => {
        const modes = definitions.get(group.id)?.members ?? new Map()
        const members = users.filter((user) => membership(user, group.rules, modes.get(user.id)).member)
        return {
          ...group,
          memberCount: members.length,
          recipientCount: members.filter((user) => newsletterEligibility(user) === null).length,
        }
      }),
    }
  })

  fastify.post<{ Body: GroupBody }>(
    '/api/newsletter-groups',
    { preHandler: requireAdmin, schema: { body: groupBody } },
    async (request, reply) => {
      const input = readGroup(request.body)
      if (!input.name) return reply.status(400).send({ error: 'Give the group a name' })
      return reply.status(201).send({ group: await createNewsletterGroup(input) })
    }
  )

  fastify.put<{ Params: { id: string }; Body: GroupBody }>(
    '/api/newsletter-groups/:id',
    { preHandler: requireAdmin, schema: { body: groupBody } },
    async (request, reply) => {
      const input = readGroup(request.body)
      if (!input.name) return reply.status(400).send({ error: 'Give the group a name' })
      const group = UUID.test(request.params.id) ? await updateNewsletterGroup(request.params.id, input) : null
      if (!group) return reply.status(404).send({ error: 'Send group not found' })
      return { group }
    }
  )

  fastify.delete<{ Params: { id: string } }>(
    '/api/newsletter-groups/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!UUID.test(request.params.id) || !(await deleteNewsletterGroup(request.params.id))) {
        return reply.status(404).send({ error: 'Send group not found' })
      }
      return { ok: true }
    }
  )

  /** Every account, with whether and why it is in the group and whether it can receive. */
  fastify.get<{ Params: { id: string } }>(
    '/api/newsletter-groups/:id/members',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const group = UUID.test(request.params.id) ? await getNewsletterGroup(request.params.id) : null
      if (!group) return reply.status(404).send({ error: 'Send group not found' })
      const [users, modes] = await Promise.all([loadAudienceUsers(), getGroupMemberModes(group.id)])
      return {
        group,
        users: users.map((user) => {
          const mode = modes.get(user.id) ?? null
          const { member, reason } = membership(user, group.rules, mode ?? undefined)
          return {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            isAdmin: user.isAdmin,
            language: user.language,
            mode,
            member,
            reason,
            ineligible: newsletterEligibility(user),
          }
        }),
      }
    }
  )

  fastify.put<{ Params: { id: string; userId: string }; Body: { mode: 'include' | 'exclude' | null } }>(
    '/api/newsletter-groups/:id/members/:userId',
    {
      preHandler: requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['mode'],
          properties: { mode: { type: ['string', 'null'], enum: ['include', 'exclude', null] } },
        },
      },
    },
    async (request, reply) => {
      const { id, userId } = request.params
      if (!UUID.test(id) || !UUID.test(userId) || !(await getNewsletterGroup(id))) {
        return reply.status(404).send({ error: 'Send group not found' })
      }
      const exists = await queryOne<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [userId])
      if (!exists) return reply.status(404).send({ error: 'User not found' })
      await setGroupMemberMode(id, userId, request.body.mode)
      return { ok: true }
    }
  )

  // -------------------------------------------------------------- opt-in

  /**
   * The signed-in person's own subscription. There is deliberately no admin
   * variant: subscribing someone is the one thing an admin may not do for
   * them, which is what makes the opt-in mean anything.
   */
  fastify.get('/api/newsletter/subscription', { preHandler: requireAuth }, async (request, reply) => {
    const [subscription, sendingProblem] = await Promise.all([
      getNewsletterSubscription(request.user!.id),
      newsletterSendingProblem(),
    ])
    if (!subscription) return reply.status(404).send({ error: 'User not found' })
    return {
      optedIn: subscription.optedIn,
      hasAddress: isEmailAddress(subscription.email),
      // Decided here so the card can say why nothing would arrive.
      available: sendingProblem === null,
    }
  })

  fastify.put<{ Body: { optedIn: boolean } }>(
    '/api/newsletter/subscription',
    {
      preHandler: requireAuth,
      schema: { body: { type: 'object', required: ['optedIn'], properties: { optedIn: { type: 'boolean' } } } },
    },
    async (request) => {
      await setNewsletterOptIn(request.user!.id, request.body.optedIn)
      return { optedIn: request.body.optedIn }
    }
  )

  // --------------------------------------------------------- unsubscribe

  // A mail client's one-click unsubscribe (RFC 8058) POSTs a form body, as
  // either encoding the RFC allows. The token in the address is the whole
  // request, so the body is accepted and never read. multipart/form-data is
  // already parsed by @fastify/multipart (registered in server.ts), and adding
  // a second parser for it throws at boot, so only the urlencoded one is added.
  if (!fastify.hasContentTypeParser('application/x-www-form-urlencoded')) {
    fastify.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, body, done) => done(null, body)
    )
  }

  /**
   * The link in a newsletter. A GET only shows a confirm button and changes
   * nothing, because mail scanners and link previews open every link in a
   * message; the POST (the button, or a mail client's own Unsubscribe) does it.
   */
  fastify.get<{ Querystring: { token?: string } }>('/api/newsletter/unsubscribe', async (request, reply) => {
    const holder = await findNewsletterToken(request.query.token ?? '')
    const locale = holder ? await resolveEffectiveUiLanguage(holder.userId) : 'en'
    return sendPage(reply, locale, holder ? (holder.optedIn ? 'confirm' : 'already') : 'unknown')
  })

  fastify.post<{ Querystring: { token?: string } }>('/api/newsletter/unsubscribe', async (request, reply) => {
    const holder = await findNewsletterToken(request.query.token ?? '')
    if (!holder) return sendPage(reply, 'en', 'unknown', 404)
    await setNewsletterOptIn(holder.userId, false)
    request.log.info({ userId: holder.userId }, 'Unsubscribed from newsletters by link')
    return sendPage(reply, await resolveEffectiveUiLanguage(holder.userId), 'done')
  })
}

type PageState = 'confirm' | 'already' | 'done' | 'unknown'

const PAGE_TEXT: Record<PageState, { heading: Parameters<typeof emailText>[1]; body: Parameters<typeof emailText>[1] }> = {
  confirm: { heading: 'newsletter.page.confirmHeading', body: 'newsletter.page.confirmBody' },
  already: { heading: 'newsletter.page.doneHeading', body: 'newsletter.page.alreadyBody' },
  done: { heading: 'newsletter.page.doneHeading', body: 'newsletter.page.doneBody' },
  unknown: { heading: 'newsletter.page.unknownHeading', body: 'newsletter.page.unknownBody' },
}

/** A tiny self-contained page: no app bundle, since the reader may not be signed in. */
async function sendPage(reply: FastifyReply, localeCode: string, state: PageState, status = 200) {
  const { code, rtl } = emailLocale(localeCode)
  const appName = await getAppName()
  const t = (key: Parameters<typeof emailText>[1]) => escapeHtml(emailText(code, key, { appName }))
  const button =
    state === 'confirm'
      ? `<form method="post"><button type="submit" style="font:inherit;padding:10px 18px;border-radius:6px;border:0;background:#374151;color:#fff;cursor:pointer;">${t('newsletter.unsubscribe')}</button></form>`
      : ''
  const html =
    `<!DOCTYPE html><html lang="${code}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
    `<title>${escapeHtml(appName)}</title></head>` +
    `<body style="margin:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">` +
    `<main style="max-width:480px;margin:48px auto;background:#fff;border-radius:8px;padding:28px;">` +
    `<div style="font-weight:700;margin-bottom:12px;">${escapeHtml(appName)}</div>` +
    `<h1 style="font-size:20px;margin:0 0 10px;">${t(PAGE_TEXT[state].heading)}</h1>` +
    `<p style="line-height:1.5;margin:0 0 18px;">${t(PAGE_TEXT[state].body)}</p>` +
    button +
    `</main></body></html>`
  return reply.status(status).header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(html)
}

export default newslettersRoutes
