/**
 * AI Assistant Tools
 *
 * This module combines all tools and exports the factory function.
 */
import type { ToolContext } from '../types.js'
import { createLibraryTools } from './library.js'
import { createSearchTools } from './search.js'
import { createContentTools } from './content.js'
import { createHistoryTools } from './history.js'
import { createRecommendationTools } from './recommendations.js'
import { createPeopleTools } from './people.js'
import { createHelpTools } from './help.js'
import { createDiscoveryTools } from './discovery.js'

// Async, conditional on settings — merged separately in the chat handler
export { createN8nTools } from './n8n.js'
// Conditional on the episode-embeddings setting — same reason, merged there too
export { createEpisodeTools } from './episodes.js'
// Discovery presentation tool — added only on discovery-routed turns
export { createDiscoveryResolveTool, DISCOVERY_PROMPT } from './discoveryResolve.js'

/**
 * Create all assistant tools with the given context
 */
export function createTools(ctx: ToolContext) {
  return {
    ...createLibraryTools(ctx),
    ...createSearchTools(ctx),
    ...createContentTools(ctx),
    ...createHistoryTools(ctx),
    ...createRecommendationTools(ctx),
    ...createPeopleTools(ctx),
    ...createHelpTools(ctx),
    ...createDiscoveryTools(ctx),
  }
}
