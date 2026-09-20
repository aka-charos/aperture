/**
 * What an API key may do with the account behind it.
 *
 * A key used to BE the account. `validateApiKey` returns `is_admin` and the
 * auth plugin copied it onto the request, so a key minted for a shell script
 * could purge the database, read provider credentials and rewrite every user's
 * permissions — the same authority as a browser session, with none of its
 * limits (no 7-day idle window, no 30-day lifetime, no `provider_disabled`
 * check until F-132, and nothing that revokes it when an admin is demoted).
 * `collections_enabled` was forced false for key users, which shows the concern
 * was noticed at the time and then not followed through.
 *
 * Three rules.
 *
 * 1. **A scope NARROWS, never widens.** `admin` on a key belonging to a
 *    non-admin grants nothing; `keyAllowsAdmin` answers only whether the key
 *    may exercise rights the account already has. A scope that could add
 *    authority would be a second permission system racing the first, and the
 *    one that granted more would win every argument.
 *
 * 2. **`read` is implied and cannot be given up.** A key that may do nothing is
 *    a revoked key, and the app already has one of those. Keeping `read` out of
 *    the vocabulary would make the empty array mean "everything" by accident,
 *    so it is a real member that is always present.
 *
 * 3. **An unrecognised scope is DROPPED, never forwarded.** The column is a
 *    plain `TEXT[]` — nothing in Postgres constrains it — so a typo or a value
 *    from a newer build must not read as a grant. `normalizeApiKeyScopes` is
 *    the only way a stored array becomes a decision.
 *
 * Existing keys were backfilled to the full set by `0182`, deliberately: they
 * are wired into somebody's Home Assistant, and silently narrowing a running
 * integration is a worse failure than leaving the authority visible and
 * narrowable. NEW keys default to `read` alone.
 */

export const API_KEY_SCOPES = ['read', 'write', 'admin'] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

/** Every new key starts here. Read-only, and never admin. */
export const DEFAULT_API_KEY_SCOPES: readonly ApiKeyScope[] = ['read']

/**
 * What a key created before scopes existed could do.
 *
 * Referenced by `0182`'s backfill and by the test that pins the two against
 * each other, so "what the old behaviour was" has one spelling.
 */
export const LEGACY_API_KEY_SCOPES: readonly ApiKeyScope[] = ['read', 'write', 'admin']

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === 'string' && (API_KEY_SCOPES as readonly string[]).includes(value)
}

/**
 * A stored array as a decision: recognised members only, `read` always present,
 * de-duplicated, in `API_KEY_SCOPES` order so two equal sets compare equal.
 *
 * A null or absent column is a row from before `0182` that the migration
 * somehow missed; it reads as the default rather than as full authority,
 * because the safe side of that mistake is a key that stops working and gets
 * reported, not one that quietly keeps root.
 */
export function normalizeApiKeyScopes(stored: unknown): ApiKeyScope[] {
  const listed = Array.isArray(stored) ? stored.filter(isApiKeyScope) : []
  const wanted = new Set<ApiKeyScope>(listed.length > 0 ? listed : DEFAULT_API_KEY_SCOPES)
  wanted.add('read')
  return API_KEY_SCOPES.filter((scope) => wanted.has(scope))
}

/**
 * Whether the key may exercise the account's admin rights.
 *
 * The caller still has to be an admin. This answers the other half.
 */
export function keyAllowsAdmin(scopes: readonly ApiKeyScope[]): boolean {
  return scopes.includes('admin')
}

/** Whether the key may make requests that change anything. */
export function keyAllowsWrite(scopes: readonly ApiKeyScope[]): boolean {
  return scopes.includes('write')
}

/**
 * Human-readable summary for a log line or an audit trail. Display strings in
 * the UI are translated and built there; this is for the server's own record.
 */
export function describeApiKeyScopes(scopes: readonly ApiKeyScope[]): string {
  return normalizeApiKeyScopes(scopes).join('+')
}
