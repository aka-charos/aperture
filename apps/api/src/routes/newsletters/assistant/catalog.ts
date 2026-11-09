/**
 * Every tool the newsletter writing assistant is handed: a chosen subset of the
 * chat assistant's library tools, plus its own (tools.ts).
 *
 * Left out on purpose: everything about the admin as a viewer
 * (`getMyRecommendations`, `searchMyRecommendations`, `getWatchHistory`,
 * `getUserRatings`, `getUnwatched`, `getUpcomingEpisodes`, which reads the
 * admin's own followed shows), the web discovery tool (it spends Google
 * grounding quota and finds titles the library does not hold, which a title
 * card cannot show), `getFranchiseProgress` (the admin's progress),
 * `getSystemHelp` and n8n. A newsletter is about the library and its audience.
 *
 * The one list is `REUSED_TOOLS`; `catalog.test.ts` checks every name still
 * exists in the chat's catalog, so a renamed tool fails there instead of
 * silently disappearing from this assistant.
 */
import type { ToolSet } from 'ai'
import { createTools } from '../../assistant/tools/index.js'
import type { ToolContext } from '../../assistant/types.js'
import { createNewsletterTools } from './tools.js'
import type { NewsletterDraftContext } from './draftSummary.js'

type ChatToolName = keyof ReturnType<typeof createTools>

export const REUSED_TOOLS = [
  'searchContent',
  'semanticSearch',
  'searchByKeyword',
  'findSimilarContent',
  'getContentDetails',
  'getTitleAnalysis',
  'getTopRated',
  'getTopByRtScore',
  'getAwardWinners',
  'getContentRankings',
  'getFranchises',
  'searchPeople',
  'getTopStudios',
  'getAvailableGenres',
  'getLibraryStats',
] as const satisfies readonly ChatToolName[]

export function buildNewsletterToolCatalog(ctx: ToolContext, draft: NewsletterDraftContext): ToolSet {
  const chatTools = createTools(ctx)
  const reused: ToolSet = {}
  for (const name of REUSED_TOOLS) reused[name] = chatTools[name]
  return { ...reused, ...createNewsletterTools(ctx, draft) }
}
