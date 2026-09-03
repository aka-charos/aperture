import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { randomBytes, createHash } from 'crypto'
import { query, queryOne } from '../lib/db.js'
import { validateApiKey } from '@aperture/core'
import { createChildLogger } from '../lib/logger.js'
import { useSecureCookies } from '../config/security.js'
import {
  IMPERSONATION_COOKIE_NAME,
  IMPERSONATION_DURATION_MINUTES,
  IMPERSONATION_TOKEN_BYTES,
  IMPERSONATION_READ_ONLY_ERROR,
  impersonationBlocksRequest,
} from '../lib/impersonation.js'

const sessionLogger = createChildLogger('auth-session')

export interface SessionUser {
  id: string
  username: string
  displayName: string | null
  provider: 'emby' | 'jellyfin'
  providerUserId: string
  isAdmin: boolean
  isEnabled: boolean
  canManageWatchHistory: boolean
  collectionsEnabled: boolean
  avatarUrl: string | null
}

/**
 * An admin looking at the app as another user.
 *
 * While this is set, `request.user` is the TARGET — every handler downstream
 * sees the assumed account and needs no knowledge of this feature at all — and
 * this holds the admin who is really there, which is what the exit control
 * reads.
 */
export interface ImpersonationContext {
  /** The real operator. Never the target. */
  admin: SessionUser
  /** When the grant lapses on its own, ISO-8601. */
  expiresAt: string
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser
    sessionId?: string
    /** The `sessions.id` behind the cookie. An assumption is bound to it. */
    sessionRowId?: string
    sessionError?: boolean
    /** Set only while an admin is viewing the app as another user. */
    impersonation?: ImpersonationContext
    /** True if the request was authenticated via API key */
    isApiKeyAuth?: boolean
    /** The API key ID if authenticated via API key */
    apiKeyId?: string
  }
}

interface UserLookupRow {
  id: string
  username: string
  display_name: string | null
  provider: 'emby' | 'jellyfin'
  provider_user_id: string
  is_admin: boolean
  is_enabled: boolean
  can_manage_watch_history: boolean
  collections_enabled: boolean
}

interface SessionLookupRow extends UserLookupRow {
  session_id: string
  expires_at: Date
  last_seen_at: Date
}

interface ImpersonationLookupRow extends UserLookupRow {
  impersonation_id: string
  impersonation_expires_at: Date
  admin_session_id: string
}

/**
 * The user columns every lookup here selects, written once. `alias` is the
 * table the columns come from.
 */
const USER_COLUMNS = (alias: string) =>
  `${alias}.id, ${alias}.username, ${alias}.display_name, ${alias}.provider, ${alias}.provider_user_id,
   ${alias}.is_admin, ${alias}.is_enabled, ${alias}.can_manage_watch_history, ${alias}.collections_enabled`

const SESSION_COOKIE_NAME = 'aperture_session'
/** Absolute lifetime: a session dies this long after it was created. */
const SESSION_DURATION_DAYS = 30
/** Idle lifetime: a session dies this long after its last request. */
const SESSION_IDLE_DAYS = 7
/**
 * `last_seen_at` is only rewritten once per this interval. Refreshing it on
 * every request would add a write to each of the app's many poll requests for
 * no benefit — the idle window is measured in days.
 */
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000

/** Bytes of entropy in a session token. */
const SESSION_TOKEN_BYTES = 32

/**
 * The token is a bearer credential, so the database stores only its digest —
 * same reasoning as api_keys. A plain sha256 is right here (unlike a password):
 * the input is 256 bits of CSPRNG output, so there is nothing to brute-force
 * and nothing for a slow KDF to buy.
 */
function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Create a session and return its token. The token is returned once and never
 * stored; only the caller (via the cookie) ever holds it.
 */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url')

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS)

  const result = await queryOne<{ id: string }>(
    `INSERT INTO sessions (user_id, expires_at, token_hash) VALUES ($1, $2, $3) RETURNING id`,
    [userId, expiresAt, hashSessionToken(token)]
  )

  if (!result) {
    throw new Error('Failed to create session')
  }

  // Persisted on the user row rather than derived from `sessions.last_seen_at` —
  // that column gets rewritten by activity (not just login) and the row itself
  // is pruned by cleanup-auth-state once idle, which would otherwise make a past
  // login look like it never happened. Best-effort: never fail a login over this.
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]).catch((err) =>
    sessionLogger.warn({ err, userId }, 'Failed to update last_login_at')
  )

  return token
}

export async function deleteSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(token)])
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId])
}

/**
 * A `users` row as the rest of the app sees it. Shared by the session lookup
 * and the assumption lookup so the two cannot describe the same account
 * differently.
 */
function toSessionUser(row: UserLookupRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    isAdmin: row.is_admin,
    isEnabled: row.is_enabled,
    canManageWatchHistory: row.can_manage_watch_history,
    collectionsEnabled: row.collections_enabled,
    // Local avatar proxy URL, to avoid mixed content issues — the avatar
    // endpoint proxies to the media server.
    avatarUrl: `/api/users/${row.id}/avatar`,
  }
}

interface SessionLookupResult {
  user: SessionUser
  /** `sessions.id`, not the token. */
  sessionRowId: string
}

async function getSessionUser(token: string): Promise<SessionLookupResult | null> {
  const tokenHash = hashSessionToken(token)

  const row = await queryOne<SessionLookupRow>(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, ${USER_COLUMNS('u')}
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [tokenHash]
  )

  // No row means no such session — nothing to clean up. Deliberately no DELETE
  // here: a garbage cookie would then buy an unauthenticated caller a write.
  // (A session cannot outlive its user; sessions.user_id cascades on delete.)
  if (!row) {
    return null
  }

  const now = Date.now()
  const expired = new Date(row.expires_at).getTime() < now
  const idleDeadline =
    new Date(row.last_seen_at).getTime() + SESSION_IDLE_DAYS * 24 * 60 * 60 * 1000

  if (expired || idleDeadline < now) {
    await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
    return null
  }

  // A disabled account must lose access immediately, not at session expiry.
  if (!row.is_enabled) {
    await query('DELETE FROM sessions WHERE user_id = $1', [row.id])
    return null
  }

  const lastSeenAge = now - new Date(row.last_seen_at).getTime()
  if (lastSeenAge > SESSION_TOUCH_INTERVAL_MS) {
    // Fire and forget: a failed touch costs at most an early idle expiry, so it
    // must not fail the request. Logged rather than swallowed — if this breaks
    // persistently, active users get signed out at the idle deadline and the
    // only evidence would be here.
    query('UPDATE sessions SET last_seen_at = NOW() WHERE id = $1', [row.session_id]).catch(
      (err) => sessionLogger.warn({ err }, 'Failed to refresh session last_seen_at')
    )
  }

  return { user: toSessionUser(row), sessionRowId: row.session_id }
}

/* ------------------------------------------------------------------ *
 * Account assumption ("view as user")
 *
 * The admin's session cookie is never touched. A grant is a second cookie
 * beside it, so stopping is a delete of one row and one cookie — the admin's
 * own credential is still in the browser and still valid, which is what makes
 * "get me out of here" unfailable rather than a restore that could go wrong.
 * ------------------------------------------------------------------ */

export interface ImpersonationTarget {
  target: SessionUser
  expiresAt: Date
}

/**
 * Start an assumption. Returns the token, which is handed to the browser once
 * and never stored — only its digest is.
 *
 * Nothing here writes to the target's row: no session is created for them, so
 * `users.last_login_at` and `sessions.last_seen_at` stay exactly as the target
 * left them.
 */
export async function createImpersonation(
  adminUserId: string,
  adminSessionRowId: string,
  targetUserId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(IMPERSONATION_TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(Date.now() + IMPERSONATION_DURATION_MINUTES * 60 * 1000)

  // One assumption per admin session. Starting a second replaces the first
  // rather than leaving an orphan that the cookie no longer points at.
  await query('DELETE FROM impersonation_sessions WHERE admin_session_id = $1', [
    adminSessionRowId,
  ])

  await query(
    `INSERT INTO impersonation_sessions (token_hash, admin_user_id, admin_session_id, target_user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashSessionToken(token), adminUserId, adminSessionRowId, targetUserId, expiresAt]
  )

  return { token, expiresAt }
}

export async function deleteImpersonation(token: string): Promise<void> {
  await query('DELETE FROM impersonation_sessions WHERE token_hash = $1', [
    hashSessionToken(token),
  ])
}

/**
 * Resolve an assumption cookie against the session that is presenting it.
 *
 * Every failure returns null and the caller clears the cookie, so a grant that
 * has lapsed, been revoked, or belongs to a different session degrades to
 * "you are yourself again" rather than to an error page.
 */
async function getImpersonationTarget(
  token: string,
  adminSessionRowId: string
): Promise<ImpersonationTarget | null> {
  const tokenHash = hashSessionToken(token)

  const row = await queryOne<ImpersonationLookupRow>(
    `SELECT i.id AS impersonation_id, i.expires_at AS impersonation_expires_at, i.admin_session_id,
            ${USER_COLUMNS('u')}
       FROM impersonation_sessions i
       JOIN users u ON u.id = i.target_user_id
      WHERE i.token_hash = $1`,
    [tokenHash]
  )

  if (!row) return null

  const expiresAt = new Date(row.impersonation_expires_at)

  // Presented by a different session than the one that started it. Not deleted:
  // the grant may still be live for its real owner, and a stray cookie must not
  // be able to end someone else's assumption.
  if (row.admin_session_id !== adminSessionRowId) return null

  if (expiresAt.getTime() < Date.now()) {
    await query('DELETE FROM impersonation_sessions WHERE id = $1', [row.impersonation_id])
    return null
  }

  // The target was disabled while being viewed. Same rule as a session: a
  // disabled account is not browsable, by anyone, immediately.
  if (!row.is_enabled) {
    await query('DELETE FROM impersonation_sessions WHERE id = $1', [row.impersonation_id])
    return null
  }

  return { target: toSessionUser(row), expiresAt }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Track if session validation failed (for error messaging)
  fastify.decorateRequest('sessionError', false)
  fastify.decorateRequest('isApiKeyAuth', false)
  fastify.decorateRequest('apiKeyId', undefined)

  // Add hook to parse authentication from API key or session cookie
  fastify.addHook('onRequest', async (request, reply) => {
    // First, check for API key authentication (takes precedence)
    const apiKey = request.headers['x-api-key'] as string | undefined
    if (apiKey) {
      try {
        const apiKeyUser = await validateApiKey(apiKey)
        if (apiKeyUser) {
          // Build SessionUser from API key user data
          request.user = {
            id: apiKeyUser.userId,
            username: apiKeyUser.username,
            displayName: apiKeyUser.displayName,
            provider: 'emby', // API key users don't have a provider context, default to emby
            providerUserId: '',
            isAdmin: apiKeyUser.isAdmin,
            isEnabled: apiKeyUser.isEnabled,
            canManageWatchHistory: apiKeyUser.canManageWatchHistory,
            // API-key users: admins are allowed via isAdmin; non-admins default to no access.
            collectionsEnabled: false,
            avatarUrl: `/api/users/${apiKeyUser.userId}/avatar`,
          }
          request.isApiKeyAuth = true
          request.apiKeyId = apiKeyUser.id
          return // Skip session cookie check
        }
      } catch (err) {
        fastify.log.warn({ err, keyPrefix: apiKey.substring(0, 8) }, 'Failed to validate API key')
      }
    }

    // Fall back to session cookie authentication
    const sessionToken = request.cookies[SESSION_COOKIE_NAME]

    if (sessionToken) {
      request.sessionId = sessionToken
      try {
        const session = await getSessionUser(sessionToken)
        request.user = session?.user
        request.sessionRowId = session?.sessionRowId
      } catch (err) {
        // Log error but don't crash the request - this allows static files to load
        // even if there's a database issue. Protected routes will still fail properly
        // via requireAuth middleware.
        // The token is a live credential, so no prefix of it goes to the log.
        fastify.log.warn({ err }, 'Failed to get session user')
        request.user = undefined
        request.sessionRowId = undefined
        request.sessionError = true
      }
    }

    // An assumption only ever layers on top of a live cookie session. An API
    // key has no session row to bind to, and nothing to return the caller to.
    const impersonationToken = request.cookies[IMPERSONATION_COOKIE_NAME]
    if (!impersonationToken || !request.user || !request.sessionRowId) {
      // A leftover cookie with no session behind it is cleared rather than
      // ignored, so it cannot resurrect an assumption at the next sign-in.
      // Not on `sessionError` though: a database hiccup is not evidence that
      // the assumption is over, and clearing there would end a live one.
      //
      // Scoped to API requests so a Set-Cookie is not stapled to every static
      // asset response — those are the ones an intermediary might cache, and a
      // cached cookie header is somebody else's problem to debug. The SPA
      // cannot render without calling the API, so the clear still always lands.
      if (
        impersonationToken &&
        !request.user &&
        !request.sessionError &&
        request.url.startsWith('/api/')
      ) {
        clearImpersonationCookie(reply)
      }
      return
    }

    const admin = request.user

    // Only an admin may hold one, re-checked on every request rather than only
    // at the start: demoting an account ends its assumptions at once.
    //
    // The row is deliberately NOT deleted here, matching the session-mismatch
    // branch below. The grant belongs to a session other than this one, and
    // letting a non-admin's request delete it is a cross-session write handed
    // to the wrong party. Clearing this browser's cookie ends it here, and
    // every other request re-runs this same check, so the row is inert.
    if (!admin.isAdmin) {
      clearImpersonationCookie(reply)
      return
    }

    let assumed: ImpersonationTarget | null = null
    try {
      assumed = await getImpersonationTarget(impersonationToken, request.sessionRowId)
    } catch (err) {
      // Deliberately not fatal, and deliberately not a fallback to the target:
      // a database hiccup leaves the admin as themselves, which is the safe
      // side of this particular failure.
      fastify.log.warn({ err }, 'Failed to resolve impersonation')
      return
    }

    if (!assumed) {
      clearImpersonationCookie(reply)
      return
    }

    // From here down every handler sees the target and needs no knowledge of
    // this feature. The admin is kept beside it for the exit control.
    request.user = assumed.target
    request.impersonation = { admin, expiresAt: assumed.expiresAt.toISOString() }

    if (impersonationBlocksRequest(request.method, request.url)) {
      request.log.info(
        {
          adminUserId: admin.id,
          targetUserId: assumed.target.id,
          method: request.method,
          url: request.url,
        },
        'Refused a write from an assumed session'
      )
      return reply.status(403).send(IMPERSONATION_READ_ONLY_ERROR)
    }
  })
}

export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['@fastify/cookie'],
})

// Middleware to require authentication
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
}

// Middleware to require admin
//
// There is deliberately no bypass here. Server-side callers that need to start
// work without a logged-in user (the setup wizard) call the domain function
// directly — see routes/jobs/startJob.ts — rather than replaying an HTTP
// request that then has to defeat this check to get through.
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }

  if (!request.user.isAdmin) {
    return reply.status(403).send({ error: 'Forbidden: Admin access required' })
  }
}

/**
 * Attributes shared by set and clear. A cookie is only cleared when the
 * attributes match the ones it was set with, so these must not drift apart.
 */
function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: useSecureCookies(),
    path: '/',
  }
}

// Helper to set session cookie
export function setSessionCookie(reply: FastifyReply, token: string): void {
  const maxAge = SESSION_DURATION_DAYS * 24 * 60 * 60 // seconds

  reply.setCookie(SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions(),
    maxAge,
  })
}

// Helper to clear session cookie
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions())
}

/**
 * Same attributes as the session cookie, minus the 30-day `maxAge`: an
 * assumption is a session cookie in the browser sense, so closing the browser
 * ends it even before the server-side lease does.
 */
export function setImpersonationCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(IMPERSONATION_COOKIE_NAME, token, sessionCookieOptions())
}

export function clearImpersonationCookie(reply: FastifyReply): void {
  reply.clearCookie(IMPERSONATION_COOKIE_NAME, sessionCookieOptions())
}

export { SESSION_COOKIE_NAME, IMPERSONATION_COOKIE_NAME }

