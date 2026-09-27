/**
 * Connections. Reading your own is for everyone; making, listing and removing
 * pairs is admin-only — there is no self-serve path, and users never see the
 * pairing UI (docs/plans/social-connections.md §1).
 */
import type { FastifyInstance } from 'fastify'
import {
  createUserConnection,
  listAllConnections,
  listVisibleConnections,
  removeUserConnection,
  SocialUserNotFoundError,
} from '@aperture/core'
import { requireAdmin, requireAuth, type SessionUser } from '../../../plugins/auth.js'
import {
  createConnectionSchema,
  deleteConnectionSchema,
  listAllConnectionsSchema,
  listConnectionsSchema,
} from '../schemas.js'

export function registerConnectionHandlers(fastify: FastifyInstance) {
  /** GET /api/social/connections — the caller's visible connections. */
  fastify.get('/api/social/connections', { preHandler: requireAuth, schema: listConnectionsSchema }, async (request, reply) => {
    const currentUser = request.user as SessionUser
    try {
      const connections = await listVisibleConnections(currentUser.id)
      return reply.send({
        connections: connections.map((c) => ({ id: c.id, name: c.name, avatarUrl: c.avatarUrl })),
      })
    } catch (err) {
      request.log.error({ err, userId: currentUser.id }, 'Failed to list connections')
      return reply.status(500).send({ error: 'Failed to load connections' })
    }
  })

  /** GET /api/social/connections/all — every pair, for the admin dialog. */
  fastify.get('/api/social/connections/all', { preHandler: requireAdmin, schema: listAllConnectionsSchema }, async (request, reply) => {
    try {
      return reply.send({ connections: await listAllConnections() })
    } catch (err) {
      request.log.error({ err }, 'Failed to list all connections')
      return reply.status(500).send({ error: 'Failed to load connections' })
    }
  })

  /** POST /api/social/connections — connect two users. */
  fastify.post<{ Body: { userAId: string; userBId: string } }>(
    '/api/social/connections',
    { preHandler: requireAdmin, schema: createConnectionSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { userAId, userBId } = request.body
      try {
        const { pair, created } = await createUserConnection(
          { userId: currentUser.id, label: currentUser.username },
          userAId,
          userBId
        )
        return reply.send({ connection: pair, created })
      } catch (err) {
        if (err instanceof RangeError) return reply.status(400).send({ error: err.message })
        if (err instanceof SocialUserNotFoundError) return reply.status(404).send({ error: err.message })
        request.log.error({ err, userAId, userBId }, 'Failed to create connection')
        return reply.status(500).send({ error: 'Failed to create the connection' })
      }
    }
  )

  /** DELETE /api/social/connections/:id — remove a pair by its row id. */
  fastify.delete<{ Params: { id: string } }>(
    '/api/social/connections/:id',
    { preHandler: requireAdmin, schema: deleteConnectionSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      try {
        const removed = await removeUserConnection(
          { userId: currentUser.id, label: currentUser.username },
          request.params.id
        )
        if (!removed) return reply.status(404).send({ error: 'Connection not found' })
        return reply.status(204).send()
      } catch (err) {
        request.log.error({ err, id: request.params.id }, 'Failed to remove connection')
        return reply.status(500).send({ error: 'Failed to remove the connection' })
      }
    }
  )
}
