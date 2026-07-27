import type { FastifyInstance } from 'fastify'
import { query, queryOne } from '../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'
import {
  updateChannelPlaylist,
  updateChannelCollection,
  buildChannelItems,
  generateChannelPickReasons,
  getMediaServerProvider,
  getMediaServerApiKey,
  type ChannelRecommendation,
} from '@aperture/core'
import type { ChannelRow } from '../types.js'

/**
 * Hydrate collection item IDs (media-server provider item ids) into the same rich shape the
 * playlist view returns. getCollectionItems only yields ids, so we look the titles up in our own
 * DB and preserve the collection's order. playlistItemId mirrors the item id so the shared view
 * dialog can remove a collection member by that id.
 *
 * Both tables are searched: a channel with series in its media types writes series items into the
 * collection, and a movies-only lookup would silently drop them from the view.
 */
async function hydrateCollectionItems(providerItemIds: string[]) {
  if (providerItemIds.length === 0) return []

  const result = await query<{
    provider_item_id: string
    title: string
    year: number | null
    poster_url: string | null
    runtime: number | null
  }>(
    `SELECT provider_item_id, title, year, poster_url, runtime_minutes AS runtime
     FROM movies WHERE provider_item_id = ANY($1)
     UNION ALL
     SELECT provider_item_id, title, year, poster_url, NULL AS runtime
     FROM series WHERE provider_item_id = ANY($1)`,
    [providerItemIds]
  )

  const byId = new Map(result.rows.map((m) => [m.provider_item_id, m]))
  return providerItemIds
    .map((pid) => byId.get(pid))
    .filter((m): m is NonNullable<typeof m> => m !== undefined)
    .map((m) => ({
      id: m.provider_item_id,
      playlistItemId: m.provider_item_id,
      title: m.title,
      year: m.year,
      posterUrl: m.poster_url,
      runtime: m.runtime,
    }))
}

/**
 * Add everything the preview cards show beyond the id/title/year buildChannelItems carries:
 * artwork, synopsis, community rating and genres, looked up by Aperture id in the table each
 * item's media type points at. Order is preserved — a preview is a proposal for the exact order
 * that gets written.
 */
async function hydratePreviewItems(recommendations: ChannelRecommendation[]) {
  if (recommendations.length === 0) return []

  const movieIds = recommendations.filter((r) => r.mediaType === 'movie').map((r) => r.itemId)
  const seriesIds = recommendations.filter((r) => r.mediaType === 'series').map((r) => r.itemId)

  const result = await query<{
    id: string
    poster_url: string | null
    runtime: number | null
    overview: string | null
    community_rating: string | number | null
    genres: string[] | null
  }>(
    `SELECT id, poster_url, runtime_minutes AS runtime, overview, community_rating, genres
     FROM movies WHERE id = ANY($1)
     UNION ALL
     SELECT id, poster_url, NULL AS runtime, overview, community_rating, genres
     FROM series WHERE id = ANY($2)`,
    [movieIds, seriesIds]
  )

  const byId = new Map(result.rows.map((r) => [r.id, r]))
  return recommendations.map((rec) => {
    const row = byId.get(rec.itemId)
    return {
      // The media server speaks provider item ids; that is also what comes back on confirm.
      id: rec.providerItemId,
      itemId: rec.itemId,
      mediaType: rec.mediaType,
      title: rec.title,
      year: rec.year,
      posterUrl: row?.poster_url ?? null,
      runtime: row?.runtime ?? null,
      overview: row?.overview ?? null,
      // NUMERIC comes back as a string from pg; the card wants a number to format.
      rating: row?.community_rating != null ? Number(row.community_rating) : null,
      genres: row?.genres ?? [],
      isSeed: !!rec.isSeed,
    }
  })
}

/**
 * Attach a one-line "why this is here" to each generated pick.
 *
 * Seeds are excluded: the user chose those by name and the card already badges them, so asking a
 * model to justify them would spend tokens explaining their own choice back to them. Failing open
 * is deliberate — no writing model configured, or a provider that errors, costs the notes and
 * nothing else.
 */
type HydratedPreviewItem = Awaited<ReturnType<typeof hydratePreviewItems>>[number]

async function attachPreviewReasons(
  channelId: string,
  items: HydratedPreviewItem[]
): Promise<Array<HydratedPreviewItem & { reason?: string }>> {
  const generated = items.filter((item) => !item.isSeed)
  if (generated.length === 0) return items

  const reasons = await generateChannelPickReasons(
    channelId,
    generated.map(({ itemId, title, year, overview }) => ({ itemId, title, year, overview }))
  )

  if (reasons.size === 0) return items
  return items.map((item) => {
    const reason = reasons.get(item.itemId)
    return reason ? { ...item, reason } : item
  })
}

export function registerPlaylistHandlers(fastify: FastifyInstance) {
  /**
   * POST /api/channels/:id/preview
   * Compute what a generate would write, without touching the media server.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/channels/:id/preview',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser

      const channel = await queryOne<ChannelRow>(`SELECT * FROM channels WHERE id = $1`, [id])

      if (!channel) {
        return reply.status(404).send({ error: 'Channel not found' })
      }

      if (channel.owner_id !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      try {
        // Same options a manual generate uses, so the preview is what would actually be written.
        const recommendations = await buildChannelItems(id, { webExpand: true })
        const hydrated = await hydratePreviewItems(recommendations)
        // Costs one short model call per 8 picks, on a dialog the user is already waiting on.
        // Worth it: without a rationale the preview asks them to approve a ranked list whose
        // ranking they cannot see.
        const items = await attachPreviewReasons(id, hydrated)
        return reply.send({ items })
      } catch (err) {
        request.log.error({ err, channelId: id }, 'Failed to preview channel output')
        return reply.status(500).send({ error: 'Failed to preview playlist' })
      }
    }
  )

  /**
   * POST /api/channels/:id/generate
   * Generate/refresh playlist for channel. An itemIds body writes exactly that list (the set the
   * user approved in the preview dialog) instead of sampling a fresh one.
   */
  fastify.post<{ Params: { id: string }; Body?: { itemIds?: string[] } }>(
    '/api/channels/:id/generate',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser
      const approvedItemIds = request.body?.itemIds

      const channel = await queryOne<ChannelRow>(`SELECT * FROM channels WHERE id = $1`, [id])

      if (!channel) {
        return reply.status(404).send({ error: 'Channel not found' })
      }

      if (channel.owner_id !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      try {
        // Manual generate always attempts web-search expansion (no-op unless the Web Search
        // role is configured), except when the caller already approved a list. Generate once and
        // use the written item count for the message.
        const opts = approvedItemIds?.length
          ? { itemIds: approvedItemIds }
          : { webExpand: true }

        if (channel.output_type === 'collection') {
          const { collectionId, itemCount } = await updateChannelCollection(id, opts)
          return reply.send({
            collectionId,
            itemCount,
            message: `Collection updated with ${itemCount} items`,
          })
        }

        const { playlistId, itemCount } = await updateChannelPlaylist(id, opts)
        return reply.send({
          playlistId,
          itemCount,
          message: `Playlist updated with ${itemCount} items`,
        })
      } catch (err) {
        request.log.error({ err, channelId: id }, 'Failed to generate channel output')
        return reply.status(500).send({ error: 'Failed to generate playlist' })
      }
    }
  )

  /**
   * GET /api/channels/:id/items
   * Get playlist items for a channel
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/channels/:id/items',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser

      const channel = await queryOne<ChannelRow>(`SELECT * FROM channels WHERE id = $1`, [id])

      if (!channel) {
        return reply.status(404).send({ error: 'Channel not found' })
      }

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

      const apiKey = await getMediaServerApiKey()
      if (!apiKey) {
        return reply.status(500).send({ error: 'Media server API key not configured' })
      }

      try {
        const provider = await getMediaServerProvider()

        if (channel.output_type === 'collection') {
          if (!channel.collection_id) {
            return reply.send({ items: [], message: 'No collection generated yet' })
          }
          const ids = await provider.getCollectionItems(apiKey, channel.collection_id)
          const items = await hydrateCollectionItems(ids)
          return reply.send({ items, collectionId: channel.collection_id })
        }

        if (!channel.playlist_id) {
          return reply.send({ items: [], message: 'No playlist generated yet' })
        }
        const items = await provider.getPlaylistItems(apiKey, channel.playlist_id)
        return reply.send({ items, playlistId: channel.playlist_id })
      } catch (err) {
        request.log.error({ err, channelId: id }, 'Failed to get channel items')
        return reply.status(500).send({ error: 'Failed to get playlist items' })
      }
    }
  )

  /**
   * DELETE /api/channels/:id/items/:entryId
   * Remove an item from the playlist
   */
  fastify.delete<{ Params: { id: string; entryId: string } }>(
    '/api/channels/:id/items/:entryId',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const { id, entryId } = request.params
      const currentUser = request.user as SessionUser

      const channel = await queryOne<ChannelRow>(`SELECT * FROM channels WHERE id = $1`, [id])

      if (!channel) {
        return reply.status(404).send({ error: 'Channel not found' })
      }

      if (channel.owner_id !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      const apiKey = await getMediaServerApiKey()
      if (!apiKey) {
        return reply.status(500).send({ error: 'Media server API key not configured' })
      }

      try {
        const provider = await getMediaServerProvider()

        if (channel.output_type === 'collection') {
          if (!channel.collection_id) {
            return reply.status(400).send({ error: 'No collection exists for this channel' })
          }
          await provider.removeCollectionItems(apiKey, channel.collection_id, [entryId])
        } else {
          if (!channel.playlist_id) {
            return reply.status(400).send({ error: 'No playlist exists for this channel' })
          }
          await provider.removePlaylistItems(apiKey, channel.playlist_id, [entryId])
        }

        return reply.send({ success: true })
      } catch (err) {
        request.log.error({ err, channelId: id, entryId }, 'Failed to remove channel item')
        return reply.status(500).send({ error: 'Failed to remove item' })
      }
    }
  )

  /**
   * POST /api/channels/:id/items
   * Add items to the playlist
   */
  fastify.post<{ Params: { id: string }; Body: { itemIds: string[] } }>(
    '/api/channels/:id/items',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const { id } = request.params
      const { itemIds } = request.body
      const currentUser = request.user as SessionUser

      const channel = await queryOne<ChannelRow>(`SELECT * FROM channels WHERE id = $1`, [id])

      if (!channel) {
        return reply.status(404).send({ error: 'Channel not found' })
      }

      if (channel.owner_id !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      if (!itemIds || itemIds.length === 0) {
        return reply.status(400).send({ error: 'No items provided' })
      }

      const apiKey = await getMediaServerApiKey()
      if (!apiKey) {
        return reply.status(500).send({ error: 'Media server API key not configured' })
      }

      try {
        const provider = await getMediaServerProvider()

        if (channel.output_type === 'collection') {
          if (!channel.collection_id) {
            return reply.status(400).send({ error: 'No collection exists for this channel' })
          }
          await provider.addCollectionItems(apiKey, channel.collection_id, itemIds)
        } else {
          if (!channel.playlist_id) {
            return reply.status(400).send({ error: 'No playlist exists for this channel' })
          }
          await provider.addPlaylistItems(apiKey, channel.playlist_id, itemIds)
        }

        return reply.send({ success: true, addedCount: itemIds.length })
      } catch (err) {
        request.log.error({ err, channelId: id, itemIds }, 'Failed to add channel items')
        return reply.status(500).send({ error: 'Failed to add items' })
      }
    }
  )
}



