/**
 * Next from here: what to watch after a title, with reasons. Every answer is
 * limited to the viewer's library scope, and a title out of scope answers
 * exactly like one that does not exist. The work is core's
 * (packages/core/src/nextFromHere/, reading the credits index in
 * packages/core/src/trails/); this file only reads the request.
 */

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../plugins/auth.js'
import { viewerScope } from '../../lib/viewerScope.js'
import {
  getNextFromHere,
  getNextSummary,
  getTrail,
  getTrailStart,
  walkNext,
  parseTitleRef,
  MAX_TRAIL_TITLES,
  NEXT_MAX_AVOID,
  NEXT_WALK_STEPS,
  type TrailTitleRef,
} from '@aperture/core'

const NOT_FOUND = { error: 'Title not found' }
const BAD_TITLE = { error: 'title must be movie:<id> or series:<id>' }

/** The trail's earlier steps; a malformed ref is ignored and the list is capped. */
function readAvoid(raw: string | undefined): TrailTitleRef[] {
  return (raw ?? '')
    .split(',')
    .slice(0, NEXT_MAX_AVOID)
    .map((part) => parseTitleRef(part.trim()))
    .filter((step): step is TrailTitleRef => step != null)
}

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

const TITLE_QUERY = {
  type: 'object',
  properties: { title: { type: 'string' }, avoid: { type: 'string' } },
} as const

const nextFromHereRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/next-from-here[?title=movie:<id>][&avoid=<ref>,<ref>] — titles
   * close in feel to the start, each with the reasons it is there; the people
   * behind it and what else of theirs is in the library; its themes, studios
   * and networks as rows of their own; the map's titles and lines; and recent
   * titles to start from instead. With no `title`, the start is the viewer's
   * most recent title they finished and did not dislike (`start` is null when
   * there is none). `avoid` is the earlier steps of the viewer's trail, never
   * suggested again; a malformed ref in it is ignored.
   */
  fastify.get<{ Querystring: { title?: string; avoid?: string } }>(
    '/api/next-from-here',
    { preHandler: requireAuth, schema: { tags: ['next-from-here'], querystring: TITLE_QUERY } },
    async (request, reply) => {
      const userId = request.user?.id
      if (!userId) return reply.status(401).send({ error: 'Not signed in' })
      let ref = null
      if (request.query.title) {
        ref = parseTitleRef(request.query.title)
        if (!ref) return reply.status(400).send(BAD_TITLE)
      }
      const result = await getNextFromHere(await viewerScope(request), userId, ref, readAvoid(request.query.avoid))
      if (!result) return reply.status(404).send(NOT_FOUND)
      return result
    }
  )

  /**
   * GET /api/next-from-here/summary?title=movie:<id> — the few best
   * suggestions after one title, for the card on its own page.
   */
  fastify.get<{ Querystring: { title?: string } }>(
    '/api/next-from-here/summary',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['next-from-here'],
        querystring: { type: 'object', properties: { title: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const userId = request.user?.id
      if (!userId) return reply.status(401).send({ error: 'Not signed in' })
      const ref = parseTitleRef(request.query.title)
      if (!ref) return reply.status(400).send(BAD_TITLE)
      const result = await getNextSummary(await viewerScope(request), userId, ref)
      if (!result) return reply.status(404).send(NOT_FOUND)
      return result
    }
  )

  /**
   * GET /api/next-from-here/walk?title=movie:<id>[&avoid=…] — "Take me
   * somewhere": up to `walkSteps` steps from a title, each to the best
   * suggestion from the step before, never to a title the viewer has seen or
   * one already on the trail (`avoid`).
   */
  fastify.get<{ Querystring: { title?: string; avoid?: string } }>(
    '/api/next-from-here/walk',
    { preHandler: requireAuth, schema: { tags: ['next-from-here'], querystring: TITLE_QUERY } },
    async (request, reply) => {
      const userId = request.user?.id
      if (!userId) return reply.status(401).send({ error: 'Not signed in' })
      const ref = parseTitleRef(request.query.title)
      if (!ref) return reply.status(400).send(BAD_TITLE)
      const result = await walkNext(await viewerScope(request), userId, ref, readAvoid(request.query.avoid))
      if (!result) return reply.status(404).send(NOT_FOUND)
      return result
    }
  )

  /**
   * GET /api/next-from-here/limits — the numbers the page states and
   * enforces, decided here so the bundle holds no copy of them.
   */
  fastify.get(
    '/api/next-from-here/limits',
    { preHandler: requireAuth, schema: { tags: ['next-from-here'] } },
    async () => ({ maxTrailLength: MAX_TRAIL_TITLES, walkSteps: NEXT_WALK_STEPS })
  )

  /**
   * GET /api/next-from-here/trail?refs=movie:<id>,series:<id>,… — a trail
   * read back: its titles in scope, in order, and the strongest credit shared
   * between each pair.
   */
  fastify.get<{ Querystring: { refs?: string } }>(
    '/api/next-from-here/trail',
    { preHandler: requireAuth, schema: { tags: ['next-from-here'] } },
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
   * GET /api/next-from-here/start — "Surprise me": a random well-connected
   * title in scope to start from.
   */
  fastify.get(
    '/api/next-from-here/start',
    { preHandler: requireAuth, schema: { tags: ['next-from-here'] } },
    async (request, reply) => {
      const title = await getTrailStart(await viewerScope(request))
      if (!title) return reply.status(404).send({ error: 'No title with enough links to start from' })
      return { title }
    }
  )
}

export default nextFromHereRoutes
