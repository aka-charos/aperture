/**
 * The SMTP transport: one connection per call, closed when the call ends.
 *
 * No database here, so `smtp.test.ts` can drive it against a fake server on
 * localhost. Nothing throws: every outcome is an `SmtpOutcome`, because the
 * callers this exists for — a Test button, and later a notification job — need
 * to report a failure, not unwind from one, and an email that could not be
 * sent must never fail the work that wanted to send it.
 *
 * A connection per call rather than a pool: nothing sends in bulk yet, and a
 * pooled transport outlives the config it was built from, so a saved change
 * would keep sending through the old server until the pool happened to drain.
 */
import { createTransport, type SendMailOptions } from 'nodemailer'
import { createChildLogger } from '../lib/logger.js'
import {
  buildTransportOptions,
  classifySmtpFailure,
  isEmailAddress,
  singleLine,
  smtpFailureDetail,
  type SmtpConfig,
  type SmtpFailure,
} from './rules.js'

const logger = createChildLogger('smtp')

export type SmtpOutcome<T> = { ok: true; value: T } | { ok: false; failure: SmtpFailure; detail: string }

export interface OutgoingEmail {
  /** One bare address. A list is a loop over this, so one refusal costs one message. */
  to: string
  subject: string
  text: string
  /** Optional HTML alternative; `text` is always sent, for clients that read only that. */
  html?: string
}

export interface EmailSender {
  name: string
  address: string
}

export interface SentEmail {
  messageId: string
}

function failed(err: unknown, config: SmtpConfig): { ok: false; failure: SmtpFailure; detail: string } {
  return { ok: false, failure: classifySmtpFailure(err, config), detail: smtpFailureDetail(err) }
}

/** The recipient's domain, for logs: enough to see which provider refused, without the address. */
function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at >= 0 ? address.slice(at + 1) : ''
}

/**
 * Connect, upgrade as the mode requires, and log in — everything a send does
 * except sending. What the Test button runs first, so a working login and a
 * refused sender are told apart.
 */
export async function verifySmtp(config: SmtpConfig): Promise<SmtpOutcome<true>> {
  const transport = createTransport(buildTransportOptions(config))
  try {
    await transport.verify()
    return { ok: true, value: true }
  } catch (err) {
    const outcome = failed(err, config)
    logger.warn({ host: config.host, port: config.port, failure: outcome.failure, detail: outcome.detail }, 'SMTP check failed')
    return outcome
  } finally {
    transport.close()
  }
}

/**
 * Send one message through `config`, whatever its `enabled` switch says —
 * that switch is `sendEmail`'s business, and the Test button has to work
 * before it is on.
 *
 * `Auto-Submitted: auto-generated` (RFC 3834) marks the message as machine
 * sent, which is what stops a recipient's vacation responder from answering
 * it and a mailing list from looping it.
 */
export async function sendWithSmtp(
  config: SmtpConfig,
  sender: EmailSender,
  message: OutgoingEmail
): Promise<SmtpOutcome<SentEmail>> {
  if (!isEmailAddress(message.to)) {
    return { ok: false, failure: 'recipient', detail: 'Not a single plain email address' }
  }
  if (!isEmailAddress(sender.address)) {
    return { ok: false, failure: 'sender', detail: 'The From address is not a single plain email address' }
  }

  const mail: SendMailOptions = {
    from: { name: singleLine(sender.name), address: sender.address },
    to: message.to,
    subject: singleLine(message.subject),
    text: message.text,
    html: message.html,
    headers: { 'Auto-Submitted': 'auto-generated' },
  }

  const transport = createTransport(buildTransportOptions(config))
  try {
    const info = await transport.sendMail(mail)
    logger.info({ messageId: info.messageId, toDomain: domainOf(message.to) }, 'Email sent')
    return { ok: true, value: { messageId: info.messageId } }
  } catch (err) {
    const outcome = failed(err, config)
    logger.warn(
      { host: config.host, toDomain: domainOf(message.to), failure: outcome.failure, detail: outcome.detail },
      'Email not sent'
    )
    return outcome
  } finally {
    transport.close()
  }
}
