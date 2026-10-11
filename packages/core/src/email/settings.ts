/**
 * What a settings request may change, and what the stored password may be
 * used for. Pure, so the rules that decide where a saved password goes are
 * pinned by a test rather than living in a route handler.
 */
import {
  isSmtpSecurity,
  sanitizeSmtpConfig,
  type SmtpConfig,
  type SmtpSecurity,
} from './rules.js'

/** A settings change as the card sends it. Every field optional; absent means "leave as is". */
export interface SmtpSettingsUpdate {
  enabled?: boolean
  host?: string
  port?: number
  security?: string
  allowSelfSigned?: boolean
  username?: string
  /**
   * Saving: absent keeps the stored password (within its scope, below), and an
   * empty string clears it. Testing: absent and empty both mean the stored one.
   */
  password?: string
  fromAddress?: string
  fromName?: string
  ehloName?: string
  publicUrl?: string
}

export interface SmtpTestRequest extends SmtpSettingsUpdate {
  /** Also send a test message here. Absent means check the connection only. */
  sendTo?: string
}

const BOOLEAN_FIELDS = ['enabled', 'allowSelfSigned'] as const
const STRING_FIELDS = [
  'host',
  'security',
  'username',
  'password',
  'fromAddress',
  'fromName',
  'ehloName',
  'publicUrl',
  'sendTo',
] as const

/**
 * The body has no JSON schema, so a field can arrive as anything. A wrong type
 * is refused here, before `sanitizeSmtpConfig` would quietly turn it into a
 * default — a mistyped port silently becoming 587 is a setting nobody chose.
 */
export function smtpUpdateTypeError(body: unknown): string | null {
  if (body == null) return null
  if (typeof body !== 'object' || Array.isArray(body)) return 'The request body must be an object'
  const fields = body as Record<string, unknown>
  for (const key of BOOLEAN_FIELDS) {
    if (fields[key] !== undefined && typeof fields[key] !== 'boolean') return `${key} must be true or false`
  }
  for (const key of STRING_FIELDS) {
    if (fields[key] !== undefined && typeof fields[key] !== 'string') return `${key} must be a string`
  }
  const port = fields.port
  if (port !== undefined && !(typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535)) {
    return 'Port must be a whole number from 1 to 65535'
  }
  if (fields.security !== undefined && !isSmtpSecurity(fields.security)) {
    return 'Security must be starttls, tls or none'
  }
  return null
}

/**
 * The transport a config uses, as one key: the security mode, and whether the
 * certificate goes unchecked. `none` has no certificate to check.
 */
export const SMTP_TRANSPORTS = ['starttls', 'starttls-unverified', 'tls', 'tls-unverified', 'none'] as const
export type SmtpTransport = (typeof SMTP_TRANSPORTS)[number]

export function transportOf(config: Pick<SmtpConfig, 'security' | 'allowSelfSigned'>): SmtpTransport {
  if (config.security === 'none') return 'none'
  return config.allowSelfSigned ? `${config.security}-unverified` : config.security
}

/** How well a transport protects what crosses it: none, encrypted but unverified, encrypted and verified. */
function strengthOf(transport: SmtpTransport): number {
  if (transport === 'none') return 0
  return transport.endsWith('-unverified') ? 1 : 2
}

/** Host comparison for the stored-password rule: DNS names are case-insensitive, and brackets are notation. */
export function smtpHostKey(host: string): string {
  const trimmedHost = host.trim()
  const bare = /^\[([0-9A-Fa-f:.]+)\]$/.exec(trimmedHost)
  return (bare ? bare[1] : trimmedHost).toLowerCase()
}

/**
 * Where the stored password may go: the host it was saved for, over a transport
 * at least as protective as the one it was saved under.
 *
 * The host half: Test accepts settings that are not saved yet so the card can
 * try a server before committing to it, and Save may move the host, so sending
 * the stored password to a different host would hand it to whatever answers
 * there. The transport half: the same host under `none` receives `AUTH PLAIN`
 * in clear text, and with the certificate unchecked anyone in the path can
 * present one — either way the password the API never reveals is readable on
 * the wire, from a Test that leaves no trace. Moving between the two verified
 * modes (STARTTLS ⇄ SSL/TLS) keeps it, since that is the commonest fix to try.
 *
 * Shipped to the card as this decided scope (null when nothing is stored), so
 * the card only checks membership and never holds the strength ordering.
 */
export interface StoredPasswordScope {
  host: string
  transports: SmtpTransport[]
}

export function storedPasswordScope(current: SmtpConfig): StoredPasswordScope | null {
  if (!current.password || !current.host) return null
  const floor = strengthOf(transportOf(current))
  return {
    host: smtpHostKey(current.host),
    transports: SMTP_TRANSPORTS.filter((transport) => strengthOf(transport) >= floor),
  }
}

/** The stored password if `target` is inside its scope, otherwise nothing. */
export function storedPasswordFor(
  current: SmtpConfig,
  target: Pick<SmtpConfig, 'host' | 'security' | 'allowSelfSigned'>
): string {
  const scope = storedPasswordScope(current)
  if (!scope) return ''
  return smtpHostKey(target.host) === scope.host && scope.transports.includes(transportOf(target))
    ? current.password
    : ''
}

/**
 * The settings as they would stand after this update. Save and Test both go
 * through it, so they cannot differ on the password rules:
 *
 * - no username keeps no password, since nothing would ever send it;
 * - a typed password is used as typed;
 * - otherwise the stored one, but only within `storedPasswordScope`;
 * - on Save, an empty string clears it; on Test, empty means "the stored one",
 *   because the card sends what is in the field and an untouched field is empty.
 */
export function mergeSmtpSettings(
  current: SmtpConfig,
  update: SmtpSettingsUpdate,
  purpose: 'save' | 'test'
): SmtpConfig {
  const next = sanitizeSmtpConfig({
    enabled: update.enabled ?? current.enabled,
    host: update.host ?? current.host,
    port: update.port ?? current.port,
    security: isSmtpSecurity(update.security) ? update.security : current.security,
    allowSelfSigned: update.allowSelfSigned ?? current.allowSelfSigned,
    username: update.username ?? current.username,
    password: '',
    fromAddress: update.fromAddress ?? current.fromAddress,
    fromName: update.fromName ?? current.fromName,
    ehloName: update.ehloName ?? current.ehloName,
    publicUrl: update.publicUrl ?? current.publicUrl,
  })
  if (!next.username) return next

  const typed = typeof update.password === 'string' ? update.password.trim() : undefined
  const useStored = typed === undefined || (purpose === 'test' && typed === '')
  return { ...next, password: useStored ? storedPasswordFor(current, next) : typed }
}

export interface PublicSmtpConfig {
  enabled: boolean
  host: string
  port: number
  security: SmtpSecurity
  allowSelfSigned: boolean
  username: string
  hasPassword: boolean
  fromAddress: string
  fromName: string
  ehloName: string
  publicUrl: string
}

/** The config as the card may see it: everything but the password, which is reported as set or not. */
export function publicSmtpConfig(config: SmtpConfig): PublicSmtpConfig {
  return {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    security: config.security,
    allowSelfSigned: config.allowSelfSigned,
    username: config.username,
    hasPassword: !!config.password,
    fromAddress: config.fromAddress,
    fromName: config.fromName,
    ehloName: config.ehloName,
    publicUrl: config.publicUrl,
  }
}
