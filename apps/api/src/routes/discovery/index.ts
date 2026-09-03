/**
 * Discovery Routes (Missing Content Suggestions)
 * 
 * API routes for suggesting content not in the user's library
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import { requireAuth, requireAdmin, type SessionUser } from '../../plugins/auth.js'
import { queryOne, query } from '../../lib/db.js'
import {
  getDiscoveryCandidates,
  getDiscoveryCandidateCount,
  getLatestDiscoveryRun,
  regenerateUserDiscovery,
  isSeerrConfigured,
  hasDiscoverySources,
  fetchFilteredCandidates,
  scoreCandidates,
  filterCandidates,
  getDiscoveryConfig,
  setDiscoveryConfig,
  DISCOVERY_CONFIG_BOUNDS,
  appLocaleToTmdbLanguage,
  getMovieGenresList,
  getTVGenresList,
  getStreamingDiscoveryEnabled,
  type DiscoveryFilterOptions,
  type DynamicFetchFilters,
  type MediaType,
  type TMDbGenre,
} from '@aperture/core'
import { registerStreamingDiscoveryRoutes } from './streaming.js'
import { registerTmdbGenreRowsRoutes } from './tmdbGenreRows.js'
import {
  discoverySchemas,
  getDiscoveryMoviesSchema,
  getDiscoverySeriesSchema,
  refreshDiscoverySchema,
  expandDiscoverySchema,
  getDiscoveryStatusSchema,
  getDiscoveryPrerequisitesSchema,
  updateDiscoveryConfigSchema,
} from './schemas.js'

// Helper to parse filter query params
function parseFilterParams(queryParams: {
  limit?: string
  offset?: string
  languages?: string
  includeUnknownLanguage?: string
  genres?: string
  yearStart?: string
  yearEnd?: string
  minSimilarity?: string
}): DiscoveryFilterOptions {
  const options: DiscoveryFilterOptions = {
    limit: Math.min(parseInt(queryParams.limit || '50', 10), 100),
    offset: parseInt(queryParams.offset || '0', 10),
  }

  // Languages: comma-separated ISO 639-1 codes (e.g., "en,ko,ja")
  if (queryParams.languages) {
    options.languages = queryParams.languages.split(',').map(l => l.trim()).filter(Boolean)
  }

  // Include content with unknown language (default: true)
  // Only set to false if explicitly passed as 'false' or '0'
  if (queryParams.includeUnknownLanguage !== undefined) {
    options.includeUnknownLanguage = queryParams.includeUnknownLanguage !== 'false' && queryParams.includeUnknownLanguage !== '0'
  }

  // Genres: comma-separated genre IDs (e.g., "28,12,878")
  if (queryParams.genres) {
    options.genreIds = queryParams.genres.split(',').map(g => parseInt(g.trim(), 10)).filter(id => !isNaN(id))
  }

  // Year range
  if (queryParams.yearStart) {
    const year = parseInt(queryParams.yearStart, 10)
    if (!isNaN(year)) options.yearStart = year
  }
  if (queryParams.yearEnd) {
    const year = parseInt(queryParams.yearEnd, 10)
    if (!isNaN(year)) options.yearEnd = year
  }

  // Minimum similarity threshold (0-1)
  if (queryParams.minSimilarity) {
    const sim = parseFloat(queryParams.minSimilarity)
    if (!isNaN(sim) && sim >= 0 && sim <= 1) options.minSimilarity = sim
  }

  return options
}

/**
 * Users with a refresh in flight, keyed `${userId}:${mediaType}`.
 *
 * The regenerate path runs the pipeline inside the request, so without this a
 * user clicking Refresh twice starts two full pipelines against the same rows --
 * and since storeDiscoveryCandidates deletes the user's existing candidates
 * before inserting, the two runs race over the same delete/insert window.
 * In-memory is the right scope: it guards one API process against one user's
 * double-click, which is the case that actually happens.
 */
const refreshInFlight = new Set<string>()

/**
 * Start a per-user regeneration in the background and answer immediately.
 *
 * The pipeline used to run inside the request: a cold run is a few hundred TMDb
 * calls and a full candidate rewrite, which meant minutes with no progress, no
 * way to leave the page, and a real chance of dying on a reverse-proxy timeout
 * after the previous candidates had already been replaced.
 *
 * There is no new job type behind this, deliberately. The pipeline already
 * records a `discovery_runs` row and moves it from 'running' to 'completed' or
 * 'failed', and the page already polls `GET /api/discovery/status`, which
 * returns that row. So the progress signal exists — it just was not being used.
 *
 * The work is intentionally not awaited. `refreshInFlight` is released in the
 * background promise's `finally`, not the handler's, or the guard would clear
 * the moment the response was sent and a second click would start a second run.
 */
function startRefresh(
  fastify: FastifyInstance,
  userId: string,
  mediaType: MediaType,
  reply: FastifyReply
) {
  const refreshKey = `${userId}:${mediaType}`
  if (refreshInFlight.has(refreshKey)) {
    return reply.status(409).send({
      error: 'A discovery refresh is already running for your account',
      mediaType,
    })
  }
  refreshInFlight.add(refreshKey)

  void regenerateUserDiscovery(userId, mediaType)
    .then((result) => {
      fastify.log.info(
        { userId, mediaType, runId: result.runId, stored: result.candidatesStored },
        'Discovery refresh complete'
      )
    })
    .catch((err) => {
      // Already recorded on the run row as status='failed' by the pipeline, so
      // the page learns about it from the status poll. This is for the operator.
      fastify.log.error({ err, userId, mediaType }, 'Discovery refresh failed')
    })
    .finally(() => {
      refreshInFlight.delete(refreshKey)
    })

  return reply.status(202).send({
    message: 'Discovery refresh started',
    mediaType,
    started: true,
  })
}

const discoveryRoutes: FastifyPluginAsync = async (fastify) => {
  registerStreamingDiscoveryRoutes(fastify)
  registerTmdbGenreRowsRoutes(fastify)

  // Register schemas
  for (const [name, schema] of Object.entries(discoverySchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  /**
   * GET /api/discovery/genres
   * TMDb genre labels for filters and UI (localized via `locale` → TMDb `language`).
   */
  fastify.get<{
    Querystring: { mediaType?: string; locale?: string }
  }>(
    '/api/discovery/genres',
    { preHandler: requireAuth, schema: { tags: ['discovery'] } },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const user = await queryOne<{ discover_enabled: boolean }>(
        `SELECT discover_enabled FROM users WHERE id = $1`,
        [currentUser.id]
      )
      if (!user?.discover_enabled) {
        return reply.status(403).send({
          error: 'Discovery not enabled for your account',
          message: 'Contact your admin to enable discovery suggestions',
        })
      }

      const rawType = (request.query.mediaType || 'movie').toLowerCase()
      const mediaType = rawType === 'series' || rawType === 'tv' ? 'series' : 'movie'
      const language = appLocaleToTmdbLanguage(request.query.locale)

      const genres =
        mediaType === 'movie'
          ? await getMovieGenresList({ language })
          : await getTVGenresList({ language })

      return reply.send({
        mediaType,
        language,
        genres: genres.map((g: TMDbGenre) => ({ id: g.id, name: g.name })),
      })
    }
  )

  /**
   * GET /api/discovery/movies
   * Get discovery suggestions for movies not in the library
   */
  fastify.get<{
    Querystring: {
      limit?: string
      offset?: string
      languages?: string
      includeUnknownLanguage?: string
      genres?: string
      yearStart?: string
      yearEnd?: string
      minSimilarity?: string
    }
  }>(
    '/api/discovery/movies',
    { preHandler: requireAuth, schema: getDiscoveryMoviesSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const filterOptions = parseFilterParams(request.query)

      // Check if user has discovery enabled
      const user = await queryOne<{ discover_enabled: boolean }>(
        `SELECT discover_enabled FROM users WHERE id = $1`,
        [currentUser.id]
      )

      if (!user?.discover_enabled) {
        return reply.status(403).send({
          error: 'Discovery not enabled for your account',
          message: 'Contact your admin to enable discovery suggestions',
        })
      }

      // Get latest run
      const run = await getLatestDiscoveryRun(currentUser.id, 'movie')

      // Get candidates with filters
      const candidates = await getDiscoveryCandidates(currentUser.id, 'movie', filterOptions)
      const total = await getDiscoveryCandidateCount(currentUser.id, 'movie', filterOptions)

      return reply.send({
        run,
        candidates,
        pagination: {
          total,
          limit: filterOptions.limit!,
          offset: filterOptions.offset!,
          hasMore: filterOptions.offset! + candidates.length < total,
        },
      })
    }
  )

  /**
   * GET /api/discovery/series
   * Get discovery suggestions for series not in the library
   */
  fastify.get<{
    Querystring: {
      limit?: string
      offset?: string
      languages?: string
      includeUnknownLanguage?: string
      genres?: string
      yearStart?: string
      yearEnd?: string
      minSimilarity?: string
    }
  }>(
    '/api/discovery/series',
    { preHandler: requireAuth, schema: getDiscoverySeriesSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const filterOptions = parseFilterParams(request.query)

      // Check if user has discovery enabled
      const user = await queryOne<{ discover_enabled: boolean }>(
        `SELECT discover_enabled FROM users WHERE id = $1`,
        [currentUser.id]
      )

      if (!user?.discover_enabled) {
        return reply.status(403).send({
          error: 'Discovery not enabled for your account',
          message: 'Contact your admin to enable discovery suggestions',
        })
      }

      // Get latest run
      const run = await getLatestDiscoveryRun(currentUser.id, 'series')

      // Get candidates with filters
      const candidates = await getDiscoveryCandidates(currentUser.id, 'series', filterOptions)
      const total = await getDiscoveryCandidateCount(currentUser.id, 'series', filterOptions)

      return reply.send({
        run,
        candidates,
        pagination: {
          total,
          limit: filterOptions.limit!,
          offset: filterOptions.offset!,
          hasMore: filterOptions.offset! + candidates.length < total,
        },
      })
    }
  )

  /**
   * POST /api/discovery/refresh/movies
   * Trigger regeneration of movie discovery suggestions
   */
  fastify.post(
    '/api/discovery/refresh/movies',
    { preHandler: requireAuth, schema: refreshDiscoverySchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser

      // Check if user has discovery enabled
      const user = await queryOne<{ discover_enabled: boolean }>(
        `SELECT discover_enabled FROM users WHERE id = $1`,
        [currentUser.id]
      )

      if (!user?.discover_enabled) {
        return reply.status(403).send({
          error: 'Discovery not enabled for your account',
        })
      }

      return startRefresh(fastify, currentUser.id, 'movie', reply)
    }
  )

  /**
   * POST /api/discovery/refresh/series
   * Trigger regeneration of series discovery suggestions
   */
  fastify.post(
    '/api/discovery/refresh/series',
    { preHandler: requireAuth, schema: refreshDiscoverySchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser

      // Check if user has discovery enabled
      const user = await queryOne<{ discover_enabled: boolean }>(
        `SELECT discover_enabled FROM users WHERE id = $1`,
        [currentUser.id]
      )

      if (!user?.discover_enabled) {
        return reply.status(403).send({
          error: 'Discovery not enabled for your account',
        })
      }

      return startRefresh(fastify, currentUser.id, 'series', reply)
    }
  )

  /**
   * POST /api/discovery/:mediaType/expand
   * Dynamically fetch additional candidates when filters reduce results below target
   */
  fastify.post<{
    Params: { mediaType: string }
    Body: {
      languages?: string[]
      genreIds?: number[]
      yearStart?: number
      yearEnd?: number
      excludeTmdbIds?: number[]
      targetCount?: number
    }
  }>(
    '/api/discovery/:mediaType/expand',
    { preHandler: requireAuth, schema: expandDiscoverySchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { mediaType } = request.params
      const { languages, genreIds, yearStart, yearEnd, excludeTmdbIds, targetCount } = request.body

      // Validate media type
      if (mediaType !== 'movies' && mediaType !== 'series') {
        return reply.status(400).send({ error: 'Invalid media type' })
      }

      // Convert route mediaType to core MediaType
      const coreMediaType: MediaType = mediaType === 'movies' ? 'movie' : 'series'

      // Check if user has discovery enabled
      const userSettings = await queryOne<{ discover_enabled: boolean }>(
        `SELECT discover_enabled FROM users WHERE id = $1`,
        [currentUser.id]
      )

      if (!userSettings?.discover_enabled) {
        return reply.status(403).send({ error: 'Discovery not enabled for your account' })
      }

      try {
        // The stored configuration, so expanded rows are fetched and scored on
        // the same terms as the list they get merged into.
        const config = await getDiscoveryConfig()

        // Build filter options for dynamic fetching
        const filters: DynamicFetchFilters = {
          languages,
          genreIds,
          yearStart,
          yearEnd,
          excludeTmdbIds: excludeTmdbIds || [],
          limit: targetCount || config.targetDisplayCount,
          minVoteCount: config.minVoteCount,
          minVoteAverage: config.minVoteAverage,
        }

        // Fetch filtered candidates from TMDb
        const rawCandidates = await fetchFilteredCandidates(coreMediaType, filters)

        if (rawCandidates.length === 0) {
          return reply.send({
            candidates: [],
            message: 'No additional candidates found matching filters',
          })
        }

        // Filter out library and watched content
        const filteredCandidates = await filterCandidates(currentUser.id, coreMediaType, rawCandidates)

        if (filteredCandidates.length === 0) {
          return reply.send({
            candidates: [],
            message: 'All found candidates are already in library or watched',
          })
        }

        // Score the candidates (quick scoring without embeddings)
        const scoredCandidates = await scoreCandidates(
          currentUser.id,
          coreMediaType,
          filteredCandidates,
          config
        )

        // Return the scored candidates (frontend will merge with existing)
        return reply.send({
          candidates: scoredCandidates.map((c, index) => ({
            id: `dynamic-${c.tmdbId}`,
            runId: null,
            userId: currentUser.id,
            mediaType: coreMediaType,
            tmdbId: c.tmdbId,
            imdbId: c.imdbId,
            rank: index + 1,
            finalScore: c.finalScore,
            similarityScore: c.similarityScore,
            popularityScore: c.popularityScore,
            recencyScore: c.recencyScore,
            sourceScore: c.sourceScore,
            source: c.source,
            sourceMediaId: c.sourceMediaId ?? null,
            title: c.title,
            originalTitle: c.originalTitle,
            originalLanguage: c.originalLanguage,
            releaseYear: c.releaseYear,
            posterPath: c.posterPath,
            backdropPath: c.backdropPath,
            overview: c.overview,
            genres: c.genres,
            voteAverage: c.voteAverage,
            voteCount: c.voteCount,
            scoreBreakdown: c.scoreBreakdown,
            castMembers: c.castMembers || [],
            directors: c.directors || [],
            runtimeMinutes: c.runtimeMinutes ?? null,
            tagline: c.tagline ?? null,
            isEnriched: false,
            isDynamic: true, // Flag to indicate dynamically fetched
            createdAt: new Date(),
          })),
          count: scoredCandidates.length,
        })
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        fastify.log.error({ err, userId: currentUser.id, mediaType }, 'Failed to expand discovery')
        return reply.status(500).send({ error: `Failed to expand: ${error}` })
      }
    }
  )

  /**
   * GET /api/discovery/status
   * Get discovery status for the current user
   */
  fastify.get(
    '/api/discovery/status',
    { preHandler: requireAuth, schema: getDiscoveryStatusSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser

      // Get user's discovery settings
      const userSettings = await queryOne<{
        discover_enabled: boolean
        discover_request_enabled: boolean
      }>(
        `SELECT discover_enabled, discover_request_enabled FROM users WHERE id = $1`,
        [currentUser.id]
      )

      if (!userSettings?.discover_enabled) {
        return reply.send({
          enabled: false,
          requestEnabled: false,
          streamingDiscoveryEnabled: false,
          movieRun: null,
          seriesRun: null,
          movieCount: 0,
          seriesCount: 0,
        })
      }

      // Get latest runs
      const [movieRun, seriesRun, movieCount, seriesCount, streamingDiscoveryEnabled] = await Promise.all([
        getLatestDiscoveryRun(currentUser.id, 'movie'),
        getLatestDiscoveryRun(currentUser.id, 'series'),
        getDiscoveryCandidateCount(currentUser.id, 'movie'),
        getDiscoveryCandidateCount(currentUser.id, 'series'),
        getStreamingDiscoveryEnabled(),
      ])

      return reply.send({
        enabled: true,
        requestEnabled: userSettings.discover_request_enabled,
        streamingDiscoveryEnabled,
        movieRun,
        seriesRun,
        movieCount,
        seriesCount,
      })
    }
  )

  /**
   * GET /api/discovery/config
   * The active discovery tuning (admin only).
   *
   * Returns the bounds alongside the values so the settings card can enforce
   * the same limits the server does without the web bundle importing core.
   */
  fastify.get(
    '/api/discovery/config',
    { preHandler: requireAdmin, schema: { tags: ['discovery'] } },
    async (_request, reply) => {
      const config = await getDiscoveryConfig()
      return reply.send({ config, bounds: DISCOVERY_CONFIG_BOUNDS })
    }
  )

  /**
   * PATCH /api/discovery/config
   * Update discovery tuning (admin only).
   *
   * Body is a partial: an omitted field keeps its stored value. The response
   * carries what was actually stored after sanitising, so a clamped value shows
   * up in the UI immediately rather than on the next load.
   */
  fastify.patch<{ Body: Record<string, unknown> }>(
    '/api/discovery/config',
    { preHandler: requireAdmin, schema: updateDiscoveryConfigSchema },
    async (request, reply) => {
      const current = await getDiscoveryConfig()
      const merged = { ...current, ...(request.body ?? {}) }
      const config = await setDiscoveryConfig(merged)
      return reply.send({ config, bounds: DISCOVERY_CONFIG_BOUNDS })
    }
  )

  /**
   * GET /api/discovery/prerequisites
   * Check if discovery feature prerequisites are met (admin only)
   */
  fastify.get(
    '/api/discovery/prerequisites',
    { preHandler: requireAdmin, schema: getDiscoveryPrerequisitesSchema },
    async (_request, reply) => {
      // Check Seerr configuration, and whether anything can be fetched at all.
      // sourcesAvailable goes through hasDiscoverySources rather than being
      // re-derived here: that helper existed but returned a hardcoded true, so
      // this panel could report "ready" on an instance with no TMDb key, where
      // every run produces nothing.
      const [seerrConfigured, sourcesAvailable] = await Promise.all([
        isSeerrConfigured(),
        hasDiscoverySources(),
      ])

      // Check how many users have discovery enabled
      const usersResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM users WHERE discover_enabled = true`
      )
      const enabledUserCount = parseInt(usersResult.rows[0]?.count || '0', 10)

      // Get list of enabled users for display
      const enabledUsers = await query<{ username: string }>(
        `SELECT username FROM users WHERE discover_enabled = true ORDER BY username LIMIT 10`
      )

      const ready = seerrConfigured && sourcesAvailable && enabledUserCount > 0

      return reply.send({
        ready,
        seerrConfigured,
        sourcesAvailable,
        enabledUserCount,
        enabledUsernames: enabledUsers.rows.map(u => u.username),
        message: !ready
          ? !sourcesAvailable
            ? 'TMDb is not configured. Discovery cannot fetch candidates without it. Configure it in Settings → Integrations.'
            : !seerrConfigured
              ? 'Seerr integration is not configured. Configure it in Settings → Integrations.'
              : 'No users have discovery enabled. Enable discovery for users in Admin → Users.'
          : null,
      })
    }
  )
}

export default discoveryRoutes
