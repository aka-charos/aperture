// Re-export types
export type {
  Channel,
  ChannelRecommendation,
  ChannelMediaType,
  ChannelUpdateOptions,
} from './types.js'

// Re-export the shared item builder (what a channel would write, without writing it)
export { buildChannelItems } from './build.js'

// Re-export utilities
export { weightedRandomSample } from './utils.js'

// Re-export recommendation functions
export { generateChannelRecommendations, parseChannelMediaTypes } from './recommendations.js'

// Re-export playlist functions
export {
  updateChannelPlaylist,
  createSharedPlaylist,
  processAllChannels,
} from './playlists.js'

// Re-export collection functions
export { updateChannelCollection, deleteChannelCollection } from './collections.js'

// Re-export STRM functions
export { writeChannelStrm } from './strm.js'

// Re-export AI functions
export {
  generateAIPreferences,
  generateAIPlaylistName,
  generateAIPlaylistDescription,
} from './ai.js'
