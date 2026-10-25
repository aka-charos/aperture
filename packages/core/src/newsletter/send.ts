/**
 * Previewing, testing and sending a newsletter.
 *
 * A send runs in the background: the route answers at once and the console
 * polls the newsletter's row, because a household's worth of messages through
 * one SMTP login can take longer than a reverse proxy holds a request open
 * (F-141). The status moves `draft|failed → sending` in ONE conditional
 * UPDATE, so two clicks cannot send twice, and every message sent is recorded
 * in `newsletter_deliveries` — a send retried after a failure skips anyone
 * already sent to.
 *
 * A newsletter is refused without a public address for links: every copy
 * carries an unsubscribe link, and a newsletter without one is the kind of
 * mail people report as spam.
 */
import { inlineImagesForPreview, renderEmail, type RenderedEmail } from '../email/template.js'
import { getSmtpConfig } from '../email/config.js'
import { appLink } from '../email/links.js'
import { emailContext, sendEmail, sendEmails, type EmailContext } from '../email/send.js'
import { smtpProblems, type OutgoingEmail, type SmtpFailure } from '../email/rules.js'
import { query, queryOne } from '../lib/db.js'
import type { AppLocaleCode } from '../lib/locales.js'
import { createChildLogger } from '../lib/logger.js'
import { resolveRecipients, type AudienceUser } from './audience.js'
import {
  buildNewsletterContent,
  loadLanguageEdition,
  prepareNewsletter,
  visibleTitlesByUser,
  type NewsletterEnvelope,
} from './build.js'
import { newsletterDocumentProblem, readNewsletterDocument } from './document.js'
import { getNewsletter, loadAudienceUsers, loadGroupDefinitions } from './store.js'

const logger = createChildLogger('newsletter')

export interface NewsletterInput extends NewsletterEnvelope {
  content: unknown
}

/** Why outgoing email cannot carry a newsletter right now, or null. */
export async function newsletterSendingProblem(): Promise<'smtpOff' | 'smtpIncomplete' | 'noPublicUrl' | null> {
  const config = await getSmtpConfig()
  if (!config.enabled) return 'smtpOff'
  if (smtpProblems(config).length > 0) return 'smtpIncomplete'
  const context = await emailContext(config, null)
  return context.linkBase ? null : 'noPublicUrl'
}

/** The rendered email as one reader in `language` would get it, every title shown. */
export async function previewNewsletter(input: NewsletterInput, language: AppLocaleCode): Promise<RenderedEmail> {
  const parts = readNewsletterDocument(input.content)
  const prepared = await prepareNewsletter(parts)
  const context = await emailContext(await getSmtpConfig(), language)
  const edition = await loadLanguageEdition(parts, prepared.facts, context.locale)
  const { content, images } = buildNewsletterContent({
    envelope: input,
    parts,
    facts: prepared.facts,
    edition,
    images: prepared.images,
    context,
    copy: { visibleTitles: null, unsubscribeUrl: appLink(context.linkBase, '/settings?tab=account') },
  })
  const rendered = renderEmail(content, context.frame)
  return { ...rendered, html: inlineImagesForPreview(rendered.html, images) }
}

/** Send the current editor content to one address (the admin's own), as a check. */
export async function sendNewsletterTest(
  input: NewsletterInput,
  to: string,
  language: AppLocaleCode
): Promise<{ ok: true } | { ok: false; failure: SmtpFailure; detail: string }> {
  const parts = readNewsletterDocument(input.content)
  const prepared = await prepareNewsletter(parts)
  const context = await emailContext(await getSmtpConfig(), language)
  const edition = await loadLanguageEdition(parts, prepared.facts, context.locale)
  const { content, images } = buildNewsletterContent({
    envelope: { ...input, subject: input.subject },
    parts,
    facts: prepared.facts,
    edition,
    images: prepared.images,
    context,
    copy: { visibleTitles: null, unsubscribeUrl: null },
  })
  const outcome = await sendEmail({ to, ...renderEmail(content, context.frame), images })
  return outcome.ok ? { ok: true } : outcome
}

export interface AudienceSummary {
  recipients: Array<Pick<AudienceUser, 'id' | 'username' | 'displayName' | 'email' | 'language'>>
  byLanguage: Partial<Record<AppLocaleCode, number>>
}

/** Who a send to these groups would reach right now. The same resolution the send uses. */
export async function summarizeAudience(groupIds: readonly string[]): Promise<AudienceSummary> {
  const [users, groups] = await Promise.all([loadAudienceUsers(), loadGroupDefinitions(groupIds)])
  const recipients = resolveRecipients(users, groups)
  const byLanguage: Partial<Record<AppLocaleCode, number>> = {}
  for (const user of recipients) byLanguage[user.language] = (byLanguage[user.language] ?? 0) + 1
  return {
    recipients: recipients.map(({ id, username, displayName, email, language }) => ({
      id,
      username,
      displayName,
      email,
      language,
    })),
    byLanguage,
  }
}

export type StartSendResult =
  | { ok: true; recipients: number }
  | {
      ok: false
      reason: 'notFound' | 'notEditable' | 'noSubject' | 'noGroups' | 'noRecipients' | 'invalidContent' | 'sending'
      detail?: string
    }

/**
 * Start sending a saved newsletter. Answers once the recipients are known and
 * the status has moved to `sending`; the messages go out after it returns.
 */
export async function startNewsletterSend(id: string): Promise<StartSendResult> {
  const newsletter = await getNewsletter(id)
  if (!newsletter) return { ok: false, reason: 'notFound' }
  if (newsletter.status !== 'draft' && newsletter.status !== 'failed') return { ok: false, reason: 'notEditable' }
  if (!newsletter.subject.trim()) return { ok: false, reason: 'noSubject' }
  if (newsletter.groupIds.length === 0) return { ok: false, reason: 'noGroups' }
  const problem = newsletterDocumentProblem(newsletter.content)
  if (problem) return { ok: false, reason: 'invalidContent', detail: problem }
  const sendingProblem = await newsletterSendingProblem()
  if (sendingProblem) return { ok: false, reason: 'sending', detail: sendingProblem }

  const [users, groups, alreadySent] = await Promise.all([
    loadAudienceUsers(),
    loadGroupDefinitions(newsletter.groupIds),
    query<{ user_id: string }>(
      `SELECT user_id FROM newsletter_deliveries WHERE newsletter_id = $1 AND status = 'sent' AND user_id IS NOT NULL`,
      [id]
    ),
  ])
  const sent = new Set(alreadySent.rows.map((row) => row.user_id))
  const recipients = resolveRecipients(users, groups).filter((user) => !sent.has(user.id))
  if (recipients.length === 0) {
    // A retry with nobody left (those it failed for unsubscribed or lost
    // access meanwhile) has reached everyone it still can: it is sent, or it
    // would read as unfinished forever with no way to finish it.
    if (newsletter.status === 'failed' && sent.size > 0) {
      await query(
        `UPDATE newsletters SET status = 'sent', sent_at = NOW(), last_error = NULL, updated_at = NOW()
          WHERE id = $1 AND status = 'failed'`,
        [id]
      )
      // The failed rows stay: they are the record of who it never reached.
      return { ok: true, recipients: 0 }
    }
    return { ok: false, reason: 'noRecipients' }
  }

  const claimed = await queryOne<{ id: string }>(
    `UPDATE newsletters
        SET status = 'sending', send_started_at = NOW(), recipient_count = $2, failed_count = 0,
            last_error = NULL, updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'failed')
      RETURNING id`,
    [id, recipients.length + sent.size]
  )
  if (!claimed) return { ok: false, reason: 'notEditable' }
  // A retry sends again to those it failed for; their old rows would block the new ones.
  await query(`DELETE FROM newsletter_deliveries WHERE newsletter_id = $1 AND status = 'failed'`, [id])

  // Nothing awaits this, so it must never reject: an unhandled rejection
  // takes the API down.
  void deliver(id, { subject: newsletter.subject, preheader: newsletter.preheader }, newsletter.content, recipients)
    .catch(async (err) => {
      logger.error({ err, newsletterId: id }, 'Newsletter send failed')
      await query(
        `UPDATE newsletters SET status = 'failed', last_error = $2, updated_at = NOW() WHERE id = $1`,
        [id, err instanceof Error ? err.message : String(err)]
      ).catch(() => undefined)
    })
  return { ok: true, recipients: recipients.length }
}

async function deliver(
  id: string,
  envelope: NewsletterEnvelope,
  doc: unknown,
  recipients: readonly AudienceUser[]
): Promise<void> {
  const parts = readNewsletterDocument(doc)
  const prepared = await prepareNewsletter(parts)
  const visible = await visibleTitlesByUser(
    recipients.map((r) => r.id),
    prepared.refs
  )
  const tokens = await query<{ id: string; newsletter_token: string }>(
    `SELECT id, newsletter_token FROM users WHERE id = ANY($1::uuid[])`,
    [recipients.map((r) => r.id)]
  )
  const tokenOf = new Map(tokens.rows.map((row) => [row.id, row.newsletter_token]))
  const config = await getSmtpConfig()

  const byLanguage = new Map<AppLocaleCode, AudienceUser[]>()
  for (const user of recipients) byLanguage.set(user.language, [...(byLanguage.get(user.language) ?? []), user])

  let sentCount = 0
  let failedCount = 0
  let lastError: string | null = null
  for (const [language, readers] of byLanguage) {
    const context: EmailContext = await emailContext(config, language)
    const edition = await loadLanguageEdition(parts, prepared.facts, context.locale)
    const messages: OutgoingEmail[] = readers.map((reader) => {
      const token = tokenOf.get(reader.id)
      const unsubscribeUrl = token
        ? appLink(context.linkBase, `/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`)
        : null
      const { content, images } = buildNewsletterContent({
        envelope,
        parts,
        facts: prepared.facts,
        edition,
        images: prepared.images,
        context,
        copy: { visibleTitles: visible.get(reader.id) ?? new Set(), unsubscribeUrl },
      })
      return { to: reader.email!, ...renderEmail(content, context.frame), images, unsubscribeUrl: unsubscribeUrl ?? undefined }
    })

    const outcomes = await sendEmails(messages)
    for (const [i, outcome] of outcomes.entries()) {
      const reader = readers[i]!
      if (outcome.ok) sentCount += 1
      else {
        failedCount += 1
        lastError = `${outcome.failure}: ${outcome.detail}`
      }
      await query(
        `INSERT INTO newsletter_deliveries (newsletter_id, user_id, email, language, status, error)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (newsletter_id, user_id) WHERE user_id IS NOT NULL DO NOTHING`,
        [id, reader.id, reader.email, language, outcome.ok ? 'sent' : 'failed', outcome.ok ? null : `${outcome.failure}: ${outcome.detail}`]
      )
    }
    await query(`UPDATE newsletters SET sent_count = sent_count + $2, failed_count = $3 WHERE id = $1`, [
      id,
      outcomes.filter((o) => o.ok).length,
      failedCount,
    ])
  }

  // Sent once nobody is left to retry for; failed if anyone was missed, so the
  // console offers a retry that reaches exactly them.
  await query(
    `UPDATE newsletters SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
            last_error = $3, updated_at = NOW()
      WHERE id = $1`,
    [id, failedCount === 0 ? 'sent' : 'failed', lastError]
  )
  logger.info({ newsletterId: id, sent: sentCount, failed: failedCount }, 'Newsletter send finished')
}

/**
 * Sends left `sending` by a restart can never finish (the work was in this
 * process). Called once at startup: they read as failed, and a retry reaches
 * whoever was not sent to.
 */
export async function recoverInterruptedNewsletterSends(): Promise<void> {
  try {
    await query(
      `UPDATE newsletters SET status = 'failed', last_error = 'Interrupted by a restart', updated_at = NOW()
        WHERE status = 'sending'`
    )
  } catch (err) {
    logger.warn({ err }, 'Could not recover interrupted newsletter sends')
  }
}
