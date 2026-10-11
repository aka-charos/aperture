/**
 * The one way the app sends email.
 *
 * `sendEmail` is what a feature calls: it reads the saved settings, refuses
 * without opening a connection when sending is switched off or incomplete, and
 * fills in the sender. It never throws — a notification that could not be
 * delivered must not fail the work that wanted to send it — so a caller reads
 * the outcome and decides what a failure means for it.
 *
 * Whether a particular PERSON should get a particular email is deliberately not
 * decided here. That is a question about the recipient (an address on file,
 * the admin's `emailNotifications` grant, their own opt-in) and belongs with
 * the feature that sends, as one shared predicate, not inside the transport.
 */
import { getAppName } from '../settings/systemSettings.js'
import { getSmtpConfig } from './config.js'
import { smtpProblems, type SmtpConfig } from './rules.js'
import {
  sendWithSmtp,
  type EmailSender,
  type OutgoingEmail,
  type SentEmail,
  type SmtpOutcome,
} from './smtp.js'

/** The From header: the configured name, or the instance name when there is none. */
export async function senderFor(config: SmtpConfig): Promise<EmailSender> {
  return { name: config.fromName || (await getAppName()), address: config.fromAddress }
}

export async function sendEmail(message: OutgoingEmail): Promise<SmtpOutcome<SentEmail>> {
  const config = await getSmtpConfig()
  if (!config.enabled) {
    return { ok: false, failure: 'disabled', detail: 'Outgoing email is switched off' }
  }
  const problems = smtpProblems(config)
  if (problems.length > 0) {
    return { ok: false, failure: 'notConfigured', detail: `Missing: ${problems.join(', ')}` }
  }
  return sendWithSmtp(config, await senderFor(config), message)
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
  const sender = await senderFor(config)
  return sendWithSmtp(config, sender, {
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
