import { createChildLogger } from '../lib/logger.js'
import { queryOne } from '../lib/db.js'
import { getMediaServerProvider } from '../media/index.js'
import { getMediaServerApiKey } from '../settings/systemSettings.js'

const logger = createChildLogger('channels')

/**
 * Push a channel's stored description onto the playlist/collection it already created.
 *
 * The writers set the description as part of a generate, but editing the text and hitting Save is
 * not a generate — without this, the new wording would sit in our DB until the next refresh. This
 * is the metadata-only path: it never touches the item list, so saving a description can't reorder
 * or re-sample what is in the library.
 *
 * No-ops when nothing has been generated yet (the description ships with the first generate), and
 * when the description is empty — clearing the text leaves the library's existing overview alone
 * rather than blanking it, matching how the generate path treats an absent description.
 *
 * Best-effort throughout: a media server that is down or an item that has since been deleted by
 * hand must not fail the save.
 */
export async function syncChannelDescription(channelId: string): Promise<void> {
  const channel = await queryOne<{
    description: string | null
    output_type: string | null
    collection_id: string | null
    playlist_id: string | null
    provider_user_id: string | null
  }>(
    `SELECT c.description, c.output_type, c.collection_id, c.playlist_id, u.provider_user_id
     FROM channels c
     JOIN users u ON u.id = c.owner_id
     WHERE c.id = $1`,
    [channelId]
  )

  if (!channel) return

  const description = channel.description?.trim()
  if (!description) return

  const targetId =
    channel.output_type === 'collection' ? channel.collection_id : channel.playlist_id
  if (!targetId) return

  try {
    const apiKey = await getMediaServerApiKey()
    if (!apiKey) return

    const provider = await getMediaServerProvider()

    if (channel.output_type === 'collection') {
      await provider.updateCollectionOverview(apiKey, targetId, description)
    } else if (channel.provider_user_id) {
      // Playlists are per-user, so the overview update needs the owner's provider id.
      await provider.updatePlaylistOverview(apiKey, channel.provider_user_id, targetId, description)
    }

    logger.info(
      { channelId, targetId, outputType: channel.output_type },
      'Channel description pushed to media server'
    )
  } catch (err) {
    logger.error({ err, channelId, targetId }, 'Failed to push channel description')
  }
}
