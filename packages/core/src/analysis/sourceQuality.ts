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
 * FOUR MECHANISMS, DELIBERATELY DIFFERENT. A DOMAIN is a judgement made once by
 * a person who read the page; SHAPE is measured per fetch and catches the ones
 * nobody has seen yet. Neither guesses at quality from the writing. Shape is
 * two tests, because the second Requiem bench found a page neither the domain
 * list nor the line-share test could see - a wall of review cards whose links
 * each span seven lines - and what it lacked was a SENTENCE. The fourth is a
 * size floor, which names a failed scrape as what it is rather than letting 11
 * characters reach the prompt as a numbered document.
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
export type LowValueReason = 'listed-domain' | 'navigation' | 'no-prose' | 'empty'

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
 *
 * AN UNPAIRED BRACKET IS PUNCTUATION, NOT CONTENT. `[` and `]` were missing
 * from the final strip, so a line opening a link that CLOSES further down the
 * page - `[![Caught Stealing](poster.jpg)`, the first line of every card on
 * rogerebert.com's director index - left a lone `[` behind and read as a line
 * with content in it. Measured on the Requiem for a Dream bench, where that
 * page took one of the two curated criticism slots.
 */
export function isLinkOnlyLine(line: string): boolean {
  if (!line.includes('](')) return false
  let rest = line
  for (let pass = 0; pass < 3; pass += 1) {
    rest = rest.replace(/\([^()]*\)/g, '').replace(/\[[^[\]]*\]/g, '')
  }
  return rest.replace(/[![\]\-*+|:"'\s]/g, '').length === 0
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
 * Below this many characters a fetch returned nothing, whatever it says.
 *
 * Deliberately far below any real page rather than at the edge of one: the
 * measured case is a New York Times review that arrived as 11 characters - its
 * own domain - and reached the prompt as a numbered document. Its own reason,
 * because "the scrape came back empty" is a fault in RETRIEVAL and "this page
 * has no prose in it" is a fact about the page, and the log line is where an
 * operator finds out a criticism source is silently failing to fetch.
 */
export const MIN_USEFUL_CHARS = 200

/** Words a line needs before a full stop in it means a sentence. */
const MIN_PROSE_WORDS = 12

/** Below this many sentence-like lines, a page full of links is a menu. */
const MIN_PROSE_LINES = 3

/**
 * A line that could be a sentence: enough words, and something ending one.
 *
 * The URL is removed and the link TEXT kept, unlike {@link isLinkOnlyLine}:
 * here the words inside `[…]` are prose and only the `(…)` after them is
 * machinery. Wikipedia's opening sentence names six linked people and is still
 * a sentence, which a test that stripped the link text could not see.
 */
function isProseLine(line: string): boolean {
  const residue = line.replace(/\([^()]*\)/g, ' ').replace(/[![\]*_#>|`]/g, ' ')
  if (!/[.!?。]/.test(residue)) return false
  return residue.split(/\s+/).filter(Boolean).length >= MIN_PROSE_WORDS
}

/**
 * Whether a fetched page contains no sentence anywhere.
 *
 * A SECOND SHAPE TEST, because the line-share one cannot see a card. Measured
 * on the Requiem for a Dream bench: rogerebert.com's Darren Aronofsky index
 * took one of the two curated criticism slots, and it is a wall of review cards
 * where each markdown link is spread over seven lines - poster, heading,
 * byline, two star images, then the `](url)` that closes it. Per line, only the
 * star row reads as link-only, so the share lands near 0.4 against a 0.6
 * threshold and the page survives. What it has none of is a SENTENCE: every
 * line is a heading, a name or a date, and the longest of them ("2024 Sundance
 * Film Festival Announces 91 Projects Selected…") has no full stop in it.
 *
 * That page is also the likeliest reason one model named a critic in its
 * answer, which every prompt version forbids - it carries the byline "Roger
 * Ebert" six times over and says nothing else.
 *
 * NO SENTENCE AT ALL IS THE TEST, and the second clause is what covers a menu
 * carrying a stray caption. It is guarded by the link count so that a scraper
 * emitting a whole article as one long line - one prose line, no standalone
 * links - can never be dropped by it. The asymmetry is deliberate: keeping a
 * menu costs a share of the budget, losing an article costs the analysis.
 */
export function hasNoProse(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  const prose = lines.filter(isProseLine).length
  if (prose === 0) return true
  return prose < MIN_PROSE_LINES && lines.filter(isLinkOnlyLine).length >= MIN_LINK_LINES
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
    // Checked before the shape tests so the log separates a fetch that came
    // back empty from a page that is genuinely worthless - see MIN_USEFUL_CHARS.
    if (source.text.trim().length < MIN_USEFUL_CHARS) {
      dropped.push({ domain: source.domain, reason: 'empty' })
      return false
    }
    if (isNavigationPage(source.text)) {
      dropped.push({ domain: source.domain, reason: 'navigation' })
      return false
    }
    if (hasNoProse(source.text)) {
      dropped.push({ domain: source.domain, reason: 'no-prose' })
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
