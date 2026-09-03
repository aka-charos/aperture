import type { FastifyPluginAsync, FastifyBaseLogger } from 'fastify'
import { requireAuth, requireAdmin, type SessionUser } from '../../plugins/auth.js'
import { query, queryOne } from '../../lib/db.js'
import {
  getSeerrConfig,
  setSeerrConfig,
  isSeerrConfigured,
  testSeerrConnection,
  getSeerrMediaStatus,
  getSeerrTVDetails,
  batchGetSeerrMediaStatus,
  createSeerrRequest,
  updateSeerrRequestStatus,
  getSeerrRequestStatus,
  createDiscoveryRequest,
  updateDiscoveryRequestStatus,
  getDiscoveryRequests,
  countDiscoveryRequests,
  hasExistingRequest,
  getSystemSetting,
  listAllSeerrUsers,
  resolveSeerrUserMatch,
  seerrUserExists,
  listRadarrServers,
  getRadarrServerDetails,
  listSonarrServers,
  getSonarrServerDetails,
  type DiscoveryRequestStatus,
} from '@aperture/core'
import {
  seerrSchemas,
  getSeerrConfigSchema,
  updateSeerrConfigSchema,
  testSeerrSchema,
  getMediaStatusSchema,
  getTVDetailsSchema,
  createRequestSchema,
  getRequestsSchema,
  batchStatusSchema,
  getRequestStatusSchema,
  listRadarrServiceSchema,
  getRadarrServiceSchema,
  listSonarrServiceSchema,
  getSonarrServiceSchema,
  searchContentSchema,
  decideRequestSchema,
} from './schemas.js'
import { resolveSearchSource } from './sources/index.js'

/**
 * The Seerr user to act as for this Aperture user, or null to act as the API
 * key's own account.
 *
 * Null is always safe: it is exactly the behaviour every request had before
 * `X-API-User` existed. A *wrong* id is not safe, which is why a contested
 * match is refused rather than guessed.
 */
async function ensureSeerrUserIdForRequest(
  userId: string,
  log: FastifyBaseLogger
): Promise<number | null> {
  const row = await queryOne<{
    seerr_user_id: number | null
    email: string | null
    username: string
    display_name: string | null
    provider: 'emby' | 'jellyfin'
    provider_user_id: string
  }>(
    `SELECT seerr_user_id, email, username, display_name, provider, provider_user_id
     FROM users WHERE id = $1`,
    [userId]
  )
  if (!row) return null
  if (row.seerr_user_id != null) return row.seerr_user_id

  const seerrUsers = await listAllSeerrUsers()
  const match = resolveSeerrUserMatch(
    {
      email: row.email,
      username: row.username,
      displayName: row.display_name,
      provider: row.provider,
      providerUserId: row.provider_user_id,
    },
    seerrUsers
  )

  if (match.userId == null) {
    log.warn(
      { userId, ambiguous: match.ambiguous, matchedBy: match.matchedBy },
      match.ambiguous
        ? 'Several Seerr users match this account; requests will be filed by the API key owner'
        : 'No Seerr user matches this account; requests will be filed by the API key owner'
    )
    return null
  }

  try {
    await query(`UPDATE users SET seerr_user_id = $1, updated_at = NOW() WHERE id = $2`, [
      match.userId,
      userId,
    ])
  } catch (err) {
    // idx_users_seerr_user_id_unique (0104). Another Aperture account already
    // claims this Seerr user, so at least one of the two matches is wrong.
    // Acting as a contested identity would file this request under someone
    // else's name; declining to send the header only costs attribution.
    if ((err as { code?: string }).code === '23505') {
      log.warn(
        { userId, seerrUserId: match.userId, matchedBy: match.matchedBy },
        'Seerr user already linked to another Aperture account; not acting as them'
      )
      return null
    }
    throw err
  }

  log.info({ userId, seerrUserId: match.userId, matchedBy: match.matchedBy }, 'Linked Seerr user')
  return match.userId
}

/**
 * Forget a Seerr link that no longer names a live account, so the next
 * request re-resolves instead of failing the same way forever.
 */
async function clearStaleSeerrUserId(userId: string, log: FastifyBaseLogger): Promise<void> {
  await query(`UPDATE users SET seerr_user_id = NULL, updated_at = NOW() WHERE id = $1`, [userId])
  log.warn({ userId }, 'Cleared stale Seerr user link')
}
/**
 * Resolve Aperture library UUIDs for TMDb IDs so available requests can link to /movies/:id or /series/:id.
 */
async function attachLibraryMediaIds<
  T extends { mediaType: 'movie' | 'series'; tmdbId: number },
>(rows: T[]): Promise<(T & { libraryMediaId: string | null })[]> {
  if (rows.length === 0) return []

  const movieTmdbIds = [
    ...new Set(rows.filter((r) => r.mediaType === 'movie').map((r) => String(r.tmdbId))),
  ]
  const seriesTmdbIds = [
    ...new Set(rows.filter((r) => r.mediaType === 'series').map((r) => String(r.tmdbId))),
  ]

  const movieMap = new Map<string, string>()
  const seriesMap = new Map<string, string>()

  if (movieTmdbIds.length > 0) {
    const res = await query<{ id: string; tmdb_id: string }>(
      `SELECT id, tmdb_id FROM movies WHERE tmdb_id = ANY($1::text[])`,
      [movieTmdbIds]
    )
    for (const row of res.rows) {
      movieMap.set(row.tmdb_id, row.id)
    }
  }
  if (seriesTmdbIds.length > 0) {
    const res = await query<{ id: string; tmdb_id: string }>(
      `SELECT id, tmdb_id FROM series WHERE tmdb_id = ANY($1::text[])`,
      [seriesTmdbIds]
    )
    for (const row of res.rows) {
      seriesMap.set(row.tmdb_id, row.id)
    }
  }

  return rows.map((r) => {
    const key = String(r.tmdbId)
    const libraryMediaId =
      r.mediaType === 'movie'
        ? movieMap.get(key) ?? null
        : seriesMap.get(key) ?? null
    return { ...r, libraryMediaId }
  })
}

const seerrRoutes: FastifyPluginAsync = async (fastify) => {
  // Register schemas
  for (const [name, schema] of Object.entries(seerrSchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  /**
   * GET /api/seerr/config
   * Get Seerr configuration (admin only)
   */
  fastify.get(
    '/api/seerr/config',
    { preHandler: requireAdmin, schema: getSeerrConfigSchema },
    async (request, reply) => {
      const config = await getSeerrConfig()
      
      return reply.send({
        configured: config !== null,
        enabled: config?.enabled ?? false,
        url: config?.url ?? '',
        // Don't expose the full API key
        hasApiKey: !!config?.apiKey,
      })
    }
  )

  /**
   * PUT /api/seerr/config
   * Update Seerr configuration (admin only)
   */
  fastify.put<{
    Body: {
      url?: string
      apiKey?: string
      enabled?: boolean
    }
  }>(
    '/api/seerr/config',
    { preHandler: requireAdmin, schema: updateSeerrConfigSchema },
    async (request, reply) => {
      const { url, apiKey, enabled } = request.body

      await setSeerrConfig({
        url,
        apiKey,
        enabled,
      })

      return reply.send({
        message: 'Seerr configuration updated',
        configured: !!(url && apiKey),
        enabled: enabled ?? false,
      })
    }
  )

  /**
   * POST /api/seerr/test
   * Test Seerr connection (admin only)
   */
  fastify.post<{
    Body?: {
      url?: string
      apiKey?: string
    }
  }>(
    '/api/seerr/test',
    { preHandler: requireAdmin, schema: testSeerrSchema },
    async (request, reply) => {
      const { url, apiKey } = request.body || {}

      // If credentials provided, test those. Otherwise test saved config
      const testConfig = url && apiKey
        ? { url, apiKey, enabled: true }
        : undefined

      const result = await testSeerrConnection(testConfig)

      return reply.send(result)
    }
  )

  /**
   * GET /api/seerr/status/:mediaType/:tmdbId
   * Get media status from Seerr
   */
  fastify.get<{
    Params: { mediaType: string; tmdbId: string }
  }>(
    '/api/seerr/status/:mediaType/:tmdbId',
    { preHandler: requireAuth, schema: getMediaStatusSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { mediaType, tmdbId } = request.params

      // Validate media type
      if (mediaType !== 'movie' && mediaType !== 'tv') {
        return reply.status(400).send({ error: 'Invalid media type' })
      }

      // Check if Seerr is configured
      if (!await isSeerrConfigured()) {
        return reply.status(503).send({
          error: 'Seerr not configured',
          message: 'Content requests are not available',
        })
      }

      // Check if user can make requests
      const user = await queryOne<{ discover_request_enabled: boolean }>(
        `SELECT discover_request_enabled FROM users WHERE id = $1`,
        [currentUser.id]
      )

      const canRequest = user?.discover_request_enabled ?? false

      // Get status from Seerr
      const status = await getSeerrMediaStatus(parseInt(tmdbId, 10), mediaType as 'movie' | 'tv')

      if (!status) {
        return reply.send({
          seerrStatus: null,
          canRequest,
        })
      }

      // Check for existing Aperture request
      const existingRequest = await hasExistingRequest(
        currentUser.id,
        parseInt(tmdbId, 10),
        mediaType === 'movie' ? 'movie' : 'series'
      )

      return reply.send({
        seerrStatus: status,
        apertureRequest: existingRequest,
        canRequest,
      })
    }
  )

  /**
   * GET /api/seerr/tv/:tmdbId
   * Get TV show details with season information for the season selection modal
   */
  fastify.get<{
    Params: { tmdbId: string }
  }>(
    '/api/seerr/tv/:tmdbId',
    { preHandler: requireAuth, schema: getTVDetailsSchema },
    async (request, reply) => {
      const { tmdbId } = request.params

      // Check if Seerr is configured
      if (!await isSeerrConfigured()) {
        return reply.status(503).send({
          error: 'Seerr not configured',
          message: 'Content requests are not available',
        })
      }

      // Fetch TV details from Seerr
      const tvDetails = await getSeerrTVDetails(parseInt(tmdbId, 10))

      if (!tvDetails) {
        return reply.status(404).send({
          error: 'TV show not found',
          message: 'Could not fetch TV show details from Seerr',
        })
      }

      return reply.send(tvDetails)
    }
  )

  async function ensureUserCanRequestSeerr(userId: string): Promise<
    | { ok: true }
    | { ok: false; reply: { status: number; body: Record<string, string> } }
  > {
    if (!(await isSeerrConfigured())) {
      return {
        ok: false,
        reply: {
          status: 503,
          body: { error: 'Seerr not configured', message: 'Content requests are not available' },
        },
      }
    }
    const user = await queryOne<{ discover_request_enabled: boolean }>(
      `SELECT discover_request_enabled FROM users WHERE id = $1`,
      [userId]
    )
    if (!user?.discover_request_enabled) {
      return {
        ok: false,
        reply: {
          status: 403,
          body: {
            error: 'Content requests not enabled for your account',
            message: 'Contact your admin to enable content requests',
          },
        },
      }
    }
    return { ok: true }
  }

  /**
   * GET /api/seerr/service/radarr
   * List Radarr servers (for movie request options)
   */
  fastify.get('/api/seerr/service/radarr', { preHandler: requireAuth, schema: listRadarrServiceSchema }, async (request, reply) => {
    const currentUser = request.user as SessionUser
    const gate = await ensureUserCanRequestSeerr(currentUser.id)
    if (!gate.ok) return reply.status(gate.reply.status).send(gate.reply.body)
    const data = await listRadarrServers()
    if (!data) {
      return reply.status(502).send({ error: 'Failed to load Radarr servers from Seerr' })
    }
    return reply.send(data)
  })

  /**
   * GET /api/seerr/service/radarr/:id
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/seerr/service/radarr/:id',
    { preHandler: requireAuth, schema: getRadarrServiceSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const gate = await ensureUserCanRequestSeerr(currentUser.id)
      if (!gate.ok) return reply.status(gate.reply.status).send(gate.reply.body)
      const id = parseInt(request.params.id, 10)
      if (!Number.isFinite(id)) {
        return reply.status(400).send({ error: 'Invalid id' })
      }
      const data = await getRadarrServerDetails(id)
      if (!data) {
        return reply.status(404).send({ error: 'Radarr server not found or Seerr error' })
      }
      return reply.send(data)
    }
  )

  /**
   * GET /api/seerr/service/sonarr
   */
  fastify.get('/api/seerr/service/sonarr', { preHandler: requireAuth, schema: listSonarrServiceSchema }, async (request, reply) => {
    const currentUser = request.user as SessionUser
    const gate = await ensureUserCanRequestSeerr(currentUser.id)
    if (!gate.ok) return reply.status(gate.reply.status).send(gate.reply.body)
    const data = await listSonarrServers()
    if (!data) {
      return reply.status(502).send({ error: 'Failed to load Sonarr servers from Seerr' })
    }
    return reply.send(data)
  })

  /**
   * GET /api/seerr/service/sonarr/:id
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/seerr/service/sonarr/:id',
    { preHandler: requireAuth, schema: getSonarrServiceSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const gate = await ensureUserCanRequestSeerr(currentUser.id)
      if (!gate.ok) return reply.status(gate.reply.status).send(gate.reply.body)
      const id = parseInt(request.params.id, 10)
      if (!Number.isFinite(id)) {
        return reply.status(400).send({ error: 'Invalid id' })
      }
      const data = await getSonarrServerDetails(id)
      if (!data) {
        return reply.status(404).send({ error: 'Sonarr server not found or Seerr error' })
      }
      return reply.send(data)
    }
  )

  /**
   * POST /api/seerr/request
   * Create a content request
   */
  fastify.post<{
    Body: {
      tmdbId: number
      mediaType: 'movie' | 'series'
      title: string
      discoveryCandidateId?: string
      seasons?: number[]
      rootFolder?: string
      profileId?: number
      serverId?: number
      languageProfileId?: number
      is4k?: boolean
    }
  }>(
    '/api/seerr/request',
    { preHandler: requireAuth, schema: createRequestSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const {
        tmdbId,
        mediaType,
        title,
        discoveryCandidateId,
        seasons,
        rootFolder,
        profileId,
        serverId,
        languageProfileId,
        is4k,
      } = request.body

      // Check if Seerr is configured
      if (!await isSeerrConfigured()) {
        return reply.status(503).send({
          error: 'Seerr not configured',
          message: 'Content requests are not available',
        })
      }

      // Check if user can make requests
      const user = await queryOne<{ discover_request_enabled: boolean }>(
        `SELECT discover_request_enabled FROM users WHERE id = $1`,
        [currentUser.id]
      )

      if (!user?.discover_request_enabled) {
        return reply.status(403).send({
          error: 'Content requests not enabled for your account',
          message: 'Contact your admin to enable content requests',
        })
      }

      // Check for existing request
      const existingRequest = await hasExistingRequest(currentUser.id, tmdbId, mediaType)
      if (existingRequest && ['pending', 'submitted', 'approved'].includes(existingRequest.status)) {
        return reply.status(409).send({
          error: 'Request already exists',
          request: existingRequest,
        })
      }

      const requireMapping =
        (await getSystemSetting('seerr_require_user_mapping')) === 'true'
      const seerrUserId = await ensureSeerrUserIdForRequest(currentUser.id, request.log)
      if (requireMapping && seerrUserId == null) {
        return reply.status(422).send({
          error: 'Seerr account not linked',
          message:
            'Your Aperture account could not be matched to a Seerr user. Match your email or username in Seerr to your media server account, or ask an admin to set seerrUserId on your user.',
        })
      }

      // Create Aperture request record
      const apertureRequestId = await createDiscoveryRequest(
        currentUser.id,
        mediaType,
        tmdbId,
        title,
        discoveryCandidateId
      )

      // Submit to Seerr, acting as this user rather than as the API key's
      // owner, so the request carries their name, their quota and their
      // auto-approve setting. Unmapped users fall back to the API key's own
      // identity, which is what happened for everyone before.
      const seerrMediaType = mediaType === 'movie' ? 'movie' : 'tv'
      const requestOptions = {
        seasons,
        ...(rootFolder !== undefined ? { rootFolder } : {}),
        ...(profileId !== undefined ? { profileId } : {}),
        ...(serverId !== undefined ? { serverId } : {}),
        ...(languageProfileId !== undefined ? { languageProfileId } : {}),
        ...(is4k !== undefined ? { is4k } : {}),
      }

      let result = await createSeerrRequest(tmdbId, seerrMediaType, {
        ...requestOptions,
        ...(seerrUserId != null ? { actAsUserId: seerrUserId } : {}),
      })

      // A 403 while acting as someone has two very different causes, and
      // guessing between them is not acceptable in either direction: a stale
      // link left alone strands the user forever behind "You do not have
      // permission to access this endpoint", while retrying blindly would
      // escalate a viewer who genuinely lacks REQUEST into an admin-attributed,
      // auto-approved request. So ask Seerr which one it is.
      if (!result.success && result.status === 403 && seerrUserId != null) {
        if (!(await seerrUserExists(seerrUserId))) {
          await clearStaleSeerrUserId(currentUser.id, request.log)
          result = await createSeerrRequest(tmdbId, seerrMediaType, requestOptions)
        }
      }

      if (!result.success) {
        // Update Aperture request as failed
        await updateDiscoveryRequestStatus(apertureRequestId, 'failed', {
          statusMessage: result.message,
        })

        // A quota or permission refusal is the user's answer, not a server
        // fault — pass Seerr's own status and sentence through, or "Movie
        // Quota exceeded" reaches them as a generic failure they cannot act on.
        const upstream = result.status
        const statusCode = upstream != null && upstream >= 400 && upstream < 500 ? upstream : 502

        return reply.status(statusCode).send({
          error: 'Failed to submit request to Seerr',
          message: result.message,
          apertureRequestId,
        })
      }

      // Update Aperture request with Seerr info
      await updateDiscoveryRequestStatus(apertureRequestId, 'submitted', {
        seerrRequestId: result.requestId,
      })

      return reply.send({
        success: true,
        message: 'Request submitted successfully',
        apertureRequestId,
        seerrRequestId: result.requestId,
      })
    }
  )

  /**
   * GET /api/seerr/requests
   * Get user's content requests
   */
  fastify.get<{
    Querystring: {
      mediaType?: string
      status?: string
      limit?: string
      offset?: string
      source?: string
      scope?: string
    }
  }>(
    '/api/seerr/requests',
    { preHandler: requireAuth, schema: getRequestsSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { mediaType, status, limit, offset, source, scope } = request.query

      // `scope=all` widens the list to every user's requests. Admin only, and
      // silently narrowed rather than refused for a non-admin: the toggle is
      // only rendered for admins, so a non-admin arriving here is a stale tab,
      // and their own list is the right answer for them.
      const wantsAllUsers = scope === 'all' && currentUser.isAdmin
      const scopedUserId = wantsAllUsers ? null : currentUser.id

      const filter = {
        mediaType: mediaType as 'movie' | 'series' | undefined,
        status: status as DiscoveryRequestStatus | undefined,
        source:
          source === 'gap_analysis' || source === 'discovery'
            ? (source as 'discovery' | 'gap_analysis')
            : undefined,
      }

      const pageSizeRaw = limit ? parseInt(limit, 10) : 25
      const pageSize = Number.isFinite(pageSizeRaw)
        ? Math.min(100, Math.max(1, pageSizeRaw))
        : 25
      const offsetRaw = offset ? parseInt(offset, 10) : 0
      const offsetN = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0

      const [total, requests] = await Promise.all([
        countDiscoveryRequests(scopedUserId, filter),
        getDiscoveryRequests(scopedUserId, {
          ...filter,
          limit: pageSize,
          offset: offsetN,
        }),
      ])

      const resultScope = wantsAllUsers ? 'all' : 'mine'

      if (!(await isSeerrConfigured())) {
        const withLibrary = await attachLibraryMediaIds(
          requests.map((r) => ({
            ...r,
            seerrLive: null,
          }))
        )
        return reply.send({ requests: withLibrary, total, scope: resultScope })
      }

      const enriched = await Promise.all(
        requests.map(async (r) => {
          if (!r.seerrRequestId) {
            return { ...r, seerrLive: null }
          }
          const seerrLive = await getSeerrRequestStatus(r.seerrRequestId)
          return { ...r, seerrLive }
        })
      )

      const withLibrary = await attachLibraryMediaIds(enriched)
      return reply.send({ requests: withLibrary, total, scope: resultScope })
    }
  )

  /**
   * GET /api/seerr/search
   * Search for movies, TV shows and people that may not be in the library.
   *
   * The response is Aperture's own shape, never the source's — see
   * `sources/types.ts` for why that boundary is where it is.
   */
  fastify.get<{
    Querystring: { query?: string; page?: string }
  }>(
    '/api/seerr/search',
    { preHandler: requireAuth, schema: searchContentSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const rawQuery = (request.query.query ?? '').trim()

      if (rawQuery.length < 2) {
        return reply.send({
          results: [],
          page: 1,
          totalPages: 0,
          totalResults: 0,
          canRequest: false,
          source: null,
        })
      }

      const pageRaw = request.query.page ? parseInt(request.query.page, 10) : 1
      const page = Number.isFinite(pageRaw) ? Math.min(1000, Math.max(1, pageRaw)) : 1

      const source = await resolveSearchSource()
      if (!source) {
        // Deliberately not an empty result. "Nothing matched" and "search is
        // switched off" render identically in a list and mean opposite
        // things, and only the second is something an operator can fix.
        return reply.status(503).send({
          error: 'Content search unavailable',
          message: 'No search source is configured',
        })
      }

      let found
      try {
        found = await source.search(rawQuery, page)
      } catch (err) {
        request.log.error({ err, source: source.id }, 'Content search failed')
        return reply.status(502).send({
          error: 'Content search failed',
          message: 'The search backend did not respond',
        })
      }

      const user = await queryOne<{ discover_request_enabled: boolean }>(
        `SELECT discover_request_enabled FROM users WHERE id = $1`,
        [currentUser.id]
      )
      const canRequest = user?.discover_request_enabled ?? false

      // Library membership comes from Aperture's own tables, not the search
      // backend's. The two can disagree — a library Seerr does not scan, or a
      // scan that is behind — and when they do, ours is the one that decides
      // whether the user can actually play the thing.
      const requestable = found.results.filter(
        (r): r is typeof r & { mediaType: 'movie' | 'series' } => r.mediaType !== 'person'
      )
      const withLibrary = await attachLibraryMediaIds(requestable)
      const libraryById = new Map(
        withLibrary.map((r) => [`${r.mediaType}-${r.tmdbId}`, r.libraryMediaId])
      )

      return reply.send({
        page: found.page,
        totalPages: found.totalPages,
        totalResults: found.totalResults,
        canRequest,
        source: source.id,
        results: found.results.map((r) => {
          const libraryMediaId =
            r.mediaType === 'person'
              ? null
              : libraryById.get(`${r.mediaType}-${r.tmdbId}`) ?? null
          return { ...r, libraryMediaId, inLibrary: libraryMediaId !== null }
        }),
      })
    }
  )

  /**
   * POST /api/seerr/requests/:id/:decision
   * Approve or decline a request (admin only).
   *
   * Keyed by the Aperture request id rather than the Seerr one, because that
   * is what the table on screen holds, and because the local row has to be
   * updated too — otherwise the list keeps showing the old state until the
   * reconcile job next runs.
   */
  fastify.post<{
    Params: { id: string; decision: string }
  }>(
    '/api/seerr/requests/:id/:decision',
    { preHandler: requireAdmin, schema: decideRequestSchema },
    async (request, reply) => {
      const { id, decision } = request.params

      if (decision !== 'approve' && decision !== 'decline') {
        return reply.status(400).send({ error: 'Invalid decision' })
      }

      if (!(await isSeerrConfigured())) {
        return reply.status(503).send({
          error: 'Seerr not configured',
          message: 'Requests cannot be actioned',
        })
      }

      const row = await queryOne<{ id: string; seerr_request_id: number | null }>(
        `SELECT id, seerr_request_id FROM discovery_requests WHERE id = $1`,
        [id]
      )
      if (!row) {
        return reply.status(404).send({ error: 'Request not found' })
      }
      if (row.seerr_request_id == null) {
        // A row that never reached Seerr has nothing to approve. Saying so
        // beats a 502 from a call that was never going to work; the reconcile
        // job writes these off after a day.
        return reply.status(409).send({
          error: 'Request was never submitted to Seerr',
          message: 'There is nothing to approve or decline yet',
        })
      }

      const result = await updateSeerrRequestStatus(row.seerr_request_id, decision)
      if (!result.success) {
        const upstream = result.status
        const statusCode = upstream != null && upstream >= 400 && upstream < 500 ? upstream : 502
        return reply.status(statusCode).send({
          error: `Failed to ${decision} request`,
          message: result.message,
        })
      }

      const newStatus = decision === 'approve' ? 'approved' : 'declined'
      await updateDiscoveryRequestStatus(id, newStatus)

      return reply.send({ success: true, status: newStatus })
    }
  )

  /**
   * POST /api/seerr/status/batch
   * Check Seerr status for multiple items at once
   */
  fastify.post<{
    Body: {
      items: { tmdbId: number; mediaType: 'movie' | 'series' }[]
    }
  }>(
    '/api/seerr/status/batch',
    { preHandler: requireAuth, schema: batchStatusSchema },
    async (request, reply) => {
      const { items } = request.body

      if (!items || !Array.isArray(items) || items.length === 0) {
        return reply.status(400).send({ error: 'Items array required' })
      }

      // Limit batch size
      if (items.length > 100) {
        return reply.status(400).send({ error: 'Maximum 100 items per batch' })
      }

      // Check if Seerr is configured
      if (!await isSeerrConfigured()) {
        return reply.send({ statuses: {} })
      }

      // Convert to Seerr format
      const seerrItems = items.map(item => ({
        tmdbId: item.tmdbId,
        mediaType: (item.mediaType === 'movie' ? 'movie' : 'tv') as 'movie' | 'tv',
      }))

      const statusMap = await batchGetSeerrMediaStatus(seerrItems)

      // Convert Map to object for JSON response
      const statuses: Record<number, {
        exists: boolean
        status: string
        requested: boolean
        requestStatus?: string
      }> = {}

      for (const [tmdbId, status] of statusMap) {
        statuses[tmdbId] = status
      }

      return reply.send({ statuses })
    }
  )

  /**
   * GET /api/seerr/request/:requestId/status
   * Get status of a specific request
   */
  fastify.get<{
    Params: { requestId: string }
  }>(
    '/api/seerr/request/:requestId/status',
    { preHandler: requireAuth, schema: getRequestStatusSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { requestId } = request.params

      // Get the Aperture request
      const apertureRequest = await queryOne<{
        id: string
        user_id: string
        seerr_request_id: number | null
        status: string
      }>(
        `SELECT id, user_id, seerr_request_id, status 
         FROM discovery_requests 
         WHERE id = $1`,
        [requestId]
      )

      if (!apertureRequest) {
        return reply.status(404).send({ error: 'Request not found' })
      }

      // Check ownership
      if (apertureRequest.user_id !== currentUser.id && !(request.user as SessionUser).isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      // If we have a Seerr request ID, get the latest status
      let seerrStatus = null
      if (apertureRequest.seerr_request_id) {
        seerrStatus = await getSeerrRequestStatus(apertureRequest.seerr_request_id)
        
        // Update Aperture status if Seerr status changed
        if (seerrStatus) {
          let newStatus = apertureRequest.status as DiscoveryRequestStatus
          if (seerrStatus.status === 'approved' && apertureRequest.status !== 'approved') {
            newStatus = 'approved'
          } else if (seerrStatus.status === 'declined' && apertureRequest.status !== 'declined') {
            newStatus = 'declined'
          } else if (seerrStatus.mediaStatus === 'available' && apertureRequest.status !== 'available') {
            newStatus = 'available'
          }
          
          if (newStatus !== apertureRequest.status) {
            await updateDiscoveryRequestStatus(requestId, newStatus)
          }
        }
      }

      return reply.send({
        apertureStatus: apertureRequest.status,
        seerrStatus,
      })
    }
  )
}

export default seerrRoutes
