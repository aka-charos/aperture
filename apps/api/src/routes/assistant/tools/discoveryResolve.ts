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
 * Three sections come back from the one call, all deduped against each other:
 * - "Recommendations" — the web-sourced picks, matched to the library.
 * - "Also worth checking" — embeddings neighbours of `seedTitle`, when the
 *   request named a title.
 * - "From your taste profile" — the user's own scored pool, ranked taste-first.
 *   Unconditional, and started concurrently with the web gather so it costs no
 *   wall clock; it is what makes a turn with thin or failed web results still
 *   answer with something personal, without the model having to notice and
 *   decide to go looking.
 *
 * They draw on one library from three directions, so overlap is the normal case
 * and the dedupe is load-bearing rather than defensive.
 *
 * Limits the request states ("a film", "unwatched", "under 90 minutes") hold on
 * all three. The web picks are checked once they have library rows, since nothing
 * is known about them before that; the other two search under the limits, so a
 * narrow one still fills them. The result says what the limits emptied.
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
import { enrichCardReasonsProgressive } from '../discovery/enrichReasons.js'
import { filterItemsToScope } from '../helpers/libraryScope.js'
import { filterUnwatchedItems } from '../helpers/unwatched.js'
import { normalizeTitle } from '../helpers/titleMatch.js'
import { findSimilarItems } from './search.js'
import { hasCompletedRun, searchScoredPool } from './scoredPool.js'
import { TASTE_SECTION_QUERY_WEIGHT } from './tasteBlend.js'
import {
  describeTitleLimits,
  discoveryLimitsNote,
  joinNotes,
  mediaTypesOf,
  readTitleLimits,
  TITLE_LIMIT_PARAMS,
} from './titleLimits.js'
import { itemsWithinLimits, resolveTitleLimits } from './titleLimitsQuery.js'
import type { ContentItem } from '../schemas/index.js'
import type { ToolContext } from '../types.js'

const logger = createChildLogger('discovery-resolve')

/**
 * How many embeddings neighbours to fetch for "Also worth checking", before
 * deduping against the web picks. Also the ceiling when they are promoted to
 * the primary answer, which happens when web search returned nothing usable.
 */
const SUPPLEMENT_POOL = 12
/**
 * How many survive when they are only a supplement. They are neighbours of the
 * SEED, not answers to the question, so past a handful they stop adding and
 * start burying — and each one costs a note the writing model has to pay for.
 */
const SUPPLEMENT_MAX = 6

/**
 * How many taste-section rows to fetch before deduping against the other two
 * sections. Headroom, not a display count — the scored pool overlaps the web
 * matches and the seed's neighbours by construction, so fetching the display
 * count would routinely render fewer.
 */
const TASTE_POOL = 24
/**
 * How many survive to the screen. Six for the same reason SUPPLEMENT_MAX is
 * six: it is a second opinion under the answer, not a second answer. It also
 * keeps the section inside ONE `enrichCardReasons` batch (BATCH_SIZE is 8), so
 * the marginal cost of the whole feature is one model call per turn.
 */
const TASTE_MAX = 6

/**
 * Loose title key for comparing a candidate against the referenced seed title.
 * Shared so that dropping a seed echo, deduping cards and matching the library
 * all fold accents identically — "Le Samouraï" and "Le Samourai" are one film.
 */
const normalizeTitleKey = normalizeTitle

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
  'findCandidatesInLibrary returns up to THREE sections in the one call, and they never share ' +
  'a title: "Recommendations" (web-sourced, the primary picks), "Also worth checking" (library ' +
  'titles close to seedTitle), and "From your taste profile" (drawn from this user\'s own ' +
  'recommendation scores rather than from the web). Lead on the web picks; the other two are ' +
  'worth a mention, not the headline. Do NOT call searchMyRecommendations afterwards — the ' +
  'taste section already IS that search, run in parallel, and calling it again just repeats ' +
  'the same list under a second heading. If findCandidatesInLibrary returns no cards at all, ' +
  'fall back to getTopRated or getMyRecommendations so the user still gets picks. Only present ' +
  'titles these tools return — never invent titles.\n' +
  'HARD LIMITS: when the request states a limit, pass it to findCandidatesInLibrary: genre, ' +
  'yearMin/yearMax, minRating, maxRuntime, type ("film" = movies, "show" = series) and ' +
  'watchStatus ("unwatched", "that I haven\'t seen"). They are enforced on all three sections. ' +
  'Pass only what the user actually asked for. When the result carries limitsNote, it overrides ' +
  'the fallback above: do not reach for getTopRated, getUnwatched, getMyRecommendations or any ' +
  'other list tool, which do not know these limits, and tell the user plainly what its note says.'

export function createDiscoveryResolveTool(ctx: ToolContext, queryText: string) {
  return {
    findCandidatesInLibrary: tool({
      description:
        "Gather web-sourced recommendation candidates for this request and match them to the user's library, returning them as the primary 'Recommendations'. When a specific title is referenced via seedTitle, also add embeddings-similar library picks as 'Also worth checking'. Always also returns 'From your taste profile' — the same personalized in-library search searchMyRecommendations performs, run in parallel here, so that tool does not need calling afterwards. The three sections never share a title. Call this exactly ONCE, first. Everything returned is IN the library — titles the library does not have are dropped and must never be mentioned. Each pick includes a short 'reason' that is already shown on its card — synthesize a short closing note rather than repeating them per title. Only present what this tool returns — never invent titles. Limits stated in the request (genre, years, minimum rating, maximum runtime, film or show, unwatched) go in their parameters and hold on all three sections; limitsNote reports what they left out.",
      inputSchema: nullSafe(z.object({
        seedTitle: z
          .string()
          .optional()
          .describe(
            'If the request references a specific title (e.g. "movies similar to X"), the title X — used to add embeddings-based related picks from the library.'
          ),
        type: z
          .enum(['movies', 'series', 'both'])
          .optional()
          .default('both')
          .describe('Only films ("movies") or only shows ("series"), when the request says which.'),
        watchStatus: z
          .enum(['all', 'unwatched'])
          .optional()
          .default('all')
          .describe('"unwatched" when the request asks only for titles the user has not played.'),
        ...TITLE_LIMIT_PARAMS,
      })),
      // A generator, not an async function: every value it yields reaches the
      // client as a preliminary tool result, and the LAST one it yields is the
      // real output — what the model reads and what the client persists. That is
      // what lets the cards appear as soon as they are resolved instead of after
      // the reason rewrite, which on a measured turn was 115 of its 138 seconds.
      // See helpers/toolStream.ts for what this costs the wrapper layer.
      execute: async function* ({ seedTitle, type = 'both', watchStatus = 'all', ...limitParams }) {
        const limits = await resolveTitleLimits(ctx.scope, readTitleLimits(limitParams), type)
        const wantedMedia: string[] = mediaTypesOf(type)
        const unwatchedOnly = (ctx.excludeWatched ?? false) || watchStatus === 'unwatched'
        // In the words the note to the model uses. The composer's own toggle is
        // not listed: the user set it, not this request, and it has its own card.
        const statedLimits = [
          describeTitleLimits(limits.limits),
          type === 'movies' ? 'films only' : type === 'series' ? 'shows only' : '',
          watchStatus === 'unwatched' ? 'not yet played' : '',
        ]
          .filter(Boolean)
          .join('; ')
        // This one tool call runs nine sequential stages, several of them slow, so
        // it reports its own sub-phases — the per-tool status wrapper only ever
        // sees "entering findCandidatesInLibrary".
        const onStatus = ctx.onStatus
        onStatus?.('discoveryScouting')
        // The viewer profile for this turn. It is applied in the STRUCTURING
        // pass, not the web search — see webCandidates.ts. Fetched here rather
        // than in webCandidates so the network work stays in the tool boundary;
        // fails soft to null, which restores un-personalized behaviour.
        const tasteBrief = await buildTasteBrief(ctx.userId)

        // The taste section, started here and awaited far below.
        //
        // It shares nothing with the web pipeline — a different index, a
        // different ranking, no network call to a search provider — so running
        // it concurrently hides its embed + ANN + join entirely underneath the
        // web gather, which is the slowest stage of the turn by a wide margin.
        //
        // It searches `queryText`, the user's OWN words, where the tool version
        // searches a `concept` the model paraphrased first. There is no
        // paraphrase step here to go wrong, which is the one respect in which
        // this section is more faithful to the request than the tool is.
        //
        // Fails open to nothing: a turn that produced good web picks must not
        // fail over its secondary strip.
        let tasteFailed = false
        const tastePromise = searchScoredPool(ctx, {
          concept: queryText,
          type,
          limit: TASTE_POOL,
          queryWeight: TASTE_SECTION_QUERY_WEIGHT,
          limits,
          unwatchedOnly,
          caller: 'discovery',
        }).catch((err) => {
          logger.warn({ err }, 'Taste section failed; continuing without it')
          tasteFailed = true
          return [] as ContentItem[]
        })

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

        // Everything counted against the limits below is what this viewer may open:
        // a title in a closed library answers as one the library does not have, so
        // it must not turn up in a count of what the limits left out. Without limits
        // nothing is counted, and the outer wrapper does this as it always did.
        const visibleItems = statedLimits
          ? await filterItemsToScope(ctx.scope, resolved.items)
          : resolved.items

        // The request's own limits. Here because this is the first point a web
        // pick is a library row with a runtime and a rating to read.
        const fittingItems = await itemsWithinLimits(
          visibleItems.filter((i) => wantedMedia.includes(i.type)),
          limits
        )

        // "Unwatched only" (composer toggle, or the request itself): drop watched
        // titles here, before the enrichment pass, so we neither pay to write notes
        // for cards that are about to disappear nor leak them into `picks`.
        const webItems = unwatchedOnly
          ? await filterUnwatchedItems(ctx.userId, fittingItems)
          : fittingItems

        // The library's answer rate for this request, which nothing recorded
        // before: a turn that shipped four cards out of eleven web picks looked
        // from the log exactly like a turn that found four, and the only way to
        // tell them apart was counting posters in a screenshot. `matched` is
        // also the number the model reads when it decides whether to supplement,
        // so it belongs next to the decision it drives.
        logger.info(
          {
            candidates: candidates.length,
            matched: resolved.items.length,
            notInLibrary: resolved.notInLibrary.length,
            droppedByLimits: visibleItems.length - fittingItems.length,
            droppedAsWatched: fittingItems.length - webItems.length,
          },
          'Discovery candidates resolved against the library'
        )

        // Secondary section: embeddings-similar to the referenced title, deduped
        // against the web picks so nothing appears twice. Only when a title was given.
        let alsoItems: ContentItem[] = []
        // What the note says about this section. A seed the library does not hold,
        // or one with no embedding, had nothing to do with the limits. Not found
        // under a stated type is reported, since that may be the type's doing.
        let seedSection: { found: number | null; emptiedByLimits: boolean } | null = null
        if (seedTitle?.trim()) {
          onStatus?.('discoveryRelated')
          try {
            const webIds = new Set(webItems.map((i) => i.id))
            const sim = await findSimilarItems(ctx, seedTitle.trim(), {
              // The stated type settles a seed that matches both a film and a show,
              // which otherwise resolves to neither.
              type: type === 'both' ? undefined : type,
              limit: SUPPLEMENT_POOL,
              excludeWatched: unwatchedOnly,
              limits,
            })
            if (sim.foundTitle && !sim.noEmbedding) {
              seedSection = { found: null, emptiedByLimits: sim.items.length === 0 }
            } else if (!sim.foundTitle && type !== 'both') {
              seedSection = { found: 0, emptiedByLimits: false }
            }
            // How many survive depends on the job they are doing. As a
            // SUPPLEMENT they are capped: a request answered by four direct
            // homages ended up with ten nearest-neighbours-of-the-seed stacked
            // under them, and once the notes got good enough to read, they said
            // so themselves — The Count of Monte Cristo came back captioned
            // "this Dumas revenge thriller possesses no vampire mythology".
            // With no web picks at all they are PROMOTED to the whole answer
            // (see below), and the whole answer should not be six.
            alsoItems = sim.items
              .filter((i) => !webIds.has(i.id))
              .slice(0, webItems.length > 0 ? SUPPLEMENT_MAX : SUPPLEMENT_POOL)
          } catch (err) {
            logger.warn({ err }, 'Embeddings supplement failed; continuing with web results only')
          }
        }

        // Third section: the user's own scored pool, ranked taste-first.
        //
        // Deduped against BOTH sections above, and against the seed itself. The
        // three draw on one library from three directions, so overlap is the
        // normal case, not the edge case — the same film under two headings
        // with two different notes reads as a bug.
        //
        // Watched titles are dropped BEFORE the slice, in the query, not after.
        // The pool excludes what was watched as of the last recommendation run,
        // which may be days old, and the outer `withUnwatchedFilter` only strips
        // the finished result — so filtering late would silently return two cards
        // where six were asked for, and pay for notes on the four that vanish.
        const shownIds = new Set([...webItems, ...alsoItems].map((i) => i.id))
        const tastePool = await tastePromise
        const tasteItems = tastePool
          .filter((i) => !shownIds.has(i.id))
          .filter((i) => !seedKey || normalizeTitleKey(i.name) !== seedKey)
          .slice(0, TASTE_MAX)

        logger.info(
          {
            fetched: tastePool.length,
            shown: tasteItems.length,
            dedupedAgainst: shownIds.size,
            queryWeight: TASTE_SECTION_QUERY_WEIGHT,
          },
          'Discovery taste section resolved'
        )

        const combined = [...webItems, ...alsoItems, ...tasteItems]

        // What the limits did, for the model to pass on. Absent without limits.
        // `found` is only knowable for the web picks: the other two searched under
        // the limits, so there is no list they were cut from. For those, an empty
        // search under limits is put down to the limits unless something else
        // explains it. A section whose cards all went to another is not empty.
        const webEmptied =
          visibleItems.length > 0 &&
          (fittingItems.length === 0 || (webItems.length === 0 && watchStatus === 'unwatched'))
        const tasteEmptied =
          statedLimits !== '' &&
          tastePool.length === 0 &&
          !tasteFailed &&
          (await hasCompletedRun(ctx.userId, type))
        const limitsEmptiedAny =
          webEmptied || tasteEmptied || seedSection?.emptiedByLimits === true
        const limitsNote = joinNotes(
          statedLimits
            ? discoveryLimitsNote(statedLimits, [
                {
                  label: 'Web picks',
                  found: visibleItems.length,
                  shown: webItems.length,
                  emptiedByLimits: webEmptied,
                },
                ...(seedSection
                  ? [{ label: `Close to ${seedTitle?.trim()}`, shown: alsoItems.length, ...seedSection }]
                  : []),
                {
                  label: 'From the taste profile',
                  found: null,
                  shown: tasteItems.length,
                  emptiedByLimits: tasteEmptied,
                },
              ])
            : null,
          limits.ignoredGenreNote
        )
        // On the first section shown, because a section with no cards gets no tab.
        const droppedByLimits = visibleItems.length - fittingItems.length
        // One stamp for the whole turn. These ids are React keys on the client,
        // so a fresh Date.now() per emission would remount the entire list on
        // every progress update instead of rewriting the notes in place.
        const stamp = Date.now()

        /** The tool's output for a given state of the cards. */
        const build = (cards: ContentItem[]) => {
          // `combined` is three concatenated sections and the enrichment pass
          // preserves order and length, so the offsets split them back out.
          const alsoStart = webItems.length
          const tasteStart = alsoStart + alsoItems.length
          const webCards = cards.slice(0, alsoStart)
          const alsoCards = cards.slice(alsoStart, tasteStart)
          const tasteCards = cards.slice(tasteStart)

          // Per-pick rationale: grounding for the model's closing synthesis. Keyed
          // off the CARDS, so whatever the pipeline dropped — not in the library,
          // already watched — can never reach the model as something to talk about.
          const enrichedByTitle = new Map(
            [...webCards, ...alsoCards, ...tasteCards]
              .filter((i) => i.reason)
              .map((i) => [normalizeTitleKey(i.name), i.reason as string])
          )
          const shownTitleKeys = new Set(
            [...webCards, ...alsoCards, ...tasteCards].map((i) => normalizeTitleKey(i.name))
          )
          const picks = candidates
            .filter((c) => shownTitleKeys.has(normalizeTitleKey(c.title)))
            .map((c) => ({
              title: c.title,
              year: c.year,
              reason: enrichedByTitle.get(normalizeTitleKey(c.title)) ?? c.reason,
            }))

          const carousels: ContentCarousel[] = []
          if (webCards.length > 0) {
            // Web picks carry a per-title reason + synopsis → render as the rich
            // vertical list, with the embeddings section as a secondary carousel.
            carousels.push(
              createCarouselResult(`discovery-${stamp}`, webCards, {
                title: 'Recommendations',
                layout: 'list',
              })
            )
            if (alsoCards.length > 0) {
              carousels.push(
                createCarouselResult(`discovery-also-${stamp}`, alsoCards, {
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
            // enrichment pass above (the embeddings search itself provides none),
            // so they take the vertical list the same way the web picks would
            // have: they are the whole answer here, not a strip beside one.
            carousels.push(
              createCarouselResult(`discovery-similar-${stamp}`, alsoCards, {
                title: seedTitle?.trim() ? `Similar to ${seedTitle.trim()}` : 'Recommendations',
                layout: 'list',
              })
            )
          }

          if (tasteCards.length > 0) {
            // Secondary by default — a strip you glance at under the answer you
            // read, which is what a horizontal carousel is actually for. It
            // becomes the vertical list only when it is the ONLY section, where
            // it stops being a sidebar and starts being the answer.
            const isOnlySection = carousels.length === 0
            carousels.push(
              createCarouselResult(`discovery-taste-${stamp}`, tasteCards, {
                title: 'From your taste profile',
                layout: isOnlySection ? 'list' : 'carousel',
              })
            )
          }

          if (carousels.length === 0) {
            // The all-watched case is a distinct outcome from an empty search —
            // saying "nothing found" there would be misleading.
            const allWatched = fittingItems.length > 0 && webItems.length === 0
            carousels.push(
              createCarouselResult(
                `discovery-empty-${stamp}`,
                [],
                limitsEmptiedAny
                  ? { descriptionKey: 'carouselLimitsNoneFit' }
                  : {
                      description: allWatched
                        ? 'Every match for this request has already been watched.'
                        : notInLibrary.length > 0
                          ? 'None of the web-sourced picks are in the library.'
                          : 'No web-sourced picks were found for this request.',
                    }
              )
            )
          } else if (droppedByLimits > 0) {
            carousels[0].descriptionKey = 'carouselLimitsDropped'
            carousels[0].descriptionParams = { dropped: droppedByLimits }
          }

          // Deliberately NOT returning the unmatched titles: anything the model can
          // see, it will eventually mention, and nothing outside the library should
          // ever reach the user.
          return { carousels, picks, ...(limitsNote ? { limitsNote } : {}) }
        }

        // The cards are already readable: every web pick carries the note the
        // structuring pass wrote for it. Everything after this only improves
        // those notes, so ship the list now rather than holding all of it back
        // for the slowest stage in the turn.
        onStatus?.('discoveryAssembling')
        let cards = combined
        yield build(cards)

        // Rewrite the per-title notes so they read like insight instead of condensed
        // search copy. BOTH sections go through one call: the embeddings picks carry
        // no rationale of their own, which is why "Also worth checking" used to show
        // bare cards next to fully-explained ones. Order/length are preserved, so the
        // two lists split back out cleanly. Fails open to the original notes.
        onStatus?.('discoveryReasons')
        for await (const partial of enrichCardReasonsProgressive(combined, queryText, ctx.userId)) {
          cards = partial
          yield build(cards)
        }

        // The final yield is the output proper — the one the model reasons from
        // and the one the client saves. It has to happen even when enrichment
        // yielded nothing at all, which is why it is not folded into the loop.
        yield build(cards)
      },
    }),
  }
}
