/**
 * Pages that answer nothing, dropped before they reach the prompt.
 *
 * WHY THIS EXISTS. ./blockedPage.ts drops a page the scraper was REFUSED; this
 * drops a page the scraper fetched successfully and which is worth nothing
 * anyway. Measured on the Requiem for a Dream bench, where eight documents
 * carried 63,953 characters and three of them were:
 *
 *   itsreleased.co.uk  8,607 chars of site navigation - Singapore influencer
 *                      marketing, FRM course fees, IPTV hardware - and not one
 *                      sentence about the film. 13% of the whole budget.
 *   arcplot.com        an "Arcplot Score", MBTI types and Enneagram wings per
 *                      character, and story-structure tags. One model copied
 *                      its tooltip text into the analysis nearly verbatim
 *                      ("a rite of passage in which each person undergoes a
 *                      painful transition through a universal life experience"),
 *                      which is exactly what the prompt's "never copy the genre
 *                      labels or mood tags a listing page attaches" forbids.
 *   shapes.inc         generated "Deep Dives" with invented Counterpoints,
 *                      which one model promoted to "Some critics faulted…".
 *
 * THE PROMPT CANNOT FIX THIS AND SHOULD STOP BEING ASKED TO. Its source rule
 * names user reviews, fan wikis, study guides, essay sites and listing pages;
 * a generated analysis site matches none of those labels by name and presents
 * as authoritative, with section headings, percentages and an Evidence block.
 * A rule the model must apply by reading is the thing every bench so far has
 * found it applying wrongly - and the budget it spends is spent whether or not
 * the model then ignores the page.
 *
 * TWO MECHANISMS, DELIBERATELY DIFFERENT. A DOMAIN is a judgement made once by
 * a person who read the page; SHAPE is measured per fetch and catches the ones
 * nobody has seen yet. Neither guesses at quality from the writing.
 *
 * IT FAILS OPEN. If dropping would leave nothing, nothing is dropped: a thin
 * retrieval that reaches the floor and is honestly declined is a better outcome
 * than a thrown title, and this module must never be the reason a film with
 * only weak coverage gets no analysis at all.
 *
 * PURE AND DB-FREE, like ./blockedPage.ts and ./duplicateSources.ts, which it
 * runs beside.
 */

/** Why a page was dropped, for the log line naming it. */
export type LowValueReason = 'listed-domain' | 'navigation'

export interface QualitySource {
  domain: string
  text: string
}

export interface DroppedSource {
  domain: string
  reason: LowValueReason
}

/**
 * Domains that have been read and found to answer nothing about any film.
 *
 * EVERY ENTRY WAS SEEN IN A RETRIEVAL, never guessed at from a name - the same
 * discipline as ./blockedPage.ts's wall phrases. A site joins this list when it
 * has reached a bench and been read, and the note says what it served.
 *
 * Matched on the registrable domain and any subdomain of it, so `www.` and a
 * regional prefix are covered, and `notarcplot.com` is not.
 */
export const LOW_VALUE_DOMAINS: readonly { domain: string; note: string }[] = [
  { domain: 'arcplot.com', note: 'story-structure tags, MBTI and Enneagram labels per character' },
  { domain: 'shapes.inc', note: 'generated analysis with invented counterpoints' },
  { domain: 'moviesense.io', note: 'generated analysis with percentage-weighted themes' },
  { domain: 'itsreleased.co.uk', note: 'content farm; retrieved text is site navigation' },
]

const listed = (domain: string): boolean => {
  const host = domain.trim().toLowerCase().replace(/^www\./, '')
  return LOW_VALUE_DOMAINS.some(
    (entry) => host === entry.domain || host.endsWith(`.${entry.domain}`)
  )
}

/**
 * Whether a line is nothing but links.
 *
 * Decided by REMOVAL rather than by one pattern: a thumbnail row is an image
 * inside a link inside a list bullet with a title attribute after it, and a
 * single regex describing that shape misses the next variant of it. Strip the
 * bracketed and parenthesised runs until nothing nests, and a menu line comes
 * out empty while a sentence comes out as its words.
 */
function isLinkOnlyLine(line: string): boolean {
  if (!line.includes('](')) return false
  let rest = line
  for (let pass = 0; pass < 3; pass += 1) {
    rest = rest.replace(/\([^()]*\)/g, '').replace(/\[[^[\]]*\]/g, '')
  }
  return rest.replace(/[!\-*+|:"'\s]/g, '').length === 0
}

/**
 * Below this many link-only lines, a page is short enough that the ratio says
 * nothing - a three-line stub is not a navigation page.
 */
const MIN_LINK_LINES = 20

/** Above this share of its non-empty lines, a page is a menu. */
const NAVIGATION_LINE_SHARE = 0.6

/**
 * Whether a fetched page is a navigation menu rather than an article.
 *
 * MEASURED ON LINES, NOT ON LINK DENSITY, and the difference is load-bearing.
 * Wikipedia's markdown is more than half link characters - every proper noun in
 * every sentence is one - so a link-character ratio drops the best document in
 * the set. What separates a menu is that its links stand ALONE: link, newline,
 * link. A prose paragraph containing six links is still one line of prose.
 *
 * Both conditions are required, for ./blockedPage.ts's reason: a page that is
 * genuinely a short list of links is rare, and losing a real article to a
 * heuristic costs more than keeping a menu the model will ignore.
 */
export function isNavigationPage(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) return false
  const linkOnly = lines.filter(isLinkOnlyLine).length
  return linkOnly >= MIN_LINK_LINES && linkOnly >= lines.length * NAVIGATION_LINE_SHARE
}

/**
 * Drop the pages worth nothing, keeping everything if that would be all of them.
 */
export function dropLowValueSources<T extends QualitySource>(
  sources: readonly T[]
): { kept: T[]; dropped: DroppedSource[] } {
  const dropped: DroppedSource[] = []
  const kept = sources.filter((source) => {
    if (listed(source.domain)) {
      dropped.push({ domain: source.domain, reason: 'listed-domain' })
      return false
    }
    if (isNavigationPage(source.text)) {
      dropped.push({ domain: source.domain, reason: 'navigation' })
      return false
    }
    return true
  })

  // Fails open: see the header. A retrieval made entirely of listed domains is
  // a fact about how little has been written about the title, and the floor is
  // what should say so.
  if (kept.length === 0) return { kept: [...sources], dropped: [] }
  return { kept, dropped }
}
