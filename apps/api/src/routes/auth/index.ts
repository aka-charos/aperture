import type { FastifyPluginAsync } from 'fastify'
import {
  getMediaServerProvider,
  getMediaServerConfig,
  getSystemSetting,
  InvalidCredentialsError,
  type AuthResult,
} from '@aperture/core'
import { queryOne } from '../../lib/db.js'
import {
  createSession,
  deleteSession,
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
  type SessionUser,
} from '../../plugins/auth.js'
import {
  checkLoginLockout,
  recordFailedLogin,
  clearLoginAttempts,
} from '../../lib/loginAttempts.js'
import { passwordlessLoginPermitted } from '../../config/security.js'
import {
  loginRateLimit,
  loginOptionsRateLimit,
  authCheckRateLimit,
} from '../../config/rateLimits.js'
import {
  authSchemas,
  loginOptionsSchema,
  loginSchema,
  logoutSchema,
  getMeSchema,
  getPreferencesSchema,
  updatePreferencesSchema,
  createFilterPresetSchema,
  updateFilterPresetSchema,
  deleteFilterPresetSchema,
  authCheckSchema,
} from './schemas.js'

interface LoginBody {
  username: string
  password: string
}

/**
 * The admin toggle, subject to the deployment-level gate. Resolved through one
 * helper so /login-options and /login can never disagree about whether a
 * password is required.
 */
async function isPasswordlessLoginEnabled(): Promise<boolean> {
  if (!passwordlessLoginPermitted()) return false
  return (await getSystemSetting('allow_passwordless_login')) === 'true'
}

interface UserRow {
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

interface LoginResponse {
  user: SessionUser
}

interface MeResponse {
  user: SessionUser
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Register schemas
  for (const [name, schema] of Object.entries(authSchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  /**
   * GET /api/auth/login-options
   */
  fastify.get(
    '/api/auth/login-options',
    {
      schema: loginOptionsSchema,
      config: { rateLimit: loginOptionsRateLimit },
    },
    async (_request, reply) => {
      return reply.send({
        allowPasswordlessLogin: await isPasswordlessLoginEnabled(),
      })
    }
  )

  /**
   * POST /api/auth/login
   */
  fastify.post<{ Body: LoginBody; Reply: LoginResponse }>(
    '/api/auth/login',
    {
      schema: loginSchema,
      config: { rateLimit: loginRateLimit },
    },
    async (request, reply) => {
      const { username, password } = request.body

      const passwordRequired = !(await isPasswordlessLoginEnabled())

      if (!username) {
        return reply.status(400).send({ error: 'Username is required' } as never)
      }

      if (passwordRequired && !password) {
        return reply.status(400).send({ error: 'Password is required' } as never)
      }

      const lockout = await checkLoginLockout(username)
      if (lockout.locked) {
        reply.header('Retry-After', String(lockout.retryAfterSeconds))
        return reply.status(429).send({
          error: 'Too many failed attempts for this account. Please try again later.',
        } as never)
      }

      let provider
      try {
        provider = await getMediaServerProvider()
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get media server provider')
        return reply.status(500).send({ error: 'Media server not configured' } as never)
      }

      let authResult: AuthResult
      try {
        authResult = await provider.authenticateByName(username, password || '')
      } catch (err) {
        // Only a credential rejection counts toward the lockout. A timeout, a
        // 5xx or an unreachable media server says nothing about the user, and
        // counting those would turn an upstream outage into an escalating
        // lockout for every user who retries during it.
        if (!(err instanceof InvalidCredentialsError)) {
          fastify.log.error({ err }, 'Media server unreachable during authentication')
          return reply.status(503).send({
            error: 'Could not reach the media server. Please try again shortly.',
          } as never)
        }

        const failure = await recordFailedLogin(username)
        fastify.log.warn({ username }, 'Authentication failed: invalid credentials')
        if (failure.locked) {
          reply.header('Retry-After', String(failure.retryAfterSeconds))
        }
        // Deliberately identical to the lockout-free failure response so the
        // endpoint does not confirm which usernames exist.
        return reply.status(401).send({ error: 'Invalid username or password' } as never)
      }

      await clearLoginAttempts(username)

      const config = await getMediaServerConfig()
      if (!config.apiKey) {
        fastify.log.error('Media server API key not configured')
        return reply.status(500).send({ error: 'Media server not configured' } as never)
      }
      const providerUser = await provider.getUserById(config.apiKey, authResult.userId)

      const existingUser = await queryOne<UserRow>(
        `SELECT id, username, display_name, provider, provider_user_id, is_admin, is_enabled, can_manage_watch_history, collections_enabled
         FROM users WHERE provider = $1 AND provider_user_id = $2`,
        [provider.type, authResult.userId]
      )

      let user: UserRow

      // authResult.accessToken is deliberately not persisted. It is a live
      // media-server credential and nothing in the app ever read it back — all
      // server-side calls use the admin API key from system_settings.
      if (existingUser) {
        const updated = await queryOne<UserRow>(
          `UPDATE users SET
            username = $1,
            is_admin = $2,
            max_parental_rating = $3,
            updated_at = NOW()
           WHERE id = $4
           RETURNING id, username, display_name, provider, provider_user_id, is_admin, is_enabled, can_manage_watch_history, collections_enabled`,
          [
            authResult.userName,
            authResult.isAdmin,
            providerUser.maxParentalRating ?? null,
            existingUser.id,
          ]
        )
        user = updated!
      } else {
        const created = await queryOne<UserRow>(
          `INSERT INTO users (username, display_name, provider, provider_user_id, is_admin, max_parental_rating)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, username, display_name, provider, provider_user_id, is_admin, is_enabled, can_manage_watch_history, collections_enabled`,
          [
            authResult.userName,
            authResult.userName,
            provider.type,
            authResult.userId,
            authResult.isAdmin,
            providerUser.maxParentalRating ?? null,
          ]
        )
        user = created!
      }

      // Authenticating against the media server says nothing about whether an
      // admin has disabled the account here. Checked after the upsert so the
      // row reflects the current state, and before any session exists.
      if (!user.is_enabled) {
        fastify.log.warn({ userId: user.id }, 'Login refused: account disabled')
        return reply.status(403).send({
          error: 'This account has been disabled. Contact your administrator.',
        } as never)
      }

      const sessionToken = await createSession(user.id)
      setSessionCookie(reply, sessionToken)

      const avatarUrl = `/api/users/${user.id}/avatar`

      const sessionUser: SessionUser = {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        provider: user.provider,
        providerUserId: user.provider_user_id,
        isAdmin: user.is_admin,
        isEnabled: user.is_enabled,
        canManageWatchHistory: user.can_manage_watch_history ?? false,
        collectionsEnabled: user.collections_enabled ?? false,
        avatarUrl,
      }

      return reply.send({ user: sessionUser })
    }
  )

  /**
   * POST /api/auth/logout
   */
  fastify.post('/api/auth/logout', { schema: logoutSchema }, async (request, reply) => {
    if (request.sessionId) {
      await deleteSession(request.sessionId)
    }
    clearSessionCookie(reply)
    return reply.send({ success: true })
  })

  /**
   * GET /api/auth/me
   */
  fastify.get<{ Reply: MeResponse }>(
    '/api/auth/me',
    { preHandler: requireAuth, schema: getMeSchema },
    async (request, reply) => {
      return reply.send({ user: request.user! })
    }
  )

  /**
   * GET /api/auth/me/preferences
   */
  fastify.get<{ Reply: Record<string, unknown> }>(
    '/api/auth/me/preferences',
    { preHandler: requireAuth, schema: getPreferencesSchema },
    async (request, reply) => {
      const {
        getUserUiPreferences,
        resolveEffectiveUiLanguage,
        resolveEffectiveAiLanguage,
        getPosterDisplayConfig,
      } = await import('@aperture/core')
      const uid = request.user!.id
      const preferences = await getUserUiPreferences(uid)
      const [effectiveUiLanguage, effectiveAiLanguage, posterDisplay] = await Promise.all([
        resolveEffectiveUiLanguage(uid),
        resolveEffectiveAiLanguage(uid),
        getPosterDisplayConfig(),
      ])
      return reply.send({
        ...preferences,
        effectiveUiLanguage,
        effectiveAiLanguage,
        posterRatingHiddenByDefault: posterDisplay.hideRatingBadgeByDefault,
      })
    }
  )

  /**
   * PATCH /api/auth/me/preferences
   */
  fastify.patch(
    '/api/auth/me/preferences',
    { preHandler: requireAuth, schema: updatePreferencesSchema },
    async (request, reply) => {
      const { updateUserUiPreferences, getUserUiPreferences } = await import('@aperture/core')
      type UserUiPreferences = Awaited<ReturnType<typeof getUserUiPreferences>>
      const body = request.body as Partial<UserUiPreferences>
      
      const currentPrefs = await getUserUiPreferences(request.user!.id)
      const updates: Partial<UserUiPreferences> = { ...body }
      
      if (body.viewModes) {
        updates.viewModes = {
          ...currentPrefs.viewModes,
          ...body.viewModes,
        }
      }
      
      if (body.browseSort) {
        updates.browseSort = {
          movies: body.browseSort.movies || currentPrefs.browseSort?.movies || { sortBy: 'title', sortOrder: 'asc' },
          series: body.browseSort.series || currentPrefs.browseSort?.series || { sortBy: 'title', sortOrder: 'asc' },
        }
      }
      
      const preferences = await updateUserUiPreferences(request.user!.id, updates)
      const { resolveEffectiveUiLanguage, resolveEffectiveAiLanguage, getPosterDisplayConfig } =
        await import('@aperture/core')
      const uid = request.user!.id
      const [effectiveUiLanguage, effectiveAiLanguage, posterDisplay] = await Promise.all([
        resolveEffectiveUiLanguage(uid),
        resolveEffectiveAiLanguage(uid),
        getPosterDisplayConfig(),
      ])
      return reply.send({
        ...preferences,
        effectiveUiLanguage,
        effectiveAiLanguage,
        posterRatingHiddenByDefault: posterDisplay.hideRatingBadgeByDefault,
      })
    }
  )

  /**
   * POST /api/auth/me/filter-presets
   */
  fastify.post(
    '/api/auth/me/filter-presets',
    { preHandler: requireAuth, schema: createFilterPresetSchema },
    async (request, reply) => {
      const { addBrowseFilterPreset } = await import('@aperture/core')
      const body = request.body as { name: string; type: 'movies' | 'series'; filters: Record<string, unknown> }
      
      const preset = await addBrowseFilterPreset(request.user!.id, {
        name: body.name,
        type: body.type,
        filters: body.filters,
      })
      
      return reply.status(201).send(preset)
    }
  )

  /**
   * PATCH /api/auth/me/filter-presets/:id
   */
  fastify.patch<{ Params: { id: string } }>(
    '/api/auth/me/filter-presets/:id',
    { preHandler: requireAuth, schema: updateFilterPresetSchema },
    async (request, reply) => {
      const { updateBrowseFilterPreset } = await import('@aperture/core')
      const { id } = request.params
      const body = request.body as { name?: string; filters?: Record<string, unknown> }
      
      const preset = await updateBrowseFilterPreset(request.user!.id, id, body)
      
      if (!preset) {
        return reply.status(404).send({ error: 'Preset not found' })
      }
      
      return reply.send(preset)
    }
  )

  /**
   * DELETE /api/auth/me/filter-presets/:id
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/auth/me/filter-presets/:id',
    { preHandler: requireAuth, schema: deleteFilterPresetSchema },
    async (request, reply) => {
      const { deleteBrowseFilterPreset } = await import('@aperture/core')
      const { id } = request.params
      
      const deleted = await deleteBrowseFilterPreset(request.user!.id, id)
      
      if (!deleted) {
        return reply.status(404).send({ error: 'Preset not found' })
      }
      
      return reply.status(204).send()
    }
  )

  /**
   * GET /api/auth/check
   */
  fastify.get(
    '/api/auth/check',
    {
      schema: authCheckSchema,
      config: { rateLimit: authCheckRateLimit },
    },
    async (request, reply) => {
      if (request.user) {
        return reply.send({ authenticated: true, user: request.user })
      }

      if (request.sessionError) {
        clearSessionCookie(reply)
        return reply.send({
          authenticated: false,
          user: null,
          sessionError: true,
          message:
            'Your session was invalid. This can happen if the server was reconfigured. Please log in again.',
        })
      }

      return reply.send({ authenticated: false, user: null })
    }
  )
}

export default authRoutes
