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
import { enrichCardReasons } from '../discovery/enrichReasons.js'
import { findSimilarItems } from './search.js'
import type { ContentItem } from '../schemas/index.js'
import type { ToolContext } from '../types.js'

const logger = createChildLogger('discovery-resolve')

/** Loose title key for comparing a candidate against the referenced seed title. */
function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

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
  '3. AFTER the cards render, ALWAYS write a closing note (3-6 sentences). This is required — ' +
  'never stop at the cards. Do NOT enumerate every title. Instead go DEEP on 2-3 standouts: ' +
  'name them and say something substantive about why they fit — the specific device, tone or ' +
  'idea they share with the request, which one to start with and what to expect from it. ' +
  'Concrete and confident, never hedged ("is often described as", "critics have noted"). ' +
  'Then mention any notable titles from the returned notInLibrary list worth adding.\n' +
  'If the tool returns a "Similar to …" list instead of "Recommendations" (web picks were ' +
  'unavailable), treat those as your recommendations: write the same opener and closing about ' +
  'them as the closest matches in the library — seamlessly, without mentioning that web search ' +
  'was unavailable.\n' +
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
        const gathered = await gatherWebCandidates(queryText)

        // "movies like X" must never recommend X back. Web sources list the seed
        // itself routinely (sometimes with a wrong year, so match on title only).
        const seedKey = seedTitle?.trim() ? normalizeTitleKey(seedTitle) : ''
        const candidates = seedKey
          ? gathered.filter((c) => normalizeTitleKey(c.title) !== seedKey)
          : gathered

        logger.info(
          {
            candidateCount: candidates.length,
            seedEchoesDropped: gathered.length - candidates.length,
            seedTitle: seedTitle ?? null,
          },
          'Discovery candidates gathered'
        )
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

        // Rewrite the notes on whichever list is PRIMARY — the one whose per-title
        // "why" is displayed prominently — so they read like insight instead of
        // condensed search copy. One call on a writing model; fails open to the
        // extractive notes. The embeddings fallback list has no notes at all, so
        // this is also what gives it a "why" when web search came back empty.
        const primaryItems = webItems.length > 0 ? webItems : alsoItems
        const enrichedPrimary = await enrichCardReasons(primaryItems, queryText)
        const webCards = webItems.length > 0 ? enrichedPrimary : webItems
        const alsoCards = webItems.length > 0 ? alsoItems : enrichedPrimary

        // Per-pick rationale: grounding for the model's closing synthesis. Prefers
        // the enriched note so the model's callouts match what the cards say.
        const enrichedByTitle = new Map(
          webCards
            .filter((i) => i.reason)
            .map((i) => [normalizeTitleKey(i.name), i.reason as string])
        )
        const notInLibrarySet = new Set(notInLibrary)
        const picks = candidates.map((c) => ({
          title: c.title,
          year: c.year,
          reason: enrichedByTitle.get(normalizeTitleKey(c.title)) ?? c.reason,
          inLibrary: !notInLibrarySet.has(c),
        }))

        const carousels: ContentCarousel[] = []
        if (webCards.length > 0) {
          // Web picks carry a per-title reason + synopsis → render as the rich
          // vertical list, with the embeddings section as a secondary carousel.
          carousels.push(
            createCarouselResult(`discovery-${Date.now()}`, webCards, {
              title: 'Recommendations',
              layout: 'list',
            })
          )
          if (alsoCards.length > 0) {
            carousels.push(
              createCarouselResult(`discovery-also-${Date.now()}`, alsoCards, {
                title: 'Also worth checking',
                layout: 'carousel',
              })
            )
          }
        } else if (alsoCards.length > 0) {
          // Web search yielded nothing (rate limit / empty grounding), but a seed
          // title gave us embeddings-similar picks — promote them to the PRIMARY
          // section so "movies like X" still returns a coherent answer instead of
          // an orphaned "Also worth checking". These cards get their "why" from the
          // enrichment pass above (the embeddings search itself provides none).
          carousels.push(
            createCarouselResult(`discovery-similar-${Date.now()}`, alsoCards, {
              title: seedTitle?.trim() ? `Similar to ${seedTitle.trim()}` : 'Recommendations',
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
