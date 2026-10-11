/**
 * What a stored credential looks like on its way to the browser, and when a
 * stored credential may be reused for a request the browser makes.
 *
 * Every integration card but three already received only `hasApiKey`. The AI
 * role cards read the raw key back (`GET /api/settings/ai` returned the whole
 * stored `ai_config`, keys and spare keys included, and
 * `GET …/ai/credentials/:provider` returned the shared key in plaintext), the
 * n8n card read its auth header value back, and the setup wizard's progress
 * snapshot carried the media server's admin API key. Anything holding an admin
 * session or an admin-scoped API key could read every one of them.
 *
 * Two rules, both pure and pinned:
 *
 * 1. A secret leaves the server as a FACT about it (`hasApiKey`, a four-character
 *    hint), never as the secret. A card that needs to keep a stored value says
 *    so by omitting the field or by naming the stored slot (`{ keep: n }`).
 *
 * 2. A stored secret is reused only for the address it was saved for. Once the
 *    browser no longer holds the key, "test this with whatever is saved" becomes
 *    a server-side action, and without this rule a stolen admin session could
 *    point a test at its own server and receive the key in the request headers —
 *    the same rule the SMTP, decision-model and translation routes already apply.
 *
 * No runtime import from `@aperture/core`, so the test runs without a database.
 */

/** Below this length a four-character tail is too much of the key to show. */
const MIN_LENGTH_FOR_HINT = 12

/** The last four characters of a key, or null when the key is short or absent. */
export function keyHint(key: string | null | undefined): string | null {
  const trimmed = key?.trim() ?? ''
  if (trimmed.length < MIN_LENGTH_FOR_HINT) return null
  return `…${trimmed.slice(-4)}`
}

// ---------------------------------------------------------------------------
// AI role config
// ---------------------------------------------------------------------------

interface RoleSecrets {
  apiKey?: string
  fallbackApiKeys?: string[]
  fallbackApiKey?: string
}

export type PublicRoleConfig<T extends RoleSecrets> = Omit<
  T,
  'apiKey' | 'fallbackApiKeys' | 'fallbackApiKey'
> & {
  /** Whether the role carries its own key (a shared provider key is reported by the credentials route). */
  hasApiKey: boolean
  /** One entry per stored spare key, in stored order: its hint, or '…' for a short key. */
  fallbackKeyHints: string[]
}

/**
 * A role's config without its keys.
 *
 * `storedFallbackKeys` is core's `resolveFallbackKeys`, passed in rather than
 * imported so the order the hints are listed in is the order `{ keep: n }` is
 * later resolved against — one reader, never a copy of it.
 */
export function publicRoleConfig<T extends RoleSecrets>(
  config: T | null | undefined,
  storedFallbackKeys: (config: T) => string[]
): PublicRoleConfig<T> | null {
  if (!config) return null
  const { apiKey, fallbackApiKeys: _list, fallbackApiKey: _legacy, ...rest } = config
  return {
    ...rest,
    hasApiKey: !!apiKey?.trim(),
    fallbackKeyHints: storedFallbackKeys(config).map((key) => keyHint(key) ?? '…'),
  }
}

/**
 * Every role of an AI config, keys removed. Typed `object` because core's
 * `AIConfig` is an interface, which TypeScript will not read as an index
 * signature; every value in it is a role config or null.
 */
export function publicAIConfig<T extends RoleSecrets>(
  config: object,
  storedFallbackKeys: (config: T) => string[]
): Record<string, PublicRoleConfig<T> | null> {
  const out: Record<string, PublicRoleConfig<T> | null> = {}
  for (const [role, roleConfig] of Object.entries(config) as [string, T | null | undefined][]) {
    out[role] = publicRoleConfig(roleConfig, storedFallbackKeys)
  }
  return out
}

/** A spare-key slot in a save: a new key, or the stored key at that position. */
export type FallbackKeyEntry = string | { keep: number }

/**
 * The spare keys a save asks for, with `{ keep: n }` resolved against what is
 * stored. A slot naming a key that is not there is dropped rather than guessed
 * at, and so is anything that is neither shape — the list is a set of
 * credentials, and an entry nobody can account for must not become one.
 */
export function resolveFallbackKeyEntries(entries: readonly unknown[], stored: readonly string[]): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const key = entry.trim()
      if (key) out.push(key)
      continue
    }
    if (entry && typeof entry === 'object' && 'keep' in entry) {
      const index = (entry as { keep: unknown }).keep
      if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < stored.length) {
        out.push(stored[index])
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Where a stored key may be sent
// ---------------------------------------------------------------------------

/**
 * One spelling of an address for comparison: scheme and host lower-cased (they
 * are case-insensitive), the path kept as written, trailing slashes dropped. A
 * string that does not parse is compared as typed, trimmed.
 */
export function normalizeEndpoint(url: string): string {
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed)
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

/**
 * Whether a stored key may go to `requested`.
 *
 * No address asked for means the stored or default one will be used, which is
 * where the key already goes. Otherwise the address must be one the key was
 * saved for (`allowed`: the role's own address, the provider's shared one, the
 * provider's shipped default). An empty allow-list admits nothing but the
 * no-address case.
 */
export function storedKeyMayGoTo(
  requested: string | null | undefined,
  allowed: ReadonlyArray<string | null | undefined>
): boolean {
  if (!requested?.trim()) return true
  const target = normalizeEndpoint(requested)
  return allowed.some((url) => !!url?.trim() && normalizeEndpoint(url) === target)
}

/**
 * A saved secret for a Test button that also accepts a typed address: the
 * secret, or undefined when the form names an address other than the saved one.
 *
 * The shape every integration with one server and one credential needs (LLDAP,
 * fastCRW, the media server). Each Test route took the address from the form
 * and the credential from storage, so pointing the form at any server sent it
 * the saved LLDAP admin password, CRW key or media server admin key.
 */
export function savedSecretFor(
  requestedUrl: string | null | undefined,
  savedUrl: string | null | undefined,
  savedSecret: string | null | undefined
): string | undefined {
  if (!savedSecret) return undefined
  return storedKeyMayGoTo(requestedUrl, [savedUrl]) ? savedSecret : undefined
}

/** What a Test button says when it declined to send a saved credential. */
export const SAVED_SECRET_REFUSED =
  'The saved credential is only sent to the saved server address. Enter it again to test a different address.'

// ---------------------------------------------------------------------------
// n8n webhooks
// ---------------------------------------------------------------------------

interface WebhookSecret {
  webhookUrl: string
  authHeaderName?: string
  authHeaderValue?: string
}

export type PublicWebhook<T extends WebhookSecret> = Omit<T, 'authHeaderValue'> & {
  hasAuthHeaderValue: boolean
}

export function publicWebhook<T extends WebhookSecret>(webhook: T | null | undefined): PublicWebhook<T> | null {
  if (!webhook) return null
  const { authHeaderValue, ...rest } = webhook
  return { ...rest, hasAuthHeaderValue: !!authHeaderValue }
}

/**
 * The webhook a save or a test should use, with the stored header value
 * carried over when the browser left it out.
 *
 * Carried over only to the same webhook URL under the same header name: a
 * changed URL is exactly the case where a stored secret must not follow, and a
 * renamed header is a different credential. An explicit value — including the
 * empty string — is the caller's and is never replaced.
 */
export function withStoredAuthHeader<T extends WebhookSecret>(
  incoming: T | null | undefined,
  stored: WebhookSecret | null | undefined
): T | null | undefined {
  if (!incoming || incoming.authHeaderValue !== undefined) return incoming
  if (!stored?.authHeaderValue || !incoming.authHeaderName) return incoming
  if ((stored.authHeaderName ?? '') !== incoming.authHeaderName) return incoming
  // An empty URL would pass `storedKeyMayGoTo` (it reads as "the stored one"),
  // but here there is no stored address to fall back to — refuse it outright.
  if (!incoming.webhookUrl?.trim()) return incoming
  if (!storedKeyMayGoTo(incoming.webhookUrl, [stored.webhookUrl])) return incoming
  return { ...incoming, authHeaderValue: stored.authHeaderValue }
}

// ---------------------------------------------------------------------------
// Media server
// ---------------------------------------------------------------------------

interface MediaServerSecret {
  apiKey: string | null
}

export type PublicMediaServerConfig<T extends MediaServerSecret> = Omit<T, 'apiKey'> & {
  hasApiKey: boolean
  /** The key's last four characters, for recognising which key is saved. */
  apiKeyHint: string | null
}

export function publicMediaServerConfig<T extends MediaServerSecret>(config: T): PublicMediaServerConfig<T> {
  const { apiKey, ...rest } = config
  return { ...rest, hasApiKey: !!apiKey?.trim(), apiKeyHint: keyHint(apiKey) }
}
