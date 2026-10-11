/**
 * Outgoing email over SMTP: the rules, with no I/O.
 *
 * Everything here is pure so it can be pinned without a mail server or a
 * database: what a stored config means, what is missing from it, which
 * nodemailer options it becomes, and what a failed attempt was. What a settings
 * request may change is `settings.ts`; the transport is `smtp.ts`, storage is
 * `config.ts`, and `send.ts` is the one way the rest of the app sends.
 */
import type { SMTPTransportOptions } from 'nodemailer'
import { normalizePublicUrl, publicUrlProblem } from './links.js'

/**
 * How the connection is encrypted.
 *
 * - `starttls` connects in the clear and upgrades. The upgrade is REQUIRED: a
 *   server that does not offer it fails the attempt before AUTH, so a
 *   misconfigured or tampered-with server never receives the password in
 *   plain text. That is why it is the default and not the opportunistic form.
 * - `tls` is encrypted from the first byte (implicit TLS, usually port 465).
 * - `none` never upgrades, even when offered. For a relay on the same machine
 *   or a trusted network, which often presents a certificate nothing can verify.
 */
export const SMTP_SECURITY_MODES = ['starttls', 'tls', 'none'] as const
export type SmtpSecurity = (typeof SMTP_SECURITY_MODES)[number]

export function isSmtpSecurity(value: unknown): value is SmtpSecurity {
  return typeof value === 'string' && (SMTP_SECURITY_MODES as readonly string[]).includes(value)
}

/**
 * The port each mode is conventionally served on. The card offers it when the
 * mode changes and never forces it — submission servers on other ports exist.
 */
export const SMTP_DEFAULT_PORTS: Readonly<Record<SmtpSecurity, number>> = {
  starttls: 587,
  tls: 465,
  none: 25,
}

/** The one port where implicit TLS is the convention. */
const IMPLICIT_TLS_PORT = 465

/**
 * Timeouts for one attempt. nodemailer's defaults (two minutes to connect,
 * ten of socket inactivity) are sized for a mail daemon; here an admin is
 * waiting on a Test button and, later, a job is waiting on a notification.
 * A healthy server answers each of these in well under a second.
 */
export const SMTP_CONNECTION_TIMEOUT_MS = 15_000
export const SMTP_GREETING_TIMEOUT_MS = 15_000
export const SMTP_SOCKET_TIMEOUT_MS = 30_000
export const SMTP_DNS_TIMEOUT_MS = 10_000

/**
 * The most one operation — a check, or one message — may take in total.
 *
 * The timeouts above are each an INACTIVITY window, so a server answering every
 * few seconds can hold a connection open indefinitely, and the Test button's
 * request with it. A request held past the least patient hop in front of the
 * API dies there while the work carries on (nginx's default is 60s,
 * Cloudflare's tunnel 100s — F-141), so this sits under both.
 */
export const SMTP_OPERATION_DEADLINE_MS = 45_000

export const SMTP_FROM_NAME_MAX_LENGTH = 100

export interface SmtpConfig {
  /** Whether anything may send. Off by default; the Test button works either way. */
  enabled: boolean
  host: string
  port: number
  security: SmtpSecurity
  /** Encrypt but skip certificate verification. Ignored under `none`. */
  allowSelfSigned: boolean
  /** Blank means the server takes mail without a login (a local relay). */
  username: string
  password: string
  fromAddress: string
  /** Blank means the instance name, resolved at send time so a rename follows. */
  fromName: string
  /**
   * The name sent with EHLO. Blank leaves it to nodemailer, which uses the
   * machine's host name when it has a dot in it and `[127.0.0.1]` otherwise —
   * and inside Docker the host name is a bare container id, so it is always the
   * loopback literal there, which a strict MTA refuses or scores as forged.
   */
  ehloName: string
  /**
   * The address recipients reach the app at, for links in emails. Blank falls
   * back to APP_BASE_URL; a loopback address means no links (see `links.ts`).
   */
  publicUrl: string
}

export const DEFAULT_SMTP_CONFIG: Readonly<SmtpConfig> = {
  enabled: false,
  host: '',
  port: SMTP_DEFAULT_PORTS.starttls,
  security: 'starttls',
  allowSelfSigned: false,
  username: '',
  password: '',
  fromAddress: '',
  fromName: '',
  ehloName: '',
  publicUrl: '',
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535
}

/**
 * An IPv6 literal is usually written in brackets (`[fd00::25]`), which is the
 * URL form; a host field wants it bare. Unwrapped rather than refused, since
 * the bracketed form is what anyone copying it from elsewhere will paste.
 */
function unbracketed(host: string): string {
  const match = /^\[([0-9A-Fa-f:.]+)\]$/.exec(host)
  return match ? match[1] : host
}

/**
 * A stored blob, made whole. Absent fields take their defaults, so a config
 * written before a field existed still reads as a complete one; absent
 * `enabled` reads as OFF.
 *
 * Absence is checked BEFORE coercion: `Number(null)` is 0 and finite, so a
 * missing port would otherwise become an invalid one instead of the default.
 * An absent or invalid port falls back to the convention for the stored mode,
 * not to a fixed number, so a `tls` config never reads back as port 587.
 *
 * The password is trimmed like every other field: a newline or space pasted
 * along with it is far commoner than a password that really ends in one.
 */
export function sanitizeSmtpConfig(raw: Partial<SmtpConfig> | null | undefined): SmtpConfig {
  const input = raw ?? {}
  const security = isSmtpSecurity(input.security) ? input.security : DEFAULT_SMTP_CONFIG.security
  const port =
    input.port == null
      ? SMTP_DEFAULT_PORTS[security]
      : typeof input.port === 'number' || typeof input.port === 'string'
        ? Number(input.port)
        : NaN
  return {
    enabled: input.enabled === true,
    host: unbracketed(trimmed(input.host)),
    port: isPort(port) ? port : SMTP_DEFAULT_PORTS[security],
    security,
    allowSelfSigned: input.allowSelfSigned === true,
    username: trimmed(input.username),
    password: trimmed(input.password),
    fromAddress: trimmed(input.fromAddress),
    fromName: trimmed(input.fromName),
    ehloName: trimmed(input.ehloName),
    publicUrl: normalizePublicUrl(trimmed(input.publicUrl)),
  }
}

/**
 * A bare address, `local@domain`, and nothing else: no display name, no
 * comment, no list. Deliberately strict about the characters that make an
 * address field mean more than one address (`,` `;` `<` `>`) or end a header
 * (any whitespace, which covers CR and LF), since every address here is
 * either typed by an admin or read from a user row and then handed to a mail
 * server. Deliberately loose about everything else — the server is the judge
 * of what it will deliver to, and `user@localhost` is a real relay address.
 *
 * This is also the test every write to `users.email` applies, so an address a
 * person can save is one a message can be sent to.
 */
const BARE_ADDRESS = /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+$/
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

export function isEmailAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    BARE_ADDRESS.test(value) &&
    !CONTROL_CHARACTER.test(value)
  )
}

/**
 * A host name or an IP literal. One colon is refused rather than allowed,
 * because `smtp.example.com:587` pasted whole is far commoner than anything
 * else with one colon in it, and it fails as a DNS lookup that reads like a
 * wrong host. Two or more is an IPv6 address.
 */
const HOST = /^[A-Za-z0-9._:-]{1,253}$/

export type SmtpHostProblem = 'scheme' | 'port' | 'characters'

export function smtpHostProblem(host: string): SmtpHostProblem | null {
  if (!host) return null
  if (host.includes('://')) return 'scheme'
  if (!HOST.test(host)) return 'characters'
  if ((host.match(/:/g) ?? []).length === 1) return 'port'
  return null
}

/** A dotted host name, or an address literal (`[192.0.2.1]`, `[IPv6:2001:db8::1]`) — what RFC 5321 lets EHLO carry. */
const EHLO_HOST_NAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/
const EHLO_ADDRESS_LITERAL = /^\[(?:[0-9.]+|IPv6:[0-9A-Fa-f:.]+)\]$/

export function isEhloName(value: string): boolean {
  return EHLO_HOST_NAME.test(value) || EHLO_ADDRESS_LITERAL.test(value)
}

/**
 * What stops a config from sending, as stable ids the card translates. Shipped
 * as a DECIDED value — the bundle never imports core — so the card cannot
 * disagree with the route about what "configured" means.
 */
export const SMTP_PROBLEMS = ['host', 'fromAddress', 'password'] as const
export type SmtpProblem = (typeof SMTP_PROBLEMS)[number]

export function smtpProblems(config: SmtpConfig): SmtpProblem[] {
  const problems: SmtpProblem[] = []
  if (!config.host) problems.push('host')
  if (!isEmailAddress(config.fromAddress)) problems.push('fromAddress')
  // A login with no password can only fail, and nodemailer would say so as
  // "Missing credentials", which reads like a server refusal.
  if (config.username && !config.password) problems.push('password')
  return problems
}

/**
 * The write-time check: a value that would be stored wrong is refused with a
 * sentence, never cleaned up. `sanitizeSmtpConfig` handles what is already
 * stored; this answers what someone is asking to store.
 */
export function smtpConfigError(config: SmtpConfig): string | null {
  const hostProblem = smtpHostProblem(config.host)
  if (hostProblem === 'scheme') return 'Enter the server name only, without smtp:// or smtps://'
  if (hostProblem === 'port') return 'Enter the port in the Port field, not after the server name'
  if (hostProblem === 'characters') return 'The server name holds characters a host name cannot'
  if (!isPort(config.port)) return 'Port must be a whole number from 1 to 65535'
  if (config.fromAddress && !isEmailAddress(config.fromAddress)) {
    return 'The From address must be a single plain address, like aperture@example.com'
  }
  if (CONTROL_CHARACTER.test(config.fromName)) return 'The From name cannot contain line breaks'
  if (config.fromName.length > SMTP_FROM_NAME_MAX_LENGTH) {
    return `The From name can be at most ${SMTP_FROM_NAME_MAX_LENGTH} characters`
  }
  if (CONTROL_CHARACTER.test(config.username) || CONTROL_CHARACTER.test(config.password)) {
    return 'The username and password cannot contain line breaks'
  }
  if (config.ehloName && !isEhloName(config.ehloName)) {
    return 'The EHLO name must be a host name like mail.example.com, or an address literal like [192.0.2.1]'
  }
  return publicUrlProblem(config.publicUrl)
}

/**
 * The nodemailer options a config becomes.
 *
 * `forceAuth` whenever a username is set: without it nodemailer logs in only
 * if the server ADVERTISES AUTH, and skips it silently otherwise — so a
 * relay that hides AUTH (Postfix with `smtpd_tls_auth_only` under `none`, a
 * port-25 relay) passed the Test button with a wrong password and then sent
 * unauthenticated, to be refused at the recipient as "relay access denied".
 * Forced, a server that cannot take the login says so at once.
 *
 * `disableFileAccess`/`disableUrlAccess` are set although nothing here sends
 * attachments: they stop a message field from being read as a path or a URL
 * to fetch, which is the class nodemailer's own advisories keep finding, and
 * they cost nothing.
 */
export function buildTransportOptions(config: SmtpConfig): SMTPTransportOptions {
  return {
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    requireTLS: config.security === 'starttls',
    ignoreTLS: config.security === 'none',
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
    forceAuth: !!config.username,
    tls: config.allowSelfSigned && config.security !== 'none' ? { rejectUnauthorized: false } : undefined,
    name: config.ehloName || undefined,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    dnsTimeout: SMTP_DNS_TIMEOUT_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
  }
}

/**
 * An image carried inside the message and shown by `<img src="cid:…">`.
 *
 * Embedded rather than linked: most clients block remote images until the
 * reader allows them, and a remote image tells whoever serves it that the
 * message was opened. The bytes are capped because every recipient downloads
 * them with the message.
 */
export interface EmailImage {
  cid: string
  content: Buffer
  contentType: EmailImageType
}

export const EMAIL_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type EmailImageType = (typeof EMAIL_IMAGE_TYPES)[number]

/** Per image. A w185 TMDb poster is ~15 KB; this is headroom, not a target. */
export const EMAIL_IMAGE_MAX_BYTES = 300_000
/** Per message, so a long list of titles cannot make a multi-megabyte email. */
export const EMAIL_IMAGES_MAX_TOTAL_BYTES = 2_000_000

/** A content id an `<img src="cid:…">` can name without escaping. */
const CONTENT_ID = /^[A-Za-z0-9._-]{1,100}$/

export function isEmailImageType(value: unknown): value is EmailImageType {
  return typeof value === 'string' && (EMAIL_IMAGE_TYPES as readonly string[]).includes(value)
}

export function isContentId(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_ID.test(value)
}

/** Why a message's images cannot be sent, or null. The fetch helper already holds images to this. */
export function emailImagesProblem(images: readonly EmailImage[]): string | null {
  const seen = new Set<string>()
  let total = 0
  for (const image of images) {
    if (!isContentId(image.cid)) return `Invalid image content id: ${image.cid}`
    if (seen.has(image.cid)) return `Two images share the content id ${image.cid}`
    seen.add(image.cid)
    if (!isEmailImageType(image.contentType)) return `Unsupported image type: ${image.contentType}`
    if (image.content.length > EMAIL_IMAGE_MAX_BYTES) return `Image ${image.cid} is larger than ${EMAIL_IMAGE_MAX_BYTES} bytes`
    total += image.content.length
  }
  return total > EMAIL_IMAGES_MAX_TOTAL_BYTES ? `Images total more than ${EMAIL_IMAGES_MAX_TOTAL_BYTES} bytes` : null
}

export interface OutgoingEmail {
  /** One bare address. A list is a batch of these, so one refusal costs one message. */
  to: string
  subject: string
  text: string
  /** Optional HTML alternative; `text` is always sent, for clients that read only that. Build it with `renderEmail`. */
  html?: string
  /** Images the HTML shows by content id. */
  images?: EmailImage[]
}

export interface EmailSender {
  name: string
  address: string
}

export interface SentEmail {
  messageId: string
}

/** The From header: the configured name, or the instance name when there is none. */
export function senderFor(config: SmtpConfig, appName: string): EmailSender {
  return { name: config.fromName || appName, address: config.fromAddress }
}

/**
 * What a failed attempt was, as a stable id the card translates — the raw
 * error rides beside it as `detail`, since the server's own words are evidence
 * and a translated sentence is only a reading of them.
 *
 * `disabled` and `notConfigured` are not SMTP failures; they are what the
 * senders answer without opening a connection, kept in the same union so a
 * caller handles one outcome type.
 */
export const SMTP_FAILURES = [
  'auth',
  'authRequired',
  'authUnavailable',
  'tlsUnavailable',
  'tlsRequired',
  'tlsMismatch',
  'tlsHandshake',
  'certificate',
  'dns',
  'refused',
  'timeout',
  'sender',
  'recipient',
  'relayDenied',
  'invalidMessage',
  'connection',
  'disabled',
  'notConfigured',
  'unknown',
] as const
export type SmtpFailure = (typeof SMTP_FAILURES)[number]

export type SmtpOutcome<T> = { ok: true; value: T } | { ok: false; failure: SmtpFailure; detail: string }

/**
 * Whether a failure is about the CONNECTION rather than one message. In a
 * batch, a connection failure ends the batch — every later message would fail
 * the same way, and repeating a refused login is how an account gets locked —
 * while a refused recipient, or a message that could not be built (an image
 * over the cap), costs only its own message.
 */
export function isSystemicSmtpFailure(failure: SmtpFailure): boolean {
  return failure !== 'recipient' && failure !== 'relayDenied' && failure !== 'invalidMessage'
}

interface ErrorShape {
  code?: unknown
  message?: unknown
  responseCode?: unknown
  command?: unknown
}

const CERTIFICATE_TEXT =
  /self[- ]signed certificate|unable to verify the first certificate|unable to get local issuer certificate|certificate has expired|certificate is not yet valid|does not match certificate's altnames|ERR_TLS_CERT_ALTNAME_INVALID/i
const TLS_VERSION_TEXT = /wrong version number|packet length too long|unknown protocol|ssl3_get_record/i
const ENCRYPTION_REQUIRED_TEXT = /STARTTLS|TLS required|encryption required|requires? encryption/i
const RELAY_TEXT = /relay/i
const DNS_TEXT = /ENOTFOUND|EAI_AGAIN|getaddrinfo/
const REFUSED_TEXT = /ECONNREFUSED/
const TIMEOUT_TEXT = /ETIMEDOUT|timed? ?out|Greeting never received|No answer within/i
const CONNECTION_TEXT = /ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang up|Connection closed/i

/**
 * Read a nodemailer error. The order matters and is pinned.
 *
 * nodemailer REPLACES a socket error's own code (`ECONNREFUSED`,
 * `DEPTH_ZERO_SELF_SIGNED_CERT`, `ERR_SSL_WRONG_VERSION_NUMBER`) with its own
 * coarse one (`ESOCKET`, `ETLS`), keeping only the message — so the message is
 * read as well as the code, and the specific readings (certificate, protocol
 * mismatch) come before the coarse ones they would otherwise be filed under.
 *
 * A refused login is not always a wrong password: 538 (or a reply naming
 * encryption) means "not over this connection", and 502/503/504 mean the
 * server does not take a login here at all. Both send the admin to a
 * different setting than the password, so they are read apart.
 *
 * A mismatched mode and port fails two ways depending on which side waits:
 * implicit TLS against a plain port reads the server's banner as a TLS record
 * ("wrong version number"), and a plain mode against port 465 waits for a
 * greeting the server never sends until it gets a TLS hello — a timeout that
 * is really a mismatch, read as one only on the ports where it is the
 * overwhelmingly likely cause.
 */
export function classifySmtpFailure(err: unknown, config: Pick<SmtpConfig, 'port' | 'security'>): SmtpFailure {
  const e = (err && typeof err === 'object' ? err : {}) as ErrorShape
  const code = typeof e.code === 'string' ? e.code : ''
  const message = typeof e.message === 'string' ? e.message : String(err ?? '')
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : null
  const command = typeof e.command === 'string' ? e.command.toUpperCase() : ''

  if (CERTIFICATE_TEXT.test(message)) return 'certificate'
  if (TLS_VERSION_TEXT.test(message)) return 'tlsMismatch'
  if (code === 'ETLS') return responseCode != null ? 'tlsUnavailable' : 'tlsHandshake'
  if (code === 'EAUTH') {
    if (responseCode === 538 || ENCRYPTION_REQUIRED_TEXT.test(message)) return 'tlsRequired'
    if (responseCode === 502 || responseCode === 503 || responseCode === 504) return 'authUnavailable'
    return 'auth'
  }
  if (code === 'ENOAUTH') return 'authRequired'
  if (responseCode === 530 || responseCode === 554) {
    // 530 means "not until you do something": log in, or (Gmail's wording,
    // under `none`) "Must issue a STARTTLS command first".
    if (ENCRYPTION_REQUIRED_TEXT.test(message)) return 'tlsRequired'
    if (responseCode === 530) return 'authRequired'
  }
  // The server answered the envelope, so this is a refusal, not a network
  // fault — and its reply text is free prose that the message-text readings
  // below could misfile. A recipient refused for RELAYING is a refusal of the
  // sender's standing (not logged in, or not allowed to send outside its
  // domains), not of the address, so it is named apart.
  if (code === 'EENVELOPE' || command === 'MAIL FROM' || command.startsWith('RCPT')) {
    if (command === 'MAIL FROM') return 'sender'
    return RELAY_TEXT.test(message) ? 'relayDenied' : 'recipient'
  }
  if (code === 'EDNS' || DNS_TEXT.test(message)) return 'dns'
  if (REFUSED_TEXT.test(message)) return 'refused'
  if (code === 'ETIMEDOUT' || TIMEOUT_TEXT.test(message)) {
    const plainModeOnTlsPort = config.security !== 'tls' && config.port === IMPLICIT_TLS_PORT
    const tlsModeOnPlainPort =
      config.security === 'tls' &&
      (config.port === SMTP_DEFAULT_PORTS.starttls || config.port === SMTP_DEFAULT_PORTS.none)
    return plainModeOnTlsPort || tlsModeOnPlainPort ? 'tlsMismatch' : 'timeout'
  }
  if (code === 'ECONNECTION' || code === 'ESOCKET' || CONNECTION_TEXT.test(message)) return 'connection'
  return 'unknown'
}

/** How much of the server's words a detail keeps; the rest is never the useful part. */
export const SMTP_DETAIL_MAX_CHARS = 300

/**
 * The error's own words, for the card and the log: control characters folded
 * to spaces and clipped. nodemailer appends the server's response to the
 * message and records only the verb of a failed AUTH (`AUTH PLAIN`, never its
 * payload), so the message carries no credential.
 */
export function smtpFailureDetail(err: unknown): string {
  const raw =
    err && typeof err === 'object' && typeof (err as ErrorShape).message === 'string'
      ? ((err as ErrorShape).message as string)
      : String(err ?? '')
  // eslint-disable-next-line no-control-regex
  const flat = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > SMTP_DETAIL_MAX_CHARS ? `${flat.slice(0, SMTP_DETAIL_MAX_CHARS - 1)}…` : flat
}

/** A header value with its line breaks folded, so a subject can never start a header of its own. */
export function singleLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
}
