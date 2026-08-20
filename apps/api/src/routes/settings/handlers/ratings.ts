/**
 * Ratings Refresh Settings Handlers
 *
 * Endpoints:
 * - GET /api/settings/ratings - Which sources are enabled, plus live coverage
 * - PUT /api/settings/ratings - Enable or disable a source
 *
 * The coverage figures are the point of the GET, not decoration. MDBList
 * enrichment on this instance had reached 88 of 12,589 rows and nothing
 * anywhere said so — the columns it fills simply read empty and the feature
 * looked absent rather than stalled. A source row that shows how many titles it
 * has actually touched is what turns that into something an operator can see
 * without opening psql.
 */
import type { FastifyInstance } from 'fastify'
import {
  RATING_SOURCE_IDS,
  getRatingsRefreshConfig,
  setRatingsRefreshConfig,
  isRatingSourceId,
  type RatingsRefreshConfig,
} from '@aperture/core'
import { query } from '../../../lib/db.js'
import { requireAdmin } from '../../../plugins/auth.js'

interface RatingsCoverage {
  /** Titles carrying an IMDb id — the set the dataset pass can look up at all. */
  withImdbId: number
  /** Titles the refresh has consulted the dataset for, answered or not. */
  refreshed: number
  /** Titles that have a stored IMDb rating from any source. */
  rated: number
  /** Most recent consultation, or null if the job has never run. */
  lastRefreshedAt: string | null
}

async function loadCoverage(): Promise<RatingsCoverage> {
  // One query over both tables. COUNT ignores NULLs, which is exactly the
  // question being asked of each column.
  const result = await query<{
    with_imdb_id: string
    refreshed: string
    rated: string
    last_refreshed_at: string | null
  }>(
    `SELECT
       count(imdb_id) AS with_imdb_id,
       count(imdb_ratings_refreshed_at) AS refreshed,
       count(imdb_rating) AS rated,
       max(imdb_ratings_refreshed_at) AS last_refreshed_at
     FROM (
       SELECT imdb_id, imdb_ratings_refreshed_at, imdb_rating FROM movies
       UNION ALL
       SELECT imdb_id, imdb_ratings_refreshed_at, imdb_rating FROM series
     ) AS t`
  )
  const row = result.rows[0]
  return {
    // pg returns count() as a string; Number() here is safe because count is
    // never NULL, unlike the NUMERIC columns elsewhere in this codebase.
    withImdbId: Number(row?.with_imdb_id ?? 0),
    refreshed: Number(row?.refreshed ?? 0),
    rated: Number(row?.rated ?? 0),
    lastRefreshedAt: row?.last_refreshed_at ?? null,
  }
}

export function registerRatingsHandlers(fastify: FastifyInstance) {
  fastify.get(
    '/api/settings/ratings',
    {
      preHandler: requireAdmin,
      schema: {
        tags: ['Settings'],
        summary: 'Get ratings refresh configuration and coverage',
      },
    },
    async (_request, reply) => {
      try {
        const [config, coverage] = await Promise.all([
          getRatingsRefreshConfig(),
          loadCoverage(),
        ])
        return reply.send({ config, coverage, sources: RATING_SOURCE_IDS })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to load ratings refresh settings')
        return reply.status(500).send({ error: 'Failed to load ratings refresh settings' })
      }
    }
  )

  fastify.put(
    '/api/settings/ratings',
    {
      preHandler: requireAdmin,
      schema: {
        tags: ['Settings'],
        summary: 'Enable or disable rating refresh sources',
        body: {
          type: 'object',
          // Derived from the shared list rather than written out, so adding a
          // source cannot leave the route rejecting it — the failure mode that
          // made `titleAnalysis` unconfigurable across ten hand-copied enums.
          properties: Object.fromEntries(
            RATING_SOURCE_IDS.map((id) => [id, { type: 'boolean' }])
          ),
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const body = (request.body ?? {}) as Record<string, unknown>
        const current = await getRatingsRefreshConfig()
        // An omitted source means "leave it alone", matching every other
        // settings PUT here; only an explicit false turns one off.
        const next = { ...current } as RatingsRefreshConfig
        for (const [key, value] of Object.entries(body)) {
          if (isRatingSourceId(key) && typeof value === 'boolean') {
            next[key] = value
          }
        }

        await setRatingsRefreshConfig(next)
        const coverage = await loadCoverage()
        return reply.send({ success: true, config: next, coverage })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update ratings refresh settings')
        return reply.status(500).send({ error: 'Failed to update ratings refresh settings' })
      }
    }
  )
}
