/**
 * The one way the app sends email.
 *
 * `sendEmail` (one message) and `sendEmails` (a batch) are what a feature
 * calls: they read the saved settings once, refuse without opening a
 * connection when sending is switched off or incomplete, and fill in the
 * sender. They never throw — a notification that could not be delivered must
 * not fail the work that wanted to send it — so a caller reads the outcome and
 * decides what a failure means for it. A fan-out uses `sendEmails`, which
 * shares one connection and one login across the batch.
 *
 * Whether a particular PERSON should get a particular email is deliberately not
 * decided here. That is a question about the recipient (an address on file,
 * the admin's `emailNotifications` grant, their own opt-in) and belongs with
 * the feature that sends, as one shared predicate, not inside the transport.
 */
import { getAppName } from '../settings/systemSettings.js'
import { getSmtpConfig } from './config.js'
import {
  senderFor,
  smtpProblems,
  type EmailSender,
  type OutgoingEmail,
  type SentEmail,
  type SmtpConfig,
  type SmtpFailure,
  type SmtpOutcome,
} from './rules.js'
import { sendManyWithSmtp, sendWithSmtp } from './smtp.js'

type Prepared = { config: SmtpConfig; sender: EmailSender } | { ok: false; failure: SmtpFailure; detail: string }

/** The saved settings and the sender, read once per call — or why nothing may be sent. */
async function prepare(): Promise<Prepared> {
  const config = await getSmtpConfig()
  if (!config.enabled) {
    return { ok: false, failure: 'disabled', detail: 'Outgoing email is switched off' }
  }
  const problems = smtpProblems(config)
  if (problems.length > 0) {
    return { ok: false, failure: 'notConfigured', detail: `Missing: ${problems.join(', ')}` }
  }
  return { config, sender: senderFor(config, await getAppName()) }
}

export async function sendEmail(message: OutgoingEmail): Promise<SmtpOutcome<SentEmail>> {
  const ready = await prepare()
  if ('ok' in ready) return ready
  return sendWithSmtp(ready.config, ready.sender, message)
}

/** One outcome per message, in order. See `sendManyWithSmtp` for how a batch stops. */
export async function sendEmails(messages: readonly OutgoingEmail[]): Promise<SmtpOutcome<SentEmail>[]> {
  if (messages.length === 0) return []
  const ready = await prepare()
  if ('ok' in ready) return messages.map(() => ready)
  return sendManyWithSmtp(ready.config, ready.sender, messages)
}

/**
 * The Test button's message: plain, short, and saying where it came from, so
 * whoever receives it — not always the admin who pressed the button — can tell
 * it is a check and not something to act on.
 */
export async function sendTestEmail(
  config: SmtpConfig,
  to: string,
  requestedBy: string
): Promise<SmtpOutcome<SentEmail>> {
  const appName = await getAppName()
  return sendWithSmtp(config, senderFor(config, appName), {
    to,
    subject: `${appName}: test email`,
    text: [
      `This is a test message from ${appName}.`,
      '',
      `It was sent through ${config.host}:${config.port} when ${requestedBy} pressed "Send test email" in the admin settings. Receiving it means outgoing email works.`,
      '',
      'There is nothing to do. If you did not expect it, you can ignore it.',
    ].join('\n'),
  })
}
