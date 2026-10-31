/**
 * The email channel: one message per person per run, listing everything new
 * on the events they switched email on for, in their own language.
 *
 * Each person's cursor (`notification_email_state.reported_until`) moves only
 * when their message was sent or there was nothing to send, so a refused
 * message is retried on the next run. When outgoing email is switched off or
 * not set up, the cursors move anyway: nothing could have been sent, and
 * holding them would mail a backlog the moment email came back. And someone
 * who stops qualifying (every email event switched off, no address, no
 * permission, no access) loses their cursor, so coming back starts from then.
 */
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { resolveEffectiveUiLanguage } from '../lib/userSettings.js'
import { appLink } from '../email/links.js'
import { emailContextFor, sendEmails } from '../email/send.js'
import { emailText, type EmailStringKey } from '../email/strings.js'
import { renderEmail } from '../email/template.js'
import type { OutgoingEmail } from '../email/rules.js'
import { collectNotifications, type NotificationItem } from './events.js'
import { NOTIFICATION_EVENTS, SETTLE_MS, checkWindow, emailReachability } from './rules.js'

const logger = createChildLogger('notifications:email')

export interface NotificationEmailResult {
  people: number
  started: number
  sent: number
  failed: number
  nothingNew: number
  cancelled: boolean
}

export interface NotificationEmailOptions {
  shouldCancel?: () => boolean
  log?: (level: 'info' | 'warn', message: string) => void
}

/** Never "Outgoing email is off" as a failure: those runs advance and send nothing. */
const SETUP_FAILURES = new Set(['disabled', 'notConfigured'])

async function buildEmail(to: string, locale: string, items: NotificationItem[]): Promise<OutgoingEmail> {
  const context = await emailContextFor(locale)
  const appName = context.frame.appName
  const t = (key: EmailStringKey, vars: Record<string, string> = {}) => emailText(context.locale, key, { appName, ...vars })
  const subject =
    items.length === 1
      ? t('notifications.subjectOne', { title: items[0].title })
      : t('notifications.subjectMany', { count: String(items.length) })
  const rendered = renderEmail(
    {
      subject,
      preheader: items[0].body,
      heading: t('notifications.heading'),
      paragraphs: [t('notifications.intro')],
      items: items.map((item) => ({ title: item.title, note: item.body, url: appLink(context.linkBase, item.path) })),
      footer: [t('notifications.why')],
    },
    context.frame
  )
  return { to, ...rendered }
}

export async function sendNotificationEmails(options: NotificationEmailOptions = {}): Promise<NotificationEmailResult> {
  const log = options.log ?? (() => undefined)
  const result: NotificationEmailResult = { people: 0, started: 0, sent: 0, failed: 0, nothingNew: 0, cancelled: false }
  const now = new Date()

  // Everyone with an event switched on for email, and everyone still holding a
  // cursor (whose cursor goes if they no longer qualify). Who may actually
  // receive email is decided per person below, by the rule the card shows.
  const people = await query<{
    id: string
    email: string | null
    email_notifications_allowed: boolean | null
    is_enabled: boolean
    provider_disabled: boolean | null
    reported_until: Date | null
    email_events: string[]
  }>(
    `SELECT u.id, u.email, u.email_notifications_allowed, u.is_enabled, u.provider_disabled, s.reported_until,
            ARRAY(SELECT p.event FROM user_notification_preferences p WHERE p.user_id = u.id AND p.email) AS email_events
       FROM users u
       LEFT JOIN notification_email_state s ON s.user_id = u.id
      WHERE s.user_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM user_notification_preferences p WHERE p.user_id = u.id AND p.email)`
  )

  const pending: { userId: string; until: Date; message: OutgoingEmail }[] = []

  for (const person of people.rows) {
    if (options.shouldCancel?.() === true) {
      result.cancelled = true
      return result
    }
    const unreachable = emailReachability({
      email: person.email,
      emailAllowed: person.email_notifications_allowed === true,
      isEnabled: person.is_enabled === true,
      providerDisabled: person.provider_disabled === true,
    })
    const events = NOTIFICATION_EVENTS.filter((event) => person.email_events.includes(event))
    if (unreachable || events.length === 0) {
      if (person.reported_until != null) await forget(person.id)
      continue
    }
    result.people++

    const window = checkWindow(person.reported_until, now)
    if (!window) {
      // First run for this person: start from now, never from the past.
      await advance(person.id, new Date(now.getTime() - SETTLE_MS))
      result.started++
      continue
    }

    const locale = await resolveEffectiveUiLanguage(person.id)
    const items = await collectNotifications(person.id, events, window, locale)
    if (items.length === 0) {
      await advance(person.id, window.until)
      result.nothingNew++
      continue
    }
    pending.push({ userId: person.id, until: window.until, message: await buildEmail(person.email!, locale, items) })
  }

  const outcomes = await sendEmails(pending.map((entry) => entry.message))
  for (const [index, outcome] of outcomes.entries()) {
    const entry = pending[index]
    if (outcome.ok) {
      result.sent++
      await advance(entry.userId, entry.until)
    } else if (SETUP_FAILURES.has(outcome.failure)) {
      await advance(entry.userId, entry.until)
    } else {
      result.failed++
      logger.warn({ userId: entry.userId, failure: outcome.failure, detail: outcome.detail }, 'Notification email not sent')
      log('warn', `A notification email was not sent (${outcome.failure}): ${outcome.detail}`)
    }
  }
  if (outcomes.length > 0 && !outcomes[0].ok && SETUP_FAILURES.has(outcomes[0].failure)) {
    log('warn', 'Outgoing email is off or not set up, so nothing was sent')
  }
  return result
}

/** Someone who stopped qualifying; their next eligible run starts from then. */
async function forget(userId: string): Promise<void> {
  await query(`DELETE FROM notification_email_state WHERE user_id = $1`, [userId])
}

async function advance(userId: string, until: Date): Promise<void> {
  await query(
    `INSERT INTO notification_email_state (user_id, reported_until) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET reported_until = EXCLUDED.reported_until`,
    [userId, until]
  )
}
