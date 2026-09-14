/**
 * PUT /api/channels/:id/home-screen
 *
 * Put a generated playlist or collection on its owner's Emby home screen, or
 * take it off. Owner only, admins included: the row lands on the OWNER's home
 * screen and nobody else's, so nobody else's say-so should put it there.
 * The row itself appears on the next `sync-home-sections` run.
 */
import type { FastifyInstance } from 'fastify'
import { setChannelOnHomeScreen } from '@aperture/core'
import { queryOne } from '../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'

export function registerHomeScreenHandlers(fastify: FastifyInstance) {
  fastify.put<{ Params: { id: string }; Body: { enabled?: unknown } }>(
    '/api/channels/:id/home-screen',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['playlists'],
        summary: "Show a channel on its owner's Emby home screen",
        body: {
          type: 'object',
          required: ['enabled'],
          properties: { enabled: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser
      const enabled = request.body?.enabled
      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({ error: 'enabled must be a boolean' })
      }

      const channel = await queryOne<{ owner_id: string }>(`SELECT owner_id FROM channels WHERE id = $1`, [id])
      if (!channel) {
        return reply.status(404).send({ error: 'Channel not found' })
      }
      if (channel.owner_id !== currentUser.id) {
        return reply.status(403).send({ error: 'Only the owner can put this on their home screen' })
      }

      try {
        const onHomeScreen = await setChannelOnHomeScreen(id, enabled)
        return reply.send({ onHomeScreen: onHomeScreen === true })
      } catch (err) {
        request.log.error({ err, channelId: id }, 'Failed to change channel home screen setting')
        return reply.status(500).send({ error: 'Failed to change the home screen setting' })
      }
    }
  )
}
