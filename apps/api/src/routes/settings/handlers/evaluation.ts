import type { FastifyInstance } from 'fastify'
import {
  getEvaluationSeedTitles,
  setEvaluationSeedTitles,
  suggestSeedTitles,
  resolveSeedIds,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

/**
 * Seed titles for the recommender evaluation's neighbour dump.
 *
 * These were editable only by hand-writing a row into `system_settings`, which
 * is a poor home for the one input that decides whether the primary instrument
 * can answer anything: its default is the most-watched titles, and those are
 * exactly where two embedding spaces agree.
 *
 * Every response carries the RESOLUTION, not just the strings. The matcher is a
 * prefix match returning one row, so "The Three Musketeers" silently picks the
 * earliest of four — and a seed that resolves to the wrong film is worse than
 * one that misses, because a miss is at least reported by the run. The preview
 * calls the same `resolveSeedIds` the run does, so it cannot promise a
 * different film from the one that will actually be used.
 */
export function registerEvaluationHandlers(fastify: FastifyInstance) {
  type MediaType = 'movie' | 'series'

  const asMediaType = (value: unknown): MediaType =>
    value === 'series' ? 'series' : 'movie'

  async function describe(mediaType: MediaType, titles: string[]) {
    const resolved = await resolveSeedIds(mediaType, titles)
    return resolved.map((entry) => ({
      input: entry.input,
      // A decided boolean rather than making the client test for a null id:
      // the web bundle never imports core, and "did this resolve" is a rule
      // that belongs on this side of the wire.
      resolved: entry.id != null,
      matchedTitle: entry.title ?? null,
      matchedYear: entry.year ?? null,
    }))
  }

  fastify.get<{ Querystring: { mediaType?: string } }>(
    '/api/settings/evaluation',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const mediaType = asMediaType(request.query.mediaType)
      const seedTitles = await getEvaluationSeedTitles()
      return reply.send({
        seedTitles,
        seeds: await describe(mediaType, seedTitles),
        // With none set the run falls back to the most-watched titles, which is
        // a real choice with a real consequence and must not look like an
        // empty, inert field.
        usingDefaults: seedTitles.length === 0,
      })
    }
  )

  fastify.put<{
    Body: { seedTitles?: string[]; mediaType?: string }
  }>(
    '/api/settings/evaluation',
    {
      preHandler: requireAdmin,
      schema: {
        body: {
          type: 'object',
          properties: {
            seedTitles: { type: 'array', items: { type: 'string' } },
            mediaType: { type: 'string', enum: ['movie', 'series'] },
          },
        },
      },
    },
    async (request, reply) => {
      const mediaType = asMediaType(request.body?.mediaType)
      // An empty array is a deliberate "go back to the default seeds", not a
      // missing field, so it is stored rather than ignored.
      const stored = await setEvaluationSeedTitles(request.body?.seedTitles ?? [])
      return reply.send({
        seedTitles: stored,
        seeds: await describe(mediaType, stored),
        usingDefaults: stored.length === 0,
      })
    }
  )

  /** Resolve a list WITHOUT saving it, so the admin can check before committing. */
  fastify.post<{
    Body: { seedTitles?: string[]; mediaType?: string }
  }>(
    '/api/settings/evaluation/preview',
    {
      preHandler: requireAdmin,
      schema: {
        body: {
          type: 'object',
          properties: {
            seedTitles: { type: 'array', items: { type: 'string' } },
            mediaType: { type: 'string', enum: ['movie', 'series'] },
          },
        },
      },
    },
    async (request, reply) => {
      const mediaType = asMediaType(request.body?.mediaType)
      return reply.send({ seeds: await describe(mediaType, request.body?.seedTitles ?? []) })
    }
  )

  fastify.get<{ Querystring: { mediaType?: string; limit?: number } }>(
    '/api/settings/evaluation/suggestions',
    {
      preHandler: requireAdmin,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            mediaType: { type: 'string', enum: ['movie', 'series'] },
            // Declared so Fastify coerces it; a string here would reach the
            // query as a string and LIMIT would reject it.
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const mediaType = asMediaType(request.query.mediaType)
      return reply.send({
        suggestions: await suggestSeedTitles(mediaType, request.query.limit ?? 20),
      })
    }
  )
}
