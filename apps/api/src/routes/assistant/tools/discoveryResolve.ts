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
import { nullSafe } from './utils.js'
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
  'ALWAYS call findCandidatesInLibrary first (exactly once) — it produces the primary, ' +
  'reasoned recommendations, even for an open genre/theme/"best of" browse. If the request ' +
  'is about titles similar to a specific movie or show (e.g. "similar to X", "something like ' +
  'X"), pass that title as seedTitle so the tool can add related picks from the library. ' +
  'The tool returns a "picks" list with a short "reason" per title (grounded from the web ' +
  'search) — that is your grounding for WHY these fit. Draw on those reasons in your reply. ' +
  'But each per-title reason and synopsis is ALSO rendered on its card, so do NOT restate them ' +
  'as a bulleted per-title list — that would duplicate the cards. Instead, synthesize the ' +
  'reasons into a short intro (one or two sentences) that frames why this set fits the request, ' +
  'then briefly note any standout titles that are NOT in the library yet. Keep it concise. ' +
  'For a genre, theme, or "best of" browse you MAY ALSO call getTopRated (passing the genre) ' +
  'AFTER findCandidatesInLibrary, to add a broader in-library list as a secondary section. ' +
  'The web "Recommendations" cards are always the primary picks; "Also worth checking" and any ' +
  'getTopRated list are secondary. Only present titles these tools return — never invent titles.'

export function createDiscoveryResolveTool(ctx: ToolContext) {
  return {
    findCandidatesInLibrary: tool({
      description:
        "Resolve the web-sourced candidate titles already gathered for this request against the user's library, and — when a specific title is referenced via seedTitle — add related picks from the library by similarity. Call this exactly ONCE. The result includes a 'picks' list with a short 'reason' per title — use those reasons as grounding for why the set fits, but do NOT restate them as a per-title list (they already render on each card). Write a short synthesized intro instead, then briefly mention any standout titles NOT in the library yet. Present the returned 'Recommendations' as the primary picks and 'Also worth checking' as secondary. Only present what this tool returns — never invent titles.",
      inputSchema: nullSafe(z.object({
        seedTitle: z
          .string()
          .optional()
          .describe(
            'If the request references a specific title (e.g. "movies similar to X"), the title X — used to add embeddings-based related picks from the library.'
          ),
      })),
      execute: async ({ seedTitle }) => {
        const candidates = ctx.discoveryCandidates ?? []
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
              description: 'None of the web-sourced picks are in your library yet.',
            })
          )
        }

        return { carousels, picks, notInLibrary: notInLibraryTitles }
      },
    }),
  }
}
