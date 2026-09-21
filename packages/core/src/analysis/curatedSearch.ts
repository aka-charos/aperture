/**
 * A second search, restricted to places that publish film criticism.
 *
 * WHY. Every bench so far has found the same thing from the other end: the
 * prompt is asked to weigh a generated "analysis" page against a real review,
 * and it cannot reliably tell them apart, because a generated page presents as
 * authoritative. ./sourceQuality.ts answers that by SUBTRACTION, which can only
 * ever remove what a general web search already brought back. This is the
 * addition: ask the same question again, of the publications whose words the
 * prompt actually wants.
 *
 * IT IS A SECOND SEARCH, NEVER A REPLACEMENT. The general query stays exactly
 * as it was and runs first. A site-restricted query is a hard AND across the
 * whole disjunction, so for an obscure title it very often returns nothing -
 * and on a title nobody reputable has written about, nothing is the correct
 * answer rather than a failure. The general results are what keep Wikipedia in
 * the set, which is where every checkable fact in an analysis comes from.
 *
 * THE MERGE IS BY RESERVED SLOTS, not by concatenating and truncating. The two
 * result sets are different populations - one is "the web on this title", the
 * other is "criticism on this title" - so a shared cut would let a title with
 * heavy general coverage take every slot, which is the same argument
 * similarity/crossMedia.ts makes for film-vs-series neighbours. Curated results
 * are placed FIRST within the merged list, because ./budget.ts allocates the
 * character budget in order and the pages worth reading should get it.
 *
 * WHAT IT COSTS, STATED HONESTLY. `crwSearch` searches AND SCRAPES in one call
 * (`scrapeOptions: { formats: ['markdown'] }`), so a second search is a second
 * round of page fetches, not one cheap extra request - and scraping is the
 * expensive half, where a single slow page can occupy 82.5 seconds (see
 * `CrwConfig.timeoutMs`). That is why the curated search asks for only its
 * RESERVED slots rather than a full `maxResults`: the pages fetched per title
 * go from `maxResults` to `maxResults + curatedSlots(maxResults)`, which at the
 * default share is half again rather than double. The merged list itself is
 * still capped at `maxResults`, so the prompt carries no more documents than it
 * did and nothing downstream changes size.
 *
 * PURE AND DB-FREE, like ./sourceQuality.ts and ./budget.ts around it.
 */

/**
 * Publications whose own words are the evidence the prompt asks for.
 *
 * Journals, festival and archive publications, and critics' magazines - chosen
 * because they publish ARGUED criticism under a named byline, which is exactly
 * what `SOURCE_VALUE_RULE` says to weigh above everything else. Aggregators,
 * listings, fan wikis and generated-analysis sites are deliberately absent:
 * adding one here would spend a reserved slot on the material the whole source
 * rule exists to discount.
 *
 * A path is allowed and is sometimes the point - `bfi.org.uk/sight-and-sound`
 * rather than the whole BFI site, `criterion.com/current` rather than the shop.
 */
export const CURATED_CRITICISM_SITES: readonly string[] = [
  'bfi.org.uk/sight-and-sound',
  'cinema-scope.com',
  'reverseshot.org',
  'filmcomment.com',
  'mubi.com/en/notebook',
  'criterion.com/current',
  'rogerebert.com',
  'sensesofcinema.com',
  'offscreen.com',
  'brightlightsfilm.com',
  'framescinemajournal.com',
  'filmcriticism.uw.edu',
  'mediastudies.press',
  'cineaste.com',
  'slantmagazine.com',
  'thefilmstage.com',
  'littlewhitelies.co.uk',
  'screen-slate.com',
  'indiewire.com',
  'adrianmartinfilmcritic.com',
]

/**
 * What kind of page is wanted, as a second disjunction.
 *
 * These sites also publish news, festival line-ups and release calendars, and
 * a bare title match on one of those is a slot spent on something with nothing
 * to say about the work.
 */
export const CURATED_TERMS: readonly string[] = [
  'review',
  'criticism',
  'analysis',
  'essay',
  'retrospective',
  'interview',
]

/**
 * The general query, plus the two disjunctions.
 *
 * Built from the SAME `queryText` the general search used rather than from the
 * subject again, so the two searches are provably asking about one title -
 * including `buildAnalysisQuery`'s decision about whether to append an original
 * title ([F-064](../../../docs/aperture-forensics.md)).
 */
export function buildCuratedQuery(queryText: string): string {
  const sites = CURATED_CRITICISM_SITES.map((site) => `site:${site}`).join(' OR ')
  return `${queryText} (${sites}) (${CURATED_TERMS.join(' OR ')})`
}

/** Anything with a URL and a domain — the shape a search result has. */
export interface MergeableResult {
  url?: string | null
  domain: string
}

/** Default share of the slots held for criticism before general results fill. */
export const CURATED_SLOT_SHARE = 0.5

/**
 * How many slots criticism is asked for, and therefore how many pages the
 * second search is allowed to fetch.
 *
 * ONE COPY, read by the merge AND by the caller that sizes the request. They
 * are one decision: a request larger than the reservation pays to scrape pages
 * the merge will then discard, and a request smaller than it silently makes the
 * reservation unreachable.
 *
 * FLOORED, never rounded, so criticism can never be RESERVED more than half the
 * list and the general search always keeps the rest - it is what carries
 * Wikipedia, and every checkable fact in an analysis comes from there. The
 * curated side can still take unused general slots afterwards; that is a
 * different thing from being handed them.
 *
 * At a `maxResults` of 1 this is 0, and the caller skips the second search
 * outright rather than spending a scrape on a slot that cannot be kept.
 */
export function curatedSlots(limit: number, share: number = CURATED_SLOT_SHARE): number {
  const bounded = Math.max(0, Math.floor(limit))
  return Math.max(0, Math.min(bounded, Math.floor(bounded * share)))
}

/**
 * One list from two, curated first, deduplicated, capped at `limit`.
 *
 * Slots are RESERVED rather than shared: `limit * share` go to criticism if
 * there is that much, the rest to the general search, and either side may take
 * the other's unused slots. Neither list is ordered against the other, because
 * a search rank from one query says nothing about a result from a different
 * one.
 *
 * Deduplicated by URL, falling back to the domain when a result carries none -
 * the same page reached by both searches must not occupy two slots. The URL is
 * compared without its scheme, `www.` or trailing slash, because two searches
 * routinely return one article in two of those spellings and a raw string
 * comparison would spend a second slot on it.
 */
export function mergeSearchResults<T extends MergeableResult>(
  curated: readonly T[],
  general: readonly T[],
  options: { limit: number; share?: number }
): T[] {
  const limit = Math.max(0, Math.floor(options.limit))
  if (limit === 0) return []

  const reserved = curatedSlots(limit, options.share)

  const seen = new Set<string>()
  const out: T[] = []
  const key = (r: T) => {
    const url = r.url?.trim()
    if (!url) return `domain:${r.domain.trim().toLowerCase()}`
    return url
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '')
  }

  const take = (list: readonly T[], upTo: number) => {
    for (const result of list) {
      if (out.length >= upTo) return
      const id = key(result)
      if (seen.has(id)) continue
      seen.add(id)
      out.push(result)
    }
  }

  take(curated, reserved)
  take(general, limit)
  // Whatever the general search could not fill goes back to criticism.
  take(curated, limit)
  return out
}
