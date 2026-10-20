/**
 * Trails: how library titles are linked through the people, franchises,
 * companies and uncommon keywords they share. Every answer is limited to the
 * viewer's library scope, and a title out of scope answers exactly like one
 * that does not exist. The work is core's (packages/core/src/trails/);
 * this file only reads the request.
 */

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../plugins/auth.js'
import { viewerScope } from '../../lib/viewerScope.js'
import {
  findTrails,
  getCommonGround,
  getTrailTitles,
  getTitleThreads,
  parseTitleRef,
  surpriseTrail,
  MAX_COMMON_TITLES,
  MAX_TRAIL_STEPS,
  type TrailTitleRef,
} from '@aperture/core'

/** Comma-separated title refs; null when any one is malformed or there are too many. */
function readRefs(raw: string | undefined, max: number): TrailTitleRef[] | null {
  if (!raw) return []
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length > max) return null
  const refs: TrailTitleRef[] = []
  for (const part of parts) {
    const ref = parseTitleRef(part)
    if (!ref) return null
    refs.push(ref)
  }
  return refs
}

const NOT_FOUND = { error: 'Title not found' }

/** Title cards per lookup: more than one page can hold at once (a trail, a comparison and a pair). */
const MAX_TITLE_LOOKUP = 40

const trailsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/trails/limits — the numbers the page states and enforces, decided
   * here so the bundle holds no copy of them.
   */
  fastify.get(
    '/api/trails/limits',
    { preHandler: requireAuth, schema: { tags: ['trails'] } },
    async () => ({ maxCommonTitles: MAX_COMMON_TITLES, maxSteps: MAX_TRAIL_STEPS, maxTitleLookup: MAX_TITLE_LOOKUP })
  )

  /** GET /api/trails/titles?refs=movie:<id>,series:<id> — title cards, in scope only. */
  fastify.get<{ Querystring: { refs?: string } }>(
    '/api/trails/titles',
    { preHandler: requireAuth, schema: { tags: ['trails'] } },
    async (request, reply) => {
      const refs = readRefs(request.query.refs, MAX_TITLE_LOOKUP)
      if (!refs) return reply.status(400).send({ error: `refs must be up to ${MAX_TITLE_LOOKUP} movie:<id> or series:<id> values` })
      return { titles: await getTrailTitles(await viewerScope(request), refs) }
    }
  )

  /** GET /api/trails/path?from=movie:<id>&to=series:<id> — up to three routes. */
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/trails/path',
    { preHandler: requireAuth, schema: { tags: ['trails'] } },
    async (request, reply) => {
      const from = parseTitleRef(request.query.from)
      const to = parseTitleRef(request.query.to)
      if (!from || !to) return reply.status(400).send({ error: 'from and to must be movie:<id> or series:<id>' })
      const result = await findTrails(await viewerScope(request), from, to)
      if (result.status === 'notFound') return reply.status(404).send(NOT_FOUND)
      return result
    }
  )

  /** GET /api/trails/surprise — two well-connected titles a few steps apart. */
  fastify.get(
    '/api/trails/surprise',
    { preHandler: requireAuth, schema: { tags: ['trails'] } },
    async (request) => surpriseTrail(await viewerScope(request))
  )

  /** GET /api/trails/threads?title=movie:<id> — every thread out of one title. */
  fastify.get<{ Querystring: { title?: string } }>(
    '/api/trails/threads',
    { preHandler: requireAuth, schema: { tags: ['trails'] } },
    async (request, reply) => {
      const ref = parseTitleRef(request.query.title)
      if (!ref) return reply.status(400).send({ error: 'title must be movie:<id> or series:<id>' })
      const result = await getTitleThreads(await viewerScope(request), ref)
      if (!result) return reply.status(404).send(NOT_FOUND)
      return result
    }
  )

  /** GET /api/trails/common?titles=movie:<id>,… — what two to eight titles share. */
  fastify.get<{ Querystring: { titles?: string } }>(
    '/api/trails/common',
    { preHandler: requireAuth, schema: { tags: ['trails'] } },
    async (request, reply) => {
      const refs = readRefs(request.query.titles, MAX_COMMON_TITLES)
      if (!refs || refs.length < 2) {
        return reply
          .status(400)
          .send({ error: `titles must be 2 to ${MAX_COMMON_TITLES} movie:<id> or series:<id> values` })
      }
      return getCommonGround(await viewerScope(request), refs)
    }
  )
}

export default trailsRoutes
