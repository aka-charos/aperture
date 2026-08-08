import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { randomBytes, createHash } from 'crypto'
import { query, queryOne } from '../lib/db.js'
import { validateApiKey } from '@aperture/core'
import { createChildLogger } from '../lib/logger.js'
import { useSecureCookies } from '../config/security.js'

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

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser
    sessionId?: string
    sessionError?: boolean
    /** True if the request was authenticated via API key */
    isApiKeyAuth?: boolean
    /** The API key ID if authenticated via API key */
    apiKeyId?: string
  }
}

interface SessionLookupRow {
  session_id: string
  expires_at: Date
  last_seen_at: Date
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

async function getSessionUser(token: string): Promise<SessionUser | null> {
  const tokenHash = hashSessionToken(token)

  const row = await queryOne<SessionLookupRow>(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
            u.id, u.username, u.display_name, u.provider, u.provider_user_id,
            u.is_admin, u.is_enabled, u.can_manage_watch_history, u.collections_enabled
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

  // Use local avatar proxy URL to avoid mixed content issues
  // The avatar endpoint proxies to the media server
  const avatarUrl = `/api/users/${row.id}/avatar`

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
    avatarUrl,
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Track if session validation failed (for error messaging)
  fastify.decorateRequest('sessionError', false)
  fastify.decorateRequest('isApiKeyAuth', false)
  fastify.decorateRequest('apiKeyId', undefined)

  // Add hook to parse authentication from API key or session cookie
  fastify.addHook('onRequest', async (request) => {
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
        request.user = (await getSessionUser(sessionToken)) || undefined
      } catch (err) {
        // Log error but don't crash the request - this allows static files to load
        // even if there's a database issue. Protected routes will still fail properly
        // via requireAuth middleware.
        // The token is a live credential, so no prefix of it goes to the log.
        fastify.log.warn({ err }, 'Failed to get session user')
        request.user = undefined
        request.sessionError = true
      }
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

export { SESSION_COOKIE_NAME }

