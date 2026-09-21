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
 * IT IS PURELY ADDITIVE, AND THAT IS THE WHOLE CONTRACT. The general search
 * runs first, unchanged, and keeps EVERY one of its `maxResults` results. What
 * this search finds is appended. A title with criticism written about it
 * reaches the prompt with `maxResults + curatedMaxResults` documents; a title
 * without reaches it with exactly `maxResults`, which is byte-for-byte what
 * retrieval did before this module existed.
 *
 * THE FIRST VERSION CAPPED THE MERGED LIST AT `maxResults` AND WAS WRONG.
 * Reserving half the list for criticism meant a successful curated search cut
 * the general search from six documents to three - so the feature took away
 * Wikipedia-and-friends to make room, and `maxResults` silently stopped meaning
 * "how many general results" and started meaning "total, of which an
 * unpredictable share are general". Two different questions had been folded
 * into one number, and an operator could then reason about neither. The count
 * of extra documents is `CrwConfig.curatedMaxResults`, its own setting, and 0
 * turns the search off.
 *
 * WHAT BOUNDS THE PROMPT IS `sourceBudgetChars`, NOT THE DOCUMENT COUNT.
 * ./budget.ts water-fills a fixed character budget across whatever it is given,
 * so more documents divide the same budget more ways rather than growing the
 * prompt. That is what makes "additive" affordable: the model's context does
 * not move, and each document's slice gets a little smaller.
 *
 * WHAT IT COSTS. `crwSearch` searches AND SCRAPES in one call (`scrapeOptions:
 * { formats: ['markdown'] }`), so a second search is a second round of page
 * fetches - and scraping is the expensive half, where a single slow page can
 * occupy 82.5 seconds (see `CrwConfig.timeoutMs`). Pages fetched per title go
 * from `maxResults` to `maxResults + curatedMaxResults`: at the defaults, six
 * to ten.
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
 * adding one here would spend a fetch on the material the whole source rule
 * exists to discount.
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
 * a bare title match on one of those is a fetch spent on something with nothing
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

/**
 * The two result sets as one list: criticism first, then every general result.
 *
 * NOTHING IS DROPPED FOR SPACE. There is no limit argument, because the two
 * counts were already decided when the two searches were issued - `maxResults`
 * and `curatedMaxResults` - and a cap here would silently overrule one of them,
 * which is the mistake this module's header records.
 *
 * Criticism goes first for one live reason: ./duplicateSources.ts keeps the
 * FIRST of a repeated title, so a review and an aggregator page carrying the
 * same headline resolve in favour of the review. (./budget.ts also consumes
 * documents in order, but its count cut cannot fire at any legal setting -
 * `maxKeep` is `sourceBudgetChars / 600`, far above the `maxResults` ceiling of
 * 20 - so that is not a reason, only a tiebreak if the budget is ever lowered.)
 *
 * Deduplicated by URL, falling back to the domain when a result carries none.
 * The URL is compared without its scheme, `www.` or trailing slash, because two
 * searches routinely return one article in two of those spellings and a raw
 * string comparison would keep both.
 */
export function mergeSearchResults<T extends MergeableResult>(
  curated: readonly T[],
  general: readonly T[]
): T[] {
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

  for (const result of [...curated, ...general]) {
    const id = key(result)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(result)
  }
  return out
}
