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
import { buildTasteBrief } from '../discovery/tasteBrief.js'
import { enrichCardReasons } from '../discovery/enrichReasons.js'
import { filterUnwatchedItems } from '../helpers/unwatched.js'
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
  'Concrete and confident, never hedged ("is often described as", "critics have noted").\n' +
  'HARD RULE: only ever name titles that came back on the cards. Never mention a title ' +
  'that is not in the library — not as a suggestion, not as "worth adding", not as an aside. ' +
  'If the web turned up something the library does not have, silently leave it out.\n' +
  'If the tool returns a "Similar to …" list instead of "Recommendations" (web picks were ' +
  'unavailable), treat those as your recommendations: write the same opener and closing about ' +
  'them as the closest matches in the library — seamlessly, without mentioning that web search ' +
  'was unavailable.\n' +
  'For an open genre/theme/"best of" browse you MAY also call searchMyRecommendations (passing ' +
  'the same theme as `concept`) AFTER findCandidatesInLibrary for a broader in-library list ' +
  'ranked to this user. If findCandidatesInLibrary returns no matches, fall back to ' +
  'searchMyRecommendations, then getTopRated or getMyRecommendations, so the user still gets ' +
  'picks. The web "Recommendations" cards are the primary picks; "Also worth checking" and any ' +
  'in-library list are secondary. Only present titles these tools return — never invent titles.'

export function createDiscoveryResolveTool(ctx: ToolContext, queryText: string) {
  return {
    findCandidatesInLibrary: tool({
      description:
        "Gather web-sourced recommendation candidates for this request and match them to the user's library, returning them as the primary 'Recommendations'. When a specific title is referenced via seedTitle, also add embeddings-similar library picks as 'Also worth checking'. Call this exactly ONCE, first. Everything returned is IN the library — titles the library does not have are dropped and must never be mentioned. Each pick includes a short 'reason' that is already shown on its card — synthesize a short closing note rather than repeating them per title. Only present what this tool returns — never invent titles.",
      inputSchema: nullSafe(z.object({
        seedTitle: z
          .string()
          .optional()
          .describe(
            'If the request references a specific title (e.g. "movies similar to X"), the title X — used to add embeddings-based related picks from the library.'
          ),
      })),
      execute: async ({ seedTitle }) => {
        // This one tool call runs nine sequential stages, several of them slow, so
        // it reports its own sub-phases — the per-tool status wrapper only ever
        // sees "entering findCandidatesInLibrary".
        const onStatus = ctx.onStatus
        onStatus?.('discoveryScouting')
        // The grounding call is a separate model call and never saw the system
        // prompt, so the user's taste has to be handed to it explicitly or the
        // web search runs on the bare request. Fetched here rather than in
        // webCandidates so the network work stays in the tool boundary; fails
        // soft to null, which restores the previous un-personalized behaviour.
        const tasteBrief = await buildTasteBrief(ctx.userId)
        // Gathered here (not before the stream) so the assistant's opening line
        // streams first and this slow web work runs behind the card skeletons.
        const gathered = await gatherWebCandidates(queryText, onStatus, tasteBrief)

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
        onStatus?.('discoveryMatching')
        const resolved = await resolveCandidates(candidates, ctx)
        const { notInLibrary } = resolved

        // "Unwatched only" (composer toggle): drop watched titles here, before
        // the enrichment pass, so we neither pay to write notes for cards that
        // are about to disappear nor leak them into `picks`.
        const webItems = ctx.excludeWatched
          ? await filterUnwatchedItems(ctx.userId, resolved.items)
          : resolved.items

        // Secondary section: embeddings-similar to the referenced title, deduped
        // against the web picks so nothing appears twice. Only when a title was given.
        let alsoItems: ContentItem[] = []
        if (seedTitle?.trim()) {
          onStatus?.('discoveryRelated')
          try {
            const webIds = new Set(webItems.map((i) => i.id))
            const sim = await findSimilarItems(ctx, seedTitle.trim(), {
              limit: 12,
              excludeWatched: ctx.excludeWatched ?? false,
            })
            alsoItems = sim.items.filter((i) => !webIds.has(i.id))
          } catch (err) {
            logger.warn({ err }, 'Embeddings supplement failed; continuing with web results only')
          }
        }

        // Rewrite the per-title notes so they read like insight instead of condensed
        // search copy. BOTH sections go through one call: the embeddings picks carry
        // no rationale of their own, which is why "Also worth checking" used to show
        // bare cards next to fully-explained ones. Order/length are preserved, so the
        // two lists split back out cleanly. Fails open to the original notes.
        onStatus?.('discoveryReasons')
        const enriched = await enrichCardReasons([...webItems, ...alsoItems], queryText)
        const webCards = enriched.slice(0, webItems.length)
        const alsoCards = enriched.slice(webItems.length)

        // Per-pick rationale: grounding for the model's closing synthesis. Keyed
        // off the CARDS, so whatever the pipeline dropped — not in the library,
        // already watched — can never reach the model as something to talk about.
        const enrichedByTitle = new Map(
          [...webCards, ...alsoCards]
            .filter((i) => i.reason)
            .map((i) => [normalizeTitleKey(i.name), i.reason as string])
        )
        const shownTitleKeys = new Set(
          [...webCards, ...alsoCards].map((i) => normalizeTitleKey(i.name))
        )
        const picks = candidates
          .filter((c) => shownTitleKeys.has(normalizeTitleKey(c.title)))
          .map((c) => ({
            title: c.title,
            year: c.year,
            reason: enrichedByTitle.get(normalizeTitleKey(c.title)) ?? c.reason,
          }))

        onStatus?.('discoveryAssembling')
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
          // The all-watched case is a distinct outcome from an empty search —
          // saying "nothing found" there would be misleading.
          const allWatched = resolved.items.length > 0 && webItems.length === 0
          carousels.push(
            createCarouselResult(`discovery-empty-${Date.now()}`, [], {
              description: allWatched
                ? 'Every match for this request has already been watched.'
                : notInLibrary.length > 0
                  ? 'None of the web-sourced picks are in the library.'
                  : 'No web-sourced picks were found for this request.',
            })
          )
        }

        // Deliberately NOT returning the unmatched titles: anything the model can
        // see, it will eventually mention, and nothing outside the library should
        // ever reach the user.
        return { carousels, picks }
      },
    }),
  }
}
