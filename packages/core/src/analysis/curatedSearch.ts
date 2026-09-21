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
 * The longest query to send an engine, in characters.
 *
 * MEASURED, not guessed. DuckDuckGo refuses an over-long query outright - it
 * answers "Search query entered was too long. Please shorten and try again."
 * and CRW reports zero results, which is indistinguishable from "nothing has
 * been written about this film". All twenty sites in one query is 692
 * characters and was refused on every title; ten sites is 420 and returns the
 * Roger Ebert review of the film that started this. So the cap is somewhere
 * between 420 and 555 (fifteen sites, also refused), consistent with
 * DuckDuckGo's documented 500.
 *
 * 380 leaves real headroom under that, because THE BASE QUERY IS NOT A FIXED
 * LENGTH: `buildAnalysisQuery` appends an original title for roughly a third of
 * films, and a long title with a long original title is easily twice the
 * 79-character example these numbers were measured on. Sitting just under a
 * measured limit would make the feature work on short titles and fail silently
 * on long ones, which is the worst of both.
 *
 * It also keeps each query near ten operators, well inside any word-count
 * limit an engine may apply on top of the character one.
 */
export const CURATED_QUERY_MAX_CHARS = 380

/**
 * How many searches one title may spend on criticism.
 *
 * A guard against a pathological base query making the partition below degrade
 * into one search per site. With an ordinary query the twenty sites fit in two
 * or three, so this never binds; when it does bind, the surplus sites are
 * DROPPED rather than issued, because twenty searches per title across a
 * library is the kind of traffic that gets an engine to start refusing
 * everything.
 */
export const CURATED_MAX_QUERIES = 4

/**
 * The curated search, split into as many queries as the site list needs.
 *
 * ONE QUERY WAS THE ORIGINAL DESIGN AND IT DID NOT WORK. See
 * `CURATED_QUERY_MAX_CHARS`: the whole disjunction is far past what an engine
 * accepts, and the refusal arrives as an empty result set rather than as an
 * error, so the feature reported "nothing found" on every title in the library
 * while never having run a successful search at all.
 *
 * Each query is built from the SAME `queryText` the general search used rather
 * than from the subject again, so every one of them is provably asking about
 * one title - including `buildAnalysisQuery`'s decision about whether to append
 * an original title ([F-064](../../../docs/aperture-forensics.md)).
 *
 * Partitioned greedily in list order, so a site's neighbours in
 * `CURATED_CRITICISM_SITES` are the ones it shares a query with. That ordering
 * is not arbitrary - it decides which publications compete with each other for
 * that query's slots.
 */
export function buildCuratedQueries(queryText: string): string[] {
  const terms = `(${CURATED_TERMS.join(' OR ')})`
  const queries: string[] = []
  let batch: string[] = []

  // The cost of a query carrying `batch` plus one more operator.
  const lengthWith = (extra: string) =>
    `${queryText} (${[...batch, extra].join(' OR ')}) ${terms}`.length

  for (const site of CURATED_CRITICISM_SITES) {
    const operator = `site:${site}`
    if (batch.length > 0 && lengthWith(operator) > CURATED_QUERY_MAX_CHARS) {
      queries.push(`${queryText} (${batch.join(' OR ')}) ${terms}`)
      batch = []
      if (queries.length >= CURATED_MAX_QUERIES) return queries
    }
    batch.push(operator)
  }
  // A single operator that cannot fit is emitted anyway: one site is the
  // smallest unit there is, and a query the engine refuses is a better signal
  // than a site silently dropped.
  if (batch.length > 0) queries.push(`${queryText} (${batch.join(' OR ')}) ${terms}`)
  return queries.slice(0, CURATED_MAX_QUERIES)
}

/**
 * How many results to ask each query for, totalling exactly `total`.
 *
 * EXACT, never `ceil` per query. Asking each of three queries for `ceil(4/3)`
 * is six scrapes to fill four slots, and `crwSearch` scrapes what it finds, so
 * that is two pages fetched and paid for and then discarded on every title.
 * The remainder goes to the earliest queries, which hold the sites listed
 * first.
 *
 * A query allotted 0 is not issued at all by the caller.
 */
export function distributeCuratedResults(total: number, queries: number): number[] {
  if (queries <= 0 || total <= 0) return []
  const base = Math.floor(total / queries)
  const remainder = total % queries
  return Array.from({ length: queries }, (_, i) => base + (i < remainder ? 1 : 0))
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
