import type { FastifyInstance } from 'fastify'
import { deleteChannelCollection } from '@aperture/core'
import { query, queryOne } from '../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'
import {
  sanitizeMediaTypes,
  type ChannelRow,
  type ChannelCreateBody,
  type ChannelUpdateBody,
  type ChannelOutputType,
} from '../types.js'

export function registerCrudHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/channels
   * List user's channels
   */
  fastify.get<{ Querystring: { outputType?: ChannelOutputType } }>(
    '/api/channels',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { outputType } = request.query

      const params: unknown[] = [currentUser.id]
      let whereClause = 'owner_id = $1'
      if (outputType === 'playlist' || outputType === 'collection') {
        params.push(outputType)
        whereClause += ' AND output_type = $2'
      }

      const result = await query<ChannelRow>(
        `SELECT * FROM channels WHERE ${whereClause} ORDER BY name ASC`,
        params
      )

      return reply.send({ channels: result.rows })
    }
  )

  /**
   * POST /api/channels
   * Create a new channel
   */
  fastify.post<{ Body: ChannelCreateBody }>(
    '/api/channels',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const {
        name,
        description,
        genreFilters,
        textPreferences,
        exampleMovieIds,
        exampleSeriesIds,
        mediaTypes,
        includeSeeds,
        isPinnedRow,
        outputType,
      } = request.body

      if (!name) {
        return reply.status(400).send({ error: 'Name is required' })
      }

      // Collections are server-wide (visible to everyone), so gate their creation behind an
      // admin-granted permission. Playlists (per-user) remain open to any user.
      if (outputType === 'collection' && !currentUser.isAdmin && !currentUser.collectionsEnabled) {
        return reply.status(403).send({ error: 'You do not have permission to create collections' })
      }

      const channel = await queryOne<ChannelRow>(
        `INSERT INTO channels (owner_id, name, description, genre_filters, text_preferences, example_movie_ids, example_series_ids, media_types, include_seeds, is_pinned_row, output_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          currentUser.id,
          name,
          description || null,
          genreFilters || [],
          textPreferences || null,
          exampleMovieIds || [],
          exampleSeriesIds || [],
          sanitizeMediaTypes(mediaTypes),
          includeSeeds || false,
          isPinnedRow || false,
          outputType === 'collection' ? 'collection' : 'playlist',
        ]
      )

      return reply.status(201).send({ channel })
    }
  )

  /**
   * GET /api/channels/:id
   * Get channel by ID
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/channels/:id',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser

      const channel = await queryOne<ChannelRow>(`SELECT * FROM channels WHERE id = $1`, [id])

      if (!channel) {
        return reply.status(404).send({ error: 'Channel not found' })
      }

      // Check ownership or admin
      if (channel.owner_id !== currentUser.id && !currentUser.isAdmin) {
        // Check if shared with user
        const share = await queryOne(
          `SELECT * FROM channel_shares WHERE channel_id = $1 AND shared_with_user_id = $2`,
          [id, currentUser.id]
        )

        if (!share) {
          return reply.status(403).send({ error: 'Forbidden' })
        }
      }

      return reply.send({ channel })
    }
  )

  /**
   * PUT /api/channels/:id
   * Update channel
   */
  fastify.put<{ Params: { id: string }; Body: ChannelUpdateBody }>(
    '/api/channels/:id',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser

      // Check ownership
      const existing = await queryOne<ChannelRow>(`SELECT * FROM channels WHERE id = $1`, [id])

      if (!existing) {
        return reply.status(404).send({ error: 'Channel not found' })
      }

      if (existing.owner_id !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      const {
        name,
        description,
        genreFilters,
        textPreferences,
        exampleMovieIds,
        exampleSeriesIds,
        mediaTypes,
        includeSeeds,
        isPinnedRow,
        isActive,
      } = request.body

      const updates: string[] = []
      const values: unknown[] = []
      let paramIndex = 1

      if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`)
        values.push(name)
      }
      if (description !== undefined) {
        updates.push(`description = $${paramIndex++}`)
        values.push(description)
      }
      if (genreFilters !== undefined) {
        updates.push(`genre_filters = $${paramIndex++}`)
        values.push(genreFilters)
      }
      if (textPreferences !== undefined) {
        updates.push(`text_preferences = $${paramIndex++}`)
        values.push(textPreferences)
      }
      if (exampleMovieIds !== undefined) {
        updates.push(`example_movie_ids = $${paramIndex++}`)
        values.push(exampleMovieIds)
      }
      if (exampleSeriesIds !== undefined) {
        updates.push(`example_series_ids = $${paramIndex++}`)
        values.push(exampleSeriesIds)
      }
      if (mediaTypes !== undefined) {
        updates.push(`media_types = $${paramIndex++}`)
        values.push(sanitizeMediaTypes(mediaTypes))
      }
      if (includeSeeds !== undefined) {
        updates.push(`include_seeds = $${paramIndex++}`)
        values.push(includeSeeds)
      }
      if (isPinnedRow !== undefined) {
        updates.push(`is_pinned_row = $${paramIndex++}`)
        values.push(isPinnedRow)
      }
      if (isActive !== undefined) {
        updates.push(`is_active = $${paramIndex++}`)
        values.push(isActive)
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'No fields to update' })
      }

      values.push(id)
      const channel = await queryOne<ChannelRow>(
        `UPDATE channels SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      )

      return reply.send({ channel })
    }
  )

  /**
   * DELETE /api/channels/:id
   * Delete channel
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/channels/:id',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser

      const existing = await queryOne<ChannelRow>(`SELECT * FROM channels WHERE id = $1`, [id])

      if (!existing) {
        return reply.status(404).send({ error: 'Channel not found' })
      }

      if (existing.owner_id !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      // Collections are everyone-visible — remove the Box Set from the media server so deleting
      // the config doesn't leave an orphan in the library. Best-effort; never blocks the delete.
      if (existing.output_type === 'collection') {
        try {
          await deleteChannelCollection(id)
        } catch (err) {
          request.log.error({ err, channelId: id }, 'Failed to delete channel collection')
        }
      }

      await query('DELETE FROM channels WHERE id = $1', [id])

      return reply.send({ success: true })
    }
  )
}



