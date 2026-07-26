import { generateChannelRecommendations } from './recommendations.js'
import { gatherWebExpansion } from './webExpand.js'
import type { ChannelRecommendation, ChannelUpdateOptions } from './types.js'

/**
 * Compute the item list a channel would write, without touching the media server.
 *
 * The single source of truth for "what goes in this playlist/collection": both writers call it,
 * and so does the preview endpoint, so what a user approves in the preview dialog is produced by
 * exactly the same code path that would have run on a blind generate.
 *
 * Lives in its own module because it sits above both recommendations.ts and webExpand.ts, and
 * webExpand already imports from recommendations.
 */
export async function buildChannelItems(
  channelId: string,
  opts: ChannelUpdateOptions = {}
): Promise<ChannelRecommendation[]> {
  const recommendations = await generateChannelRecommendations(channelId)
  if (!opts.webExpand) return recommendations

  return [...recommendations, ...(await gatherWebExpansion(channelId, recommendations))]
}
