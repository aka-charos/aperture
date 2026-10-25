/**
 * The SMTP transport.
 *
 * No database here, so `smtp.test.ts` can drive it against a fake server on
 * localhost. Nothing throws: every outcome is an `SmtpOutcome`, because the
 * callers this exists for — a Test button, and later a notification job — need
 * to report a failure, not unwind from one, and an email that could not be
 * sent must never fail the work that wanted to send it.
 *
 * One message is one connection. A batch is one pooled connection for the
 * batch's lifetime, opened and closed by the call: a pool that outlived the
 * call would outlive the config it was built from, so a saved change would
 * keep sending through the old server until the pool happened to drain. One
 * login per batch matters on its own — providers rate-limit logins, and a
 * login per recipient is how a fan-out gets an account locked midway.
 */
import { createTransport, type SendMailOptions } from 'nodemailer'
import { createChildLogger } from '../lib/logger.js'
import {
  buildTransportOptions,
  classifySmtpFailure,
  emailImagesProblem,
  isEmailAddress,
  isSystemicSmtpFailure,
  singleLine,
  smtpFailureDetail,
  SMTP_OPERATION_DEADLINE_MS,
  type EmailSender,
  type OutgoingEmail,
  type SentEmail,
  type SmtpConfig,
  type SmtpFailure,
  type SmtpOutcome,
} from './rules.js'
import { safeUrl } from './template.js'

export type { EmailImage, EmailSender, OutgoingEmail, SentEmail, SmtpOutcome } from './rules.js'

const logger = createChildLogger('smtp')

export interface SmtpCallOptions {
  /** Ceiling for each operation; defaults to SMTP_OPERATION_DEADLINE_MS. */
  deadlineMs?: number
}

type Failed = { ok: false; failure: SmtpFailure; detail: string }

/** What sends a message: a one-shot transport or the batch's pool. */
interface MailSender {
  sendMail(data: SendMailOptions): Promise<{ messageId: string }>
}

function failed(err: unknown, config: SmtpConfig): Failed {
  return { ok: false, failure: classifySmtpFailure(err, config), detail: smtpFailureDetail(err) }
}

/**
 * nodemailer defaults an empty host to 'localhost' — inside the container,
 * the container itself — so an incomplete config is refused here rather than
 * connecting somewhere nobody chose. `sendEmail` and the route check first;
 * this is for any caller that does not.
 */
const NO_HOST: Failed = { ok: false, failure: 'notConfigured', detail: 'No mail server is set' }

/** The recipient's domain, for logs: enough to see which provider refused, without the address. */
function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at >= 0 ? address.slice(at + 1) : ''
}

/**
 * Settle `operation`, or fail once `ms` has passed. nodemailer's own timeouts
 * are inactivity windows, so this is the only ceiling on the whole call. The
 * operation is not interrupted — it ends at its own next timeout — so its late
 * rejection is caught here, where nothing else would be listening for it.
 */
async function withDeadline<T>(operation: Promise<T>, ms: number): Promise<T> {
  operation.catch(() => {})
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const seconds = ms >= 1000 ? `${Math.round(ms / 1000)} seconds` : `${ms} ms`
      reject(Object.assign(new Error(`No answer within ${seconds}`), { code: 'ETIMEDOUT' }))
    }, ms)
  })
  try {
    return await Promise.race([operation, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Connect, upgrade as the mode requires, and log in — everything a send does
 * except sending. What the Test connection button runs.
 */
export async function verifySmtp(config: SmtpConfig, options: SmtpCallOptions = {}): Promise<SmtpOutcome<true>> {
  if (!config.host) return NO_HOST
  const transport = createTransport(buildTransportOptions(config))
  try {
    await withDeadline(transport.verify(), options.deadlineMs ?? SMTP_OPERATION_DEADLINE_MS)
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
 * The message as nodemailer takes it, or why it cannot be sent at all.
 *
 * `Auto-Submitted: auto-generated` (RFC 3834) marks the message as machine
 * sent, which is what stops a recipient's vacation responder from answering
 * it and a mailing list from looping it.
 */
function compose(sender: EmailSender, message: OutgoingEmail): SendMailOptions | Failed {
  if (!isEmailAddress(message.to)) {
    return { ok: false, failure: 'recipient', detail: 'Not a single plain email address' }
  }
  if (!isEmailAddress(sender.address)) {
    return { ok: false, failure: 'sender', detail: 'The From address is not a single plain email address' }
  }
  const images = message.images ?? []
  const imageProblem = emailImagesProblem(images)
  if (imageProblem) return { ok: false, failure: 'invalidMessage', detail: imageProblem }
  const headers: Record<string, string> = { 'Auto-Submitted': 'auto-generated' }
  // One-click unsubscribe only over https: the POST a mail client makes to it
  // carries no credential but the token in the address.
  const unsubscribe = safeUrl(message.unsubscribeUrl)
  if (unsubscribe?.startsWith('https:')) {
    headers['List-Unsubscribe'] = `<${unsubscribe}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }
  return {
    from: { name: singleLine(sender.name), address: sender.address },
    to: message.to,
    subject: singleLine(message.subject),
    text: message.text,
    html: message.html,
    headers,
    // Buffers only, never a path or URL: the transport refuses file and URL
    // access, and an image is fetched (and capped) before it gets here.
    attachments: images.map((image) => ({
      cid: image.cid,
      content: image.content,
      contentType: image.contentType,
      contentDisposition: 'inline' as const,
      filename: `${image.cid}.${image.contentType.split('/')[1]}`,
    })),
  }
}

async function deliver(
  transport: MailSender,
  config: SmtpConfig,
  sender: EmailSender,
  message: OutgoingEmail,
  deadlineMs: number
): Promise<SmtpOutcome<SentEmail>> {
  const mail = compose(sender, message)
  if ('ok' in mail) return mail
  try {
    const info = await withDeadline(transport.sendMail(mail), deadlineMs)
    logger.info({ messageId: info.messageId, toDomain: domainOf(message.to) }, 'Email sent')
    return { ok: true, value: { messageId: info.messageId } }
  } catch (err) {
    const outcome = failed(err, config)
    logger.warn(
      { host: config.host, toDomain: domainOf(message.to), failure: outcome.failure, detail: outcome.detail },
      'Email not sent'
    )
    return outcome
  }
}

/**
 * Send one message through `config`, whatever its `enabled` switch says —
 * that switch is `sendEmail`'s business, and the Test button has to work
 * before it is on.
 */
export async function sendWithSmtp(
  config: SmtpConfig,
  sender: EmailSender,
  message: OutgoingEmail,
  options: SmtpCallOptions = {}
): Promise<SmtpOutcome<SentEmail>> {
  if (!config.host) return NO_HOST
  const transport = createTransport(buildTransportOptions(config))
  try {
    return await deliver(transport, config, sender, message, options.deadlineMs ?? SMTP_OPERATION_DEADLINE_MS)
  } finally {
    transport.close()
  }
}

/**
 * Send several messages over one pooled connection — one connect, one login —
 * and answer one outcome per message, in order.
 *
 * A failure about the connection (see `isSystemicSmtpFailure`) ends the batch:
 * every message after it is answered with the same failure without being
 * attempted. `maxRequeues: 0` because a message whose connection drops
 * mid-send may already have been accepted, and requeueing it risks sending it
 * twice; it is reported as failed instead.
 */
export async function sendManyWithSmtp(
  config: SmtpConfig,
  sender: EmailSender,
  messages: readonly OutgoingEmail[],
  options: SmtpCallOptions = {}
): Promise<SmtpOutcome<SentEmail>[]> {
  if (messages.length === 0) return []
  if (!config.host) return messages.map(() => NO_HOST)

  const deadlineMs = options.deadlineMs ?? SMTP_OPERATION_DEADLINE_MS
  const transport = createTransport({ ...buildTransportOptions(config), pool: true as const, maxConnections: 1, maxRequeues: 0 })
  const outcomes: SmtpOutcome<SentEmail>[] = []
  let stoppedBy: Failed | null = null
  try {
    for (const message of messages) {
      if (stoppedBy) {
        outcomes.push({ ok: false, failure: stoppedBy.failure, detail: `Not attempted after: ${stoppedBy.detail}` })
        continue
      }
      const outcome = await deliver(transport, config, sender, message, deadlineMs)
      outcomes.push(outcome)
      if (!outcome.ok && isSystemicSmtpFailure(outcome.failure)) stoppedBy = outcome
    }
  } finally {
    transport.close()
  }
  return outcomes
}
