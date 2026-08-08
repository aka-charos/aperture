/**
 * LLDAP Client
 *
 * Talks to an LLDAP server (https://github.com/lldap/lldap) to look up user emails
 * by username. Two calls: a login (POST /auth/simple/login) to get a short-lived
 * JWT, then a bulk GraphQL query for every user's id + email.
 *
 * The token is never cached/persisted — it's fetched fresh per job run or connection
 * test. The email-sync job runs at most a few times a day (see jobConfig ENV_DEFAULTS),
 * so there's no benefit to holding a token across runs, and LLDAP's own token is only
 * good for a day anyway.
 */

import { createChildLogger } from '../lib/logger.js'
import { parseApiError } from '../errors/handler.js'
import { logApiError, hasRecentSimilarError, dismissResolvedErrors } from '../errors/db.js'

const logger = createChildLogger('lldap')

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Read a failed response's body for diagnostics (truncated, never throws). */
async function readErrorBody(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text()
    return text ? text.slice(0, 300) : undefined
  } catch {
    return undefined
  }
}

/** Record a failed LLDAP response in the admin alert list, deduplicated (see mdblist/provider.ts for the same pattern). */
async function recordLldapError(status: number, endpoint: string, responseBody?: string): Promise<void> {
  const parsedError = parseApiError('lldap', status)

  logger.error({ status, endpoint, responseBody }, 'LLDAP request failed')

  const hasRecent = await hasRecentSimilarError('lldap', parsedError.definition.type, status)
  if (hasRecent) return

  await logApiError(parsedError).catch((err) => logger.error({ err }, 'Failed to log API error'))
}

interface LldapTokenResponse {
  token?: string
  refreshToken?: string
}

/** Explicit tagged union — narrows reliably through generic call sites, unlike an `error?` optional-property union. */
export type LldapResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Log in to LLDAP with an admin username/password and return a bearer token.
 */
export async function authenticateLldap(
  baseUrl: string,
  username: string,
  password: string
): Promise<LldapResult<{ token: string }>> {
  const url = `${normalizeBaseUrl(baseUrl)}/auth/simple/login`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

    if (!response.ok) {
      const body = await readErrorBody(response)
      await recordLldapError(response.status, '/auth/simple/login', body)
      return {
        ok: false,
        error:
          response.status === 401
            ? 'Invalid LLDAP admin credentials'
            : `LLDAP login failed (HTTP ${response.status})`,
      }
    }

    const data = (await response.json()) as LldapTokenResponse
    if (!data.token) {
      return { ok: false, error: 'LLDAP login response did not include a token' }
    }
    return { ok: true, value: { token: data.token } }
  } catch (err) {
    logger.warn({ err }, 'LLDAP authentication request failed')
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to reach LLDAP server' }
  }
}

export interface LldapUserNode {
  id: string
  email: string
}

interface LldapGraphqlResponse {
  data?: { users?: LldapUserNode[] }
  errors?: Array<{ message: string }>
}

/**
 * Fetch id + email for every LLDAP user in one GraphQL call. Requires an admin
 * token — a regular user's token only resolves their own record, so the
 * configured account must be an LLDAP admin.
 */
export async function fetchLldapUserEmails(
  baseUrl: string,
  token: string
): Promise<LldapResult<{ users: LldapUserNode[] }>> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/graphql`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: '{ users { id email } }' }),
    })

    if (!response.ok) {
      const body = await readErrorBody(response)
      await recordLldapError(response.status, '/api/graphql', body)
      return { ok: false, error: `LLDAP query failed (HTTP ${response.status})` }
    }

    const data = (await response.json()) as LldapGraphqlResponse
    if (data.errors?.length) {
      const message = data.errors.map((e) => e.message).join('; ')
      logger.warn({ message }, 'LLDAP GraphQL query returned errors')
      return { ok: false, error: message }
    }
    if (!data.data?.users) {
      return { ok: false, error: 'LLDAP response did not include a user list' }
    }
    return { ok: true, value: { users: data.data.users } }
  } catch (err) {
    logger.warn({ err }, 'LLDAP GraphQL request failed')
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to reach LLDAP server' }
  }
}

/**
 * Test an LLDAP connection end-to-end: log in, then run the bulk user query.
 * Used by both the settings "Test Connection" button and can be reused before
 * saving new credentials.
 */
export async function testLldapConnection(params: {
  url: string
  adminUsername: string
  adminPassword: string
}): Promise<{ success: boolean; error?: string; userCount?: number }> {
  if (!params.url || !params.adminUsername || !params.adminPassword) {
    return { success: false, error: 'Server URL, admin username, and admin password are all required' }
  }

  const auth = await authenticateLldap(params.url, params.adminUsername, params.adminPassword)
  if (!auth.ok) {
    return { success: false, error: auth.error }
  }

  const result = await fetchLldapUserEmails(params.url, auth.value.token)
  if (!result.ok) {
    return { success: false, error: result.error }
  }

  await dismissResolvedErrors('lldap').catch((err) =>
    logger.warn({ err }, 'Failed to dismiss resolved LLDAP errors')
  )

  return { success: true, userCount: result.value.users.length }
}
