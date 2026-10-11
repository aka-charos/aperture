/**
 * Outgoing email over SMTP: the rules, with no I/O.
 *
 * Everything here is pure so it can be pinned without a mail server or a
 * database: what a stored config means, what is missing from it, which
 * nodemailer options it becomes, and what a failed attempt was. The transport
 * is `smtp.ts`, storage is `config.ts`, and `send.ts` is the one way the rest
 * of the app sends a message.
 */
import type { SMTPTransportOptions } from 'nodemailer'

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
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535
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
    host: trimmed(input.host),
    port: isPort(port) ? port : SMTP_DEFAULT_PORTS[security],
    security,
    allowSelfSigned: input.allowSelfSigned === true,
    username: trimmed(input.username),
    password: trimmed(input.password),
    fromAddress: trimmed(input.fromAddress),
    fromName: trimmed(input.fromName),
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
  return null
}

/** Host comparison for the stored-password rule: DNS names are case-insensitive. */
export function smtpHostKey(host: string): string {
  return host.trim().toLowerCase()
}

/**
 * The stored password, but only for the server it was saved for.
 *
 * Test accepts settings that are not saved yet so the card can try a server
 * before committing to it, and Save may move the host. Sending the stored
 * password along to a different host would hand it to whatever answers there,
 * so a different host gets the password typed on the card, or none. Same rule
 * as the decision model's stored key.
 */
export function storedPasswordFor(current: SmtpConfig, host: string): string {
  const target = smtpHostKey(host)
  return target !== '' && target === smtpHostKey(current.host) ? current.password : ''
}

/**
 * The nodemailer options a config becomes.
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
    tls: config.allowSelfSigned && config.security !== 'none' ? { rejectUnauthorized: false } : undefined,
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
 * What a failed attempt was, as a stable id the card translates — the raw
 * error rides beside it as `detail`, since the server's own words are evidence
 * and a translated sentence is only a reading of them.
 *
 * `disabled` and `notConfigured` are not SMTP failures; they are what
 * `sendEmail` answers without opening a connection, kept in the same union so
 * a caller handles one outcome type.
 */
export const SMTP_FAILURES = [
  'auth',
  'authRequired',
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
  'connection',
  'disabled',
  'notConfigured',
  'unknown',
] as const
export type SmtpFailure = (typeof SMTP_FAILURES)[number]

interface ErrorShape {
  code?: unknown
  message?: unknown
  responseCode?: unknown
  command?: unknown
}

const CERTIFICATE_TEXT =
  /self[- ]signed certificate|unable to verify the first certificate|unable to get local issuer certificate|certificate has expired|certificate is not yet valid|does not match certificate's altnames|ERR_TLS_CERT_ALTNAME_INVALID/i
const TLS_VERSION_TEXT = /wrong version number|packet length too long|unknown protocol|ssl3_get_record/i
const DNS_TEXT = /ENOTFOUND|EAI_AGAIN|getaddrinfo/
const REFUSED_TEXT = /ECONNREFUSED/
const TIMEOUT_TEXT = /ETIMEDOUT|timed? ?out|Greeting never received/i
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
  if (code === 'EAUTH') return 'auth'
  if (code === 'ENOAUTH') return 'authRequired'
  if (responseCode === 530 || responseCode === 554) {
    // 530 means "not until you do something": log in, or (Gmail's wording,
    // under `none`) "Must issue a STARTTLS command first".
    if (/STARTTLS|TLS required|encryption/i.test(message)) return 'tlsRequired'
    if (responseCode === 530) return 'authRequired'
  }
  // The server answered the envelope, so this is a refusal, not a network
  // fault — and its reply text is free prose that the message-text readings
  // below could misfile.
  if (code === 'EENVELOPE' || command === 'MAIL FROM' || command.startsWith('RCPT')) {
    return command === 'MAIL FROM' ? 'sender' : 'recipient'
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
