/**
 * Discovery presentation tool.
 *
 * This tool gathers the web-sourced candidates itself (inside execute), then
 * resolves them against the library and returns them as the primary
 * "Recommendations" carousel. Gathering here — rather than before the stream —
 * lets the assistant stream its opening line FIRST, then do the slow web work
 * while the card skeletons show, instead of the whole reply flushing at once
 * after a long silent wait.
 *
 * When the request references a specific title (seedTitle), it ALSO adds an
 * "Also worth checking" carousel of embeddings-similar library items (deduped
 * against the web picks), so the user gets both sources in one deterministic
 * result — web first.
 *
 * Same render path as every other content tool (everything shown is a library
 * item). Only added to the toolset on discovery-routed turns.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { nullSafe } from './utils.js'
import { createChildLogger } from '@aperture/core'
import { createCarouselResult, type ContentCarousel } from '../schemas/contentCarousel.js'
import { resolveCandidates } from '../discovery/resolveCandidates.js'
import { gatherWebCandidates } from '../discovery/webCandidates.js'
import { findSimilarItems } from './search.js'
import type { ContentItem } from '../schemas/index.js'
import type { ToolContext } from '../types.js'

const logger = createChildLogger('discovery-resolve')

/** Appended to the system prompt on discovery-routed turns. */
export const DISCOVERY_PROMPT =
  'This is a recommendation/discovery request. Structure your reply in three beats:\n' +
  '1. FIRST, before calling any tool, write ONE short, warm sentence that acknowledges the ' +
  'request — name the referenced title or genre and say you\'ll pull what the library has. ' +
  'One line only; this is what the user sees while the picks load.\n' +
  '2. THEN call findCandidatesInLibrary exactly ONCE. It gathers web-sourced picks and matches ' +
  'them to the library. If the request references a specific title (e.g. "like X", "similar to ' +
  'X"), pass that title as seedTitle so related library picks are added too. Each pick comes ' +
  'back with a short grounded "reason", and that reason is ALSO printed on its card — so you ' +
  'never repeat the reasons title-by-title.\n' +
  '3. AFTER the cards render, ALWAYS write a short closing paragraph (2-4 sentences). This is ' +
  'required — never stop at the cards. Do NOT enumerate every title. Instead: call out 2-3 ' +
  'standouts by name and what ties them to the request, and mention any notable titles from ' +
  'the returned notInLibrary list that would be worth adding.\n' +
  'For an open genre/theme/"best of" browse you MAY also call getTopRated (passing the genre) ' +
  'AFTER findCandidatesInLibrary for a broader in-library list. If findCandidatesInLibrary ' +
  'returns no matches, fall back to getTopRated or getMyRecommendations so the user still gets ' +
  'picks. The web "Recommendations" cards are the primary picks; "Also worth checking" and any ' +
  'getTopRated list are secondary. Only present titles these tools return — never invent titles.'

export function createDiscoveryResolveTool(ctx: ToolContext, queryText: string) {
  return {
    findCandidatesInLibrary: tool({
      description:
        "Gather web-sourced recommendation candidates for this request and match them to the user's library, returning them as the primary 'Recommendations'. When a specific title is referenced via seedTitle, also add embeddings-similar library picks as 'Also worth checking'. Call this exactly ONCE, first. Each pick includes a short grounded 'reason' that is already shown on its card — synthesize a short closing note rather than repeating them per title. Only present what this tool returns — never invent titles.",
      inputSchema: nullSafe(z.object({
        seedTitle: z
          .string()
          .optional()
          .describe(
            'If the request references a specific title (e.g. "movies similar to X"), the title X — used to add embeddings-based related picks from the library.'
          ),
      })),
      execute: async ({ seedTitle }) => {
        // Gathered here (not before the stream) so the assistant's opening line
        // streams first and this slow web work runs behind the card skeletons.
        const candidates = await gatherWebCandidates(queryText)
        logger.info({ candidateCount: candidates.length, seedTitle: seedTitle ?? null }, 'Discovery candidates gathered')
        const { items: webItems, notInLibrary } = await resolveCandidates(candidates, ctx)

        // Pass leftovers to the model (for commentary) without rendering them as cards
        const notInLibraryTitles = notInLibrary.map((c) => ({
          title: c.title,
          year: c.year,
          mediaType: c.mediaType,
        }))

        // Per-pick rationale from the web search: grounding for the model's "why".
        // Also attached to each resolved card (see resolveCandidates), so the model
        // synthesizes from these rather than restating them per title.
        const notInLibrarySet = new Set(notInLibrary)
        const picks = candidates.map((c) => ({
          title: c.title,
          year: c.year,
          reason: c.reason,
          inLibrary: !notInLibrarySet.has(c),
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
          // Web picks carry a per-title reason + synopsis → render as the rich
          // vertical list. The embeddings section below stays a horizontal carousel.
          carousels.push(
            createCarouselResult(`discovery-${Date.now()}`, webItems, {
              title: 'Recommendations',
              layout: 'list',
            })
          )
        }
        if (alsoItems.length > 0) {
          carousels.push(
            createCarouselResult(`discovery-also-${Date.now()}`, alsoItems, {
              title: 'Also worth checking',
              layout: 'carousel',
            })
          )
        }

        if (carousels.length === 0) {
          carousels.push(
            createCarouselResult(`discovery-empty-${Date.now()}`, [], {
              description:
                notInLibraryTitles.length > 0
                  ? 'None of the web-sourced picks are in your library yet.'
                  : 'No web-sourced picks were found for this request.',
            })
          )
        }

        return { carousels, picks, notInLibrary: notInLibraryTitles }
      },
    }),
  }
}
