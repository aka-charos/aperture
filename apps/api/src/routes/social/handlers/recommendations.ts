/**
 * Peer recommendations: the recipient's inbox (Received), the sender's record
 * (Sent), their counts, the recipient list for one title, sending, and
 * dismissing.
 *
 * Two things are re-checked here that the dialog also shows, because the
 * dialog's flags are UX and not authorization: the title must be in the
 * CALLER's scope (404 otherwise — the detail page's own answer, so a sender can
 * never learn a title exists that they cannot open), and each recipient is
 * re-assessed in core (`recommendItemToUsers`).
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  assessRecipients,
  countInbox,
  countSent,
  dismissRecommendation,
  listInbox,
  listSent,
  recommendItemToUsers,
  refreshViewerRowsSoon,
  type SocialItemRef,
} from '@aperture/core'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'
import { titleInScope, viewerScope } from '../../../lib/viewerScope.js'
import {
  dismissSchema,
  inboxCountSchema,
  inboxSchema,
  recipientsSchema,
  recommendSchema,
  sentSchema,
} from '../schemas.js'

/** Exactly one of the two ids, as an item; null (the caller answers 400) otherwise. */
function itemFrom(ids: { movieId?: string; seriesId?: string }): SocialItemRef | null {
  if (ids.movieId && !ids.seriesId) return { mediaType: 'movie', itemId: ids.movieId }
  if (ids.seriesId && !ids.movieId) return { mediaType: 'series', itemId: ids.seriesId }
  return null
}

const ITEM_REQUIRED = { error: 'Exactly one of movieId or seriesId is required' }

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ error: 'Item not found' })
}

export function registerRecommendationHandlers(fastify: FastifyInstance) {
  /** GET /api/social/recommendations — the caller's inbox, grouped by sender. */
  fastify.get('/api/social/recommendations', { preHandler: requireAuth, schema: inboxSchema }, async (request, reply) => {
    const currentUser = request.user as SessionUser
    try {
      const groups = await listInbox(currentUser.id, await viewerScope(request))
      return reply.send({ groups })
    } catch (err) {
      request.log.error({ err, userId: currentUser.id }, 'Failed to load received recommendations')
      return reply.status(500).send({ error: 'Failed to load recommendations' })
    }
  })

  /** GET /api/social/recommendations/sent — what the caller sent, grouped by recipient. */
  fastify.get('/api/social/recommendations/sent', { preHandler: requireAuth, schema: sentSchema }, async (request, reply) => {
    const currentUser = request.user as SessionUser
    try {
      const groups = await listSent(currentUser.id, await viewerScope(request))
      return reply.send({ groups })
    } catch (err) {
      request.log.error({ err, userId: currentUser.id }, 'Failed to load sent recommendations')
      return reply.status(500).send({ error: 'Failed to load the titles you shared' })
    }
  })

  /** GET /api/social/recommendations/count — the sidebar badge, and whether anything was sent. */
  fastify.get(
    '/api/social/recommendations/count',
    { preHandler: requireAuth, schema: inboxCountSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      try {
        const scope = await viewerScope(request)
        const [count, sentCount] = await Promise.all([
          countInbox(currentUser.id, scope),
          countSent(currentUser.id, scope),
        ])
        return reply.send({ count, sentCount })
      } catch (err) {
        request.log.error({ err, userId: currentUser.id }, 'Failed to count shared recommendations')
        return reply.status(500).send({ error: 'Failed to count recommendations' })
      }
    }
  )

  /** GET /api/social/recommendations/recipients?movieId=|seriesId= */
  fastify.get<{ Querystring: { movieId?: string; seriesId?: string } }>(
    '/api/social/recommendations/recipients',
    { preHandler: requireAuth, schema: recipientsSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const item = itemFrom(request.query)
      if (!item) return reply.status(400).send(ITEM_REQUIRED)

      try {
        const table = item.mediaType === 'movie' ? 'movies' : 'series'
        if (!(await titleInScope(request, table, item.itemId))) return notFound(reply)

        const assessments = await assessRecipients(currentUser.id, item)
        return reply.send({
          recipients: assessments.map((a) => ({
            id: a.user.id,
            name: a.user.name,
            avatarUrl: a.user.avatarUrl,
            alreadyWatched: a.alreadyWatched,
            unavailable: a.unavailable,
            alreadyRecommended: a.alreadyRecommended,
          })),
        })
      } catch (err) {
        request.log.error({ err, userId: currentUser.id, item }, 'Failed to assess recipients')
        return reply.status(500).send({ error: 'Failed to load your connections' })
      }
    }
  )

  /** POST /api/social/recommendations — send one title to several connections. */
  fastify.post<{ Body: { movieId?: string; seriesId?: string; recipientUserIds: string[] } }>(
    '/api/social/recommendations',
    { preHandler: requireAuth, schema: recommendSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const item = itemFrom(request.body)
      if (!item) return reply.status(400).send(ITEM_REQUIRED)

      try {
        const table = item.mediaType === 'movie' ? 'movies' : 'series'
        if (!(await titleInScope(request, table, item.itemId))) return notFound(reply)

        const outcome = await recommendItemToUsers(currentUser.id, item, request.body.recipientUserIds)
        // Their "recommended by friends" row on Emby, for anyone who has one:
        // in the background, so sending never waits on the media server.
        const skipped = new Set(outcome.skipped.map((skip) => skip.userId.toLowerCase()))
        refreshViewerRowsSoon(
          request.body.recipientUserIds.filter((id) => !skipped.has(id.toLowerCase())),
          'friends'
        )
        return reply.send(outcome)
      } catch (err) {
        request.log.error({ err, userId: currentUser.id, item }, 'Failed to send recommendation')
        return reply.status(500).send({ error: 'Failed to send the recommendation' })
      }
    }
  )

  /**
   * POST /api/social/recommendations/:id/dismiss — the recipient hides one.
   * 404 for a row that is missing AND for one that is someone else's, never
   * 403: a 403 would confirm the row exists.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/social/recommendations/:id/dismiss',
    { preHandler: requireAuth, schema: dismissSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      try {
        const dismissed = await dismissRecommendation(currentUser.id, request.params.id)
        if (!dismissed) return reply.status(404).send({ error: 'Recommendation not found' })
        refreshViewerRowsSoon([currentUser.id], 'friends')
        return reply.status(204).send()
      } catch (err) {
        request.log.error({ err, userId: currentUser.id, id: request.params.id }, 'Failed to dismiss recommendation')
        return reply.status(500).send({ error: 'Failed to dismiss the recommendation' })
      }
    }
  )
}
