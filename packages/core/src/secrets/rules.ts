/**
 * Bitwarden Secrets Manager: the rules, with nothing that touches a process,
 * the database or the clock.
 *
 * A credential setting holds either the credential or a REFERENCE to a secret
 * in the operator's Bitwarden project (`bws:<secret name>`). The reference is
 * not a secret: it can sit in Postgres, in a backup and on an admin's screen.
 * The value it names lives only in this process's memory.
 *
 * Three states must never be confused, and every function here keeps them
 * apart: a setting that holds nothing, a reference whose secret was read, and
 * a reference whose secret could NOT be read (Bitwarden unreachable, secret
 * renamed, two secrets sharing the name). The last one is a failure, never "no
 * key configured".
 */

/** What a setting holds when it names a Bitwarden secret instead of a value. */
export const SECRET_REF_PREFIX = 'bws:'

/** Bitwarden's own limit on a secret's name. */
const MAX_SECRET_NAME_LENGTH = 500

/** A name that can be stored in a reference and found again, unchanged. */
export function isSecretName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > MAX_SECRET_NAME_LENGTH) return false
  if (name !== name.trim()) return false
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(name)
}

/** The secret name a stored value refers to, or null when it is a plain value. */
export function parseSecretRef(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed.startsWith(SECRET_REF_PREFIX)) return null
  const name = trimmed.slice(SECRET_REF_PREFIX.length).trim()
  return isSecretName(name) ? name : null
}

export function secretRefFor(name: string): string {
  return `${SECRET_REF_PREFIX}${name}`
}

// ---------------------------------------------------------------------------
// Which settings may hold a reference
// ---------------------------------------------------------------------------

/**
 * The credentials that can be read from Bitwarden: one `system_settings` row
 * each, holding nothing but the credential. Credentials kept inside a JSON
 * setting (AI roles, SMTP, Tavily, fastCRW, the decision model, translation,
 * n8n) are not here: their readers do not pass through `getSystemSetting`'s
 * resolution, so listing one would offer a link that nothing honours.
 */
export const BINDABLE_SECRETS = [
  { id: 'mediaServer', settingKey: 'media_server_api_key' },
  { id: 'tmdb', settingKey: 'tmdb_api_key' },
  { id: 'omdb', settingKey: 'omdb_api_key' },
  { id: 'mdblist', settingKey: 'mdblist_api_key' },
  { id: 'seerr', settingKey: 'seerr_api_key' },
  { id: 'traktClientSecret', settingKey: 'trakt_client_secret' },
  { id: 'lldapPassword', settingKey: 'lldap_admin_password' },
] as const

export type BindableSecretId = (typeof BINDABLE_SECRETS)[number]['id']

const BINDABLE_SETTING_KEYS: ReadonlySet<string> = new Set(BINDABLE_SECRETS.map((s) => s.settingKey))

/** Whether a reference stored under this settings key is resolved on read. */
export function isBindableSettingKey(key: string): boolean {
  return BINDABLE_SETTING_KEYS.has(key)
}

export function bindableSecret(id: string): (typeof BINDABLE_SECRETS)[number] | null {
  return BINDABLE_SECRETS.find((s) => s.id === id) ?? null
}

// ---------------------------------------------------------------------------
// Where the access comes from
// ---------------------------------------------------------------------------

export type BootstrapProblem = 'missingToken' | 'missingProject' | 'invalidProject' | 'invalidServerUrl'

export interface SecretsBootstrap {
  accessToken: string
  projectId: string
  /** Null = Bitwarden's own cloud (the CLI's default). */
  serverUrl: string | null
  /** The `bws` executable: a name looked up on PATH, or a path. */
  bwsPath: string
}

export type BootstrapReading =
  | { configured: true; bootstrap: SecretsBootstrap }
  /** `off`: nothing was set, so the feature is simply not in use. */
  | { configured: false; problem: BootstrapProblem | 'off' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The access token, project and server, read from the process environment.
 *
 * Environment only, on purpose: a token kept in `system_settings` would put the
 * key to every secret back in the database and in every backup, which is what
 * this feature exists to end.
 */
export function readSecretsBootstrap(env: Record<string, string | undefined>): BootstrapReading {
  const accessToken = env.BWS_ACCESS_TOKEN?.trim() ?? ''
  const projectId = env.BWS_PROJECT_ID?.trim() ?? ''
  const serverUrl = env.BWS_SERVER_URL?.trim() ?? ''

  if (!accessToken && !projectId) return { configured: false, problem: 'off' }
  if (!accessToken) return { configured: false, problem: 'missingToken' }
  if (!projectId) return { configured: false, problem: 'missingProject' }
  // `bws secret list` takes a project UUID and nothing else.
  if (!UUID.test(projectId)) return { configured: false, problem: 'invalidProject' }
  if (serverUrl && !/^https?:\/\/\S+$/i.test(serverUrl)) {
    return { configured: false, problem: 'invalidServerUrl' }
  }

  return {
    configured: true,
    bootstrap: {
      accessToken,
      projectId,
      serverUrl: serverUrl || null,
      bwsPath: env.BWS_PATH?.trim() || 'bws',
    },
  }
}

// ---------------------------------------------------------------------------
// What the CLI answered
// ---------------------------------------------------------------------------

export interface SecretSnapshot {
  /** Secret name → value, for names that exactly one secret carries. */
  values: ReadonlyMap<string, string>
  /** Names carried by two or more secrets: a reference to one cannot be honoured. */
  ambiguous: ReadonlySet<string>
}

/**
 * The output of `bws secret list <project> --output json`.
 *
 * Throws on anything that is not a list of `{ key, value }` objects: an answer
 * that cannot be read must not become "the project is empty", which would turn
 * every reference into a missing secret.
 */
export function parseSecretList(stdout: string): SecretSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error('The Bitwarden CLI did not answer with JSON')
  }
  if (!Array.isArray(parsed)) throw new Error('The Bitwarden CLI did not answer with a list of secrets')

  const values = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') throw new Error('The Bitwarden CLI listed something that is not a secret')
    const { key, value } = entry as { key?: unknown; value?: unknown }
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new Error('The Bitwarden CLI listed a secret without a name or a value')
    }
    if (ambiguous.has(key)) continue
    if (values.has(key)) {
      values.delete(key)
      ambiguous.add(key)
      continue
    }
    values.set(key, value)
  }
  return { values, ambiguous }
}

export type SecretLookup =
  | { status: 'ok'; value: string }
  /** No secret of that name in the project. */
  | { status: 'missing' }
  /** Two secrets share the name. */
  | { status: 'ambiguous' }
  /** The secret exists and holds nothing. */
  | { status: 'empty' }
  /** The project could not be read at all. */
  | { status: 'unreachable' }

export function lookupSecret(snapshot: SecretSnapshot | null, name: string): SecretLookup {
  if (!snapshot) return { status: 'unreachable' }
  if (snapshot.ambiguous.has(name)) return { status: 'ambiguous' }
  const value = snapshot.values.get(name)
  if (value === undefined) return { status: 'missing' }
  if (!value.trim()) return { status: 'empty' }
  return { status: 'ok', value }
}

/**
 * The names a credential can be linked to: one secret carries the name, the
 * name can be stored in a reference, and the secret holds a value. Exactly what
 * `bindSecret` accepts, so the picker never offers a name it would refuse.
 */
export function linkableNames(snapshot: SecretSnapshot | null): string[] {
  if (!snapshot) return []
  const names: string[] = []
  for (const [name, value] of snapshot.values) {
    if (isSecretName(name) && value.trim()) names.push(name)
  }
  return names.sort((a, b) => a.localeCompare(b))
}

// ---------------------------------------------------------------------------
// What the CLI is run with
// ---------------------------------------------------------------------------

/**
 * Variables the CLI needs from this process to start and to reach the network.
 * Proxy settings in both spellings: most tools read the lower-case ones, and a
 * container that reaches the internet only through a proxy sets those.
 */
const BWS_INHERITED_VARIABLES = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
] as const

/**
 * The CLI's whole environment. A short list, not this process's own: that
 * holds DATABASE_URL and whatever else the operator set, none of which a
 * program reading a vault has any use for. The token travels here and never in
 * argv, which every process on the host can read.
 */
export function bwsChildEnvironment(
  bootstrap: SecretsBootstrap,
  processEnv: Record<string, string | undefined>
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of BWS_INHERITED_VARIABLES) {
    const value = processEnv[name]
    if (value) env[name] = value
  }
  env.BWS_ACCESS_TOKEN = bootstrap.accessToken
  if (bootstrap.serverUrl) env.BWS_SERVER_URL = bootstrap.serverUrl
  return env
}

// ---------------------------------------------------------------------------
// When to ask again
// ---------------------------------------------------------------------------

/** How long a read of the project is used before the next one. */
export const SECRETS_TTL_MS = 5 * 60 * 1000
/** How long a failed read is left alone, so a down server is not asked per request. */
export const SECRETS_RETRY_MS = 30 * 1000

export interface FetchClock {
  /** When the project was last read successfully. */
  fetchedAt: number | null
  /** When the last attempt failed, if the latest attempt did. */
  failedAt: number | null
}

/**
 * Whether to read the project now. A failure never discards what was read
 * before it: the last good values keep serving, and are only asked for again
 * once the retry wait has passed.
 */
export function shouldFetchSecrets(clock: FetchClock, now: number): boolean {
  if (clock.failedAt != null && now - clock.failedAt < SECRETS_RETRY_MS) return false
  if (clock.failedAt != null) return true
  if (clock.fetchedAt == null) return true
  return now - clock.fetchedAt >= SECRETS_TTL_MS
}

// ---------------------------------------------------------------------------
// What a failure may say
// ---------------------------------------------------------------------------

export type SecretsFailureKind = 'notInstalled' | 'timeout' | 'unauthorized' | 'unreadable' | 'failed'

export interface SecretsFailure {
  kind: SecretsFailureKind
  /** The CLI's own words, clipped, with the access token removed. */
  detail: string | null
}

const DETAIL_CHARS = 300

/**
 * A failed run of the CLI, as something that can be logged and shown.
 *
 * The token is removed from the text by value: the CLI is given it through the
 * environment and has no reason to print it, but an error message is the one
 * place it could come back, and this text reaches the log and an admin's
 * screen.
 */
export function describeSecretsFailure(
  error: { code?: unknown; killed?: unknown; signal?: unknown; stderr?: unknown; message?: unknown },
  accessToken: string
): SecretsFailure {
  const raw = typeof error.stderr === 'string' && error.stderr.trim() ? error.stderr : String(error.message ?? '')
  const scrubbed = accessToken ? raw.split(accessToken).join('[access token]') : raw
  const detail = scrubbed.replace(/\s+/g, ' ').trim().slice(0, DETAIL_CHARS) || null

  if (error.code === 'ENOENT') return { kind: 'notInstalled', detail: null }
  if (error.killed === true || error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT') {
    return { kind: 'timeout', detail }
  }
  // Judged on the CLI's own words, before the token was replaced: the
  // placeholder says "access token", and so do messages that refuse nothing.
  if (/\b(401|unauthori[sz]ed|invalid[_ ]?(client|grant|token))\b/i.test(raw)) {
    return { kind: 'unauthorized', detail }
  }
  return { kind: 'failed', detail }
}
