/**
 * AI Assistant Tools
 *
 * This module combines all tools and exports the factory function.
 */
import type { ToolSet } from 'ai'
import type { ToolContext } from '../types.js'
import { createLibraryTools } from './library.js'
import { createSearchTools } from './search.js'
import { createContentTools } from './content.js'
import { createAnalysisTools } from './analysis.js'
import { createHistoryTools } from './history.js'
import { createRecommendationTools } from './recommendations.js'
import { createPeopleTools } from './people.js'
import { createHelpTools } from './help.js'
import { createDiscoveryTools } from './discovery.js'
import { createUpcomingTools } from './upcoming.js'
import { createN8nTools } from './n8n.js'
import { createEpisodeTools } from './episodes.js'
import { createDiscoveryResolveTool } from './discoveryResolve.js'

// Async, conditional on settings — merged in buildToolCatalog
export { createN8nTools } from './n8n.js'
// Conditional on the episode-embeddings setting — same reason
export { createEpisodeTools } from './episodes.js'
// Discovery presentation tool — added only on discovery-routed turns
export { createDiscoveryResolveTool, DISCOVERY_PROMPT } from './discoveryResolve.js'

/**
 * Tools dropped on a discovery turn: they directly duplicate what the
 * discovery tool already produces — query-driven list builders that compete
 * with the web "Recommendations" and tempt the model to bypass
 * findCandidatesInLibrary entirely:
 *   - findSimilarContent: same output as the embeddings "Also worth checking"
 *   - searchContent / semanticSearch: alternative recommendation lists from the query
 * Distinct-intent tools (getTopRated / getMyRecommendations / getUnwatched) stay
 * available so the model can SUPPLEMENT the web picks with broader in-library
 * coverage (e.g. getTopRated by genre). The prompt mandates calling
 * findCandidatesInLibrary first so the reasoned web cards are always primary.
 */
export const DISCOVERY_SUPPRESSED_TOOLS = ['findSimilarContent', 'searchContent', 'semanticSearch']

/**
 * Every tool one chat turn hands the model, before the per-turn wrappers.
 * The ONE place the catalog is assembled: the chat handler sends what this
 * returns, and `toolSchemas.test.ts` checks the same thing, so a new factory
 * added here is covered by that test without anyone remembering to add it.
 *
 * The two async factories decide for themselves whether they have anything to
 * contribute — searchEpisodes returns {} when episode embeddings are switched
 * off, so the model is never handed a tool whose table is empty. `discovery`
 * is the request text on a discovery-routed turn, else null.
 */
export async function buildToolCatalog(
  ctx: ToolContext,
  discovery: { userRequest: string } | null
): Promise<ToolSet> {
  const tools: ToolSet = {
    ...createTools(ctx),
    ...(await createEpisodeTools(ctx)),
    ...(await createN8nTools()),
  }
  if (!discovery) return tools
  for (const name of DISCOVERY_SUPPRESSED_TOOLS) delete tools[name]
  return { ...tools, ...createDiscoveryResolveTool(ctx, discovery.userRequest) }
}

/**
 * Create all assistant tools with the given context
 */
export function createTools(ctx: ToolContext) {
  return {
    ...createLibraryTools(ctx),
    ...createSearchTools(ctx),
    ...createContentTools(ctx),
    ...createAnalysisTools(ctx),
    ...createHistoryTools(ctx),
    ...createRecommendationTools(ctx),
    ...createPeopleTools(ctx),
    ...createHelpTools(ctx),
    ...createDiscoveryTools(ctx),
    ...createUpcomingTools(ctx),
  }
}
