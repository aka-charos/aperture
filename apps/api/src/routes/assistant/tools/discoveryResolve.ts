/**
 * Discovery presentation tool.
 *
 * Web candidates are gathered before the stream (see discovery/webCandidates)
 * and stashed on the tool context. This tool resolves them against the library
 * and returns a carousel of the matches — the same render path as every other
 * content tool, so the user-facing invariant ("everything shown is a library
 * item") holds. Only added to the toolset on discovery-routed turns.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { createCarouselResult } from '../schemas/contentCarousel.js'
import { resolveCandidates } from '../discovery/resolveCandidates.js'
import type { ToolContext } from '../types.js'

/** Appended to the system prompt on discovery-routed turns. */
export const DISCOVERY_PROMPT =
  'Web-sourced candidate titles for this request have already been gathered. ' +
  'Call findCandidatesInLibrary exactly once to see which are available in the library, ' +
  'then present those as cards and briefly note any standout titles that are not in the library yet. ' +
  'Only present what the tool returns — never invent titles.'

export function createDiscoveryResolveTool(ctx: ToolContext) {
  return {
    findCandidatesInLibrary: tool({
      description:
        "Check which of the web-sourced candidate titles already gathered for this request are available in the user's library. Call this exactly ONCE, then present the returned items as cards and briefly mention any standout titles that are NOT in the library yet. Only present what this tool returns — never invent titles.",
      inputSchema: z.object({}),
      execute: async () => {
        const candidates = ctx.discoveryCandidates ?? []
        const { items, notInLibrary } = await resolveCandidates(candidates, ctx)

        // Pass leftovers to the model (for commentary) without rendering them as cards
        const notInLibraryTitles = notInLibrary.map((c) => ({
          title: c.title,
          year: c.year,
          mediaType: c.mediaType,
        }))

        if (items.length === 0) {
          return {
            ...createCarouselResult(`discovery-empty-${Date.now()}`, [], {
              description: 'None of the web-sourced picks are in your library yet.',
            }),
            notInLibrary: notInLibraryTitles,
          }
        }

        return {
          ...createCarouselResult(`discovery-${Date.now()}`, items, {
            title: 'From the web — available in your library',
          }),
          notInLibrary: notInLibraryTitles,
        }
      },
    }),
  }
}
