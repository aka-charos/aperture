/**
 * Discovery presentation tool.
 *
 * Web candidates are gathered before the stream (see discovery/webCandidates)
 * and stashed on the tool context. This tool resolves them against the library
 * and returns them as the primary "Recommendations" carousel. When the request
 * references a specific title (seedTitle), it ALSO adds an "Also worth checking"
 * carousel of embeddings-similar library items (deduped against the web picks),
 * so the user gets both sources in one deterministic result — web first.
 *
 * Same render path as every other content tool (everything shown is a library
 * item). Only added to the toolset on discovery-routed turns.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { createChildLogger } from '@aperture/core'
import { createCarouselResult, type ContentCarousel } from '../schemas/contentCarousel.js'
import { resolveCandidates } from '../discovery/resolveCandidates.js'
import { findSimilarItems } from './search.js'
import type { ContentItem } from '../schemas/index.js'
import type { ToolContext } from '../types.js'

const logger = createChildLogger('discovery-resolve')

/** Appended to the system prompt on discovery-routed turns. */
export const DISCOVERY_PROMPT =
  'Web-sourced candidate titles for this request have already been gathered. ' +
  'Call findCandidatesInLibrary exactly once. If the request is about titles similar to a ' +
  'specific movie or show (e.g. "similar to X", "something like X"), pass that title as ' +
  'seedTitle so the tool can add related picks from the library. ' +
  'Present the "Recommendations" set as the primary picks and "Also worth checking" as a ' +
  'secondary suggestion, and briefly note any standout titles that are not in the library yet. ' +
  'Only present what the tool returns — never invent titles.'

export function createDiscoveryResolveTool(ctx: ToolContext) {
  return {
    findCandidatesInLibrary: tool({
      description:
        "Resolve the web-sourced candidate titles already gathered for this request against the user's library, and — when a specific title is referenced via seedTitle — add related picks from the library by similarity. Call this exactly ONCE. Present the returned 'Recommendations' as the primary picks and 'Also worth checking' as secondary, and briefly mention any standout titles NOT in the library yet. Only present what this tool returns — never invent titles.",
      inputSchema: z.object({
        seedTitle: z
          .string()
          .optional()
          .describe(
            'If the request references a specific title (e.g. "movies similar to X"), the title X — used to add embeddings-based related picks from the library.'
          ),
      }),
      execute: async ({ seedTitle }) => {
        const candidates = ctx.discoveryCandidates ?? []
        const { items: webItems, notInLibrary } = await resolveCandidates(candidates, ctx)

        // Pass leftovers to the model (for commentary) without rendering them as cards
        const notInLibraryTitles = notInLibrary.map((c) => ({
          title: c.title,
          year: c.year,
          mediaType: c.mediaType,
        }))

        // Secondary section: embeddings-similar to the referenced title, deduped
        // against the web picks so nothing appears twice. Only when a title was given.
        let alsoItems: ContentItem[] = []
        if (seedTitle?.trim()) {
          try {
            const webIds = new Set(webItems.map((i) => i.id))
            const sim = await findSimilarItems(ctx, seedTitle.trim(), { limit: 12 })
            alsoItems = sim.items.filter((i) => !webIds.has(i.id))
          } catch (err) {
            logger.warn({ err }, 'Embeddings supplement failed; continuing with web results only')
          }
        }

        const carousels: ContentCarousel[] = []
        if (webItems.length > 0) {
          carousels.push(
            createCarouselResult(`discovery-${Date.now()}`, webItems, { title: 'Recommendations' })
          )
        }
        if (alsoItems.length > 0) {
          carousels.push(
            createCarouselResult(`discovery-also-${Date.now()}`, alsoItems, {
              title: 'Also worth checking',
            })
          )
        }

        if (carousels.length === 0) {
          carousels.push(
            createCarouselResult(`discovery-empty-${Date.now()}`, [], {
              description: 'None of the web-sourced picks are in your library yet.',
            })
          )
        }

        return { carousels, notInLibrary: notInLibraryTitles }
      },
    }),
  }
}
