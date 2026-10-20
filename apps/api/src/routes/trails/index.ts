/**
 * Trails: following library titles one to the next through the people,
 * franchises, companies and uncommon keywords they share. Every answer is
 * limited to the viewer's library scope, and a title out of scope answers
 * exactly like one that does not exist. The work is core's
 * (packages/core/src/trails/); this file only reads the request.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { requireAuth } from '../../plugins/auth.js'
import { viewerScope } from '../../lib/viewerScope.js'
import {
  getTitleThread,
  getTitleThreads,
  getTrail,
  getTrailStart,
  walkFrom,
  parseTitleRef,
  MAX_TRAIL_THREADS,
  MAX_TRAIL_TITLES,
  TRAIL_THREAD_MEMBERS,
  TRAIL_WALK_STEPS,
  type TrailEntityKind,
  type TrailFilter,
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

const KINDS: readonly TrailEntityKind[] = ['person', 'franchise', 'company', 'keyword']

/** Comma-separated entity kinds; unknown ones are dropped, and none means every kind. */
function readKinds(raw: string | undefined): TrailEntityKind[] | null {
  if (!raw) return null
  const kinds = raw.split(',').filter((kind): kind is TrailEntityKind => KINDS.includes(kind as TrailEntityKind))
  return kinds.length > 0 ? [...new Set(kinds)] : null
}

interface FilterQuery {
  /** `1` hides what the viewer has watched. */
  unwatched?: string
  kinds?: string
}

function readFilter(request: FastifyRequest<{ Querystring: FilterQuery }>): TrailFilter {
  return {
    hideWatchedFor: request.query.unwatched === '1' ? request.user?.id : null,
    kinds: readKinds(request.query.kinds),
  }
}

const FILTER_PROPERTIES = {
  unwatched: { type: 'string', enum: ['0', '1'] },
  kinds: { type: 'string' },
} as const

const NOT_FOUND = { error: 'Title not found' }
const BAD_TITLE = { error: 'title must be movie:<id> or series:<id>' }

const trailsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/trails/limits — the numbers the page states and enforces, decided
   * here so the bundle holds no copy of them.
   */
  fastify.get(
    '/api/trails/limits',
    { preHandler: requireAuth, schema: { tags: ['trails'] } },
    async () => ({ maxTrailLength: MAX_TRAIL_TITLES, walkSteps: TRAIL_WALK_STEPS })
  )

  /**
   * GET /api/trails/trail?refs=movie:<id>,series:<id>,… — a trail read back:
   * its titles in scope, in order, and the strongest link between each pair.
   */
  fastify.get<{ Querystring: { refs?: string } }>(
    '/api/trails/trail',
    { preHandler: requireAuth, schema: { tags: ['trails'] } },
    async (request, reply) => {
      const refs = readRefs(request.query.refs, MAX_TRAIL_TITLES)
      if (!refs) {
        return reply
          .status(400)
          .send({ error: `refs must be up to ${MAX_TRAIL_TITLES} movie:<id> or series:<id> values` })
      }
      return getTrail(await viewerScope(request), refs)
    }
  )

  /**
   * GET /api/trails/threads?title=movie:<id>[&limit=3&members=0][&unwatched=1][&kinds=person,franchise]
   * — every thread out of one title, strongest first. `limit` keeps only the
   * strongest few and `members` caps the titles named per thread (0 for none),
   * for a caller that shows a summary; `total` always counts every thread.
   * `unwatched=1` leaves out what the viewer has watched (and threads that
   * then lead nowhere); `kinds` keeps only those kinds of thread.
   */
  fastify.get<{ Querystring: { title?: string; limit?: number; members?: number } & FilterQuery }>(
    '/api/trails/threads',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['trails'],
        querystring: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: MAX_TRAIL_THREADS },
            members: { type: 'integer', minimum: 0, maximum: TRAIL_THREAD_MEMBERS },
            ...FILTER_PROPERTIES,
          },
        },
      },
    },
    async (request, reply) => {
      const ref = parseTitleRef(request.query.title)
      if (!ref) return reply.status(400).send(BAD_TITLE)
      const result = await getTitleThreads(await viewerScope(request), ref, {
        limit: request.query.limit,
        members: request.query.members,
        ...readFilter(request),
      })
      if (!result) return reply.status(404).send(NOT_FOUND)
      return result
    }
  )

  /**
   * GET /api/trails/thread?title=movie:<id>&entity=<key>[&unwatched=1] — one
   * thread out of a title opened in full. `thread` is null when the title does
   * not carry that thing, it links nothing, or everything it leads to is hidden.
   */
  fastify.get<{ Querystring: { title?: string; entity?: string } & FilterQuery }>(
    '/api/trails/thread',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['trails'],
        querystring: {
          type: 'object',
          properties: { title: { type: 'string' }, entity: { type: 'string' }, ...FILTER_PROPERTIES },
        },
      },
    },
    async (request, reply) => {
      const ref = parseTitleRef(request.query.title)
      if (!ref) return reply.status(400).send(BAD_TITLE)
      const entity = request.query.entity?.trim()
      if (!entity) return reply.status(400).send({ error: 'entity is required' })
      const result = await getTitleThread(await viewerScope(request), ref, entity, readFilter(request))
      if (!result) return reply.status(404).send(NOT_FOUND)
      return result
    }
  )

  /** GET /api/trails/start — a random well-connected title to start a trail from. */
  fastify.get('/api/trails/start', { preHandler: requireAuth, schema: { tags: ['trails'] } }, async (request, reply) => {
    const title = await getTrailStart(await viewerScope(request))
    if (!title) return reply.status(404).send({ error: 'No title with enough links to start from' })
    return { title }
  })

  /**
   * GET /api/trails/walk?title=movie:<id>[&visited=…][&kinds=…] — "Take me on
   * a trail": up to `walkSteps` steps from a title, each to a title the viewer
   * has not watched and that is not already on the trail (`visited`).
   */
  fastify.get<{ Querystring: { title?: string; visited?: string; kinds?: string } }>(
    '/api/trails/walk',
    { preHandler: requireAuth, schema: { tags: ['trails'] } },
    async (request, reply) => {
      const ref = parseTitleRef(request.query.title)
      if (!ref) return reply.status(400).send(BAD_TITLE)
      const visited = readRefs(request.query.visited, MAX_TRAIL_TITLES)
      if (!visited) {
        return reply
          .status(400)
          .send({ error: `visited must be up to ${MAX_TRAIL_TITLES} movie:<id> or series:<id> values` })
      }
      const userId = request.user?.id
      if (!userId) return reply.status(401).send({ error: 'Not signed in' })
      const result = await walkFrom(await viewerScope(request), ref, {
        visited,
        userId,
        kinds: readKinds(request.query.kinds),
      })
      if (!result) return reply.status(404).send(NOT_FOUND)
      return result
    }
  )
}

export default trailsRoutes
