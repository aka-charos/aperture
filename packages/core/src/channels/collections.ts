import { createChildLogger } from '../lib/logger.js'
import { query, queryOne } from '../lib/db.js'
import { getMediaServerProvider } from '../media/index.js'
import { getMediaServerApiKey } from '../settings/systemSettings.js'
import { generateChannelRecommendations } from './recommendations.js'
import { gatherWebExpansion } from './webExpand.js'
import type { ChannelUpdateOptions } from './types.js'

const logger = createChildLogger('channels')

/**
 * Generate recommendations for a channel and write them to a server-wide Collection (Box Set).
 *
 * Mirrors updateChannelPlaylist, but collections are not per-user: createOrUpdateCollection takes
 * no userId, the result is visible to everyone with library access, and there is no per-viewer
 * sharing. rankAndPin is disabled so member items' global sort names are left untouched.
 */
export async function updateChannelCollection(
  channelId: string,
  opts: ChannelUpdateOptions = {}
): Promise<{ collectionId: string; itemCount: number }> {
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()

  if (!apiKey) {
    throw new Error('Media server API key is not configured')
  }

  const channel = await queryOne<{
    id: string
    name: string
    collection_id: string | null
  }>(`SELECT id, name, collection_id FROM channels WHERE id = $1`, [channelId])

  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`)
  }

  // Same recommendation engine as playlists (movies, owner taste profile + filters)
  const recommendations = await generateChannelRecommendations(channelId)
  const expanded = opts.webExpand
    ? [...recommendations, ...(await gatherWebExpansion(channelId, recommendations))]
    : recommendations
  const itemIds = expanded.map((r) => r.providerItemId)

  const result = await provider.createOrUpdateCollection(apiKey, channel.name, itemIds, {
    rankAndPin: false,
  })

  await query(`UPDATE channels SET collection_id = $1, last_generated_at = NOW() WHERE id = $2`, [
    result.collectionId,
    channelId,
  ])

  logger.info(
    { channelId, collectionId: result.collectionId, itemCount: itemIds.length, webExpand: !!opts.webExpand },
    'Channel collection updated'
  )

  return { collectionId: result.collectionId, itemCount: itemIds.length }
}

/**
 * Delete a channel's Collection from the media server (best-effort).
 *
 * Collections are everyone-visible, so an orphaned Box Set is more disruptive than an orphaned
 * personal playlist — remove it when the channel is deleted. Failure is logged, not thrown, so it
 * never blocks deleting the channel row.
 */
export async function deleteChannelCollection(channelId: string): Promise<void> {
  const channel = await queryOne<{ collection_id: string | null }>(
    `SELECT collection_id FROM channels WHERE id = $1`,
    [channelId]
  )

  if (!channel?.collection_id) return

  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()
  if (!apiKey) return

  try {
    await provider.deleteCollection(apiKey, channel.collection_id)
    logger.info({ channelId, collectionId: channel.collection_id }, 'Channel collection deleted')
  } catch (err) {
    logger.error(
      { err, channelId, collectionId: channel.collection_id },
      'Failed to delete channel collection'
    )
  }
}
