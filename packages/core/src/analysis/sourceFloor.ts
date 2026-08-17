/**
 * Whether an analysis response is worth keeping.
 *
 * This is the epistemic half of the feature. A model with nothing to work from
 * will happily analyse a film it has never heard of, at length and with total
 * confidence, and nothing downstream can tell that apart from a good answer.
 *
 * Pure and DB-free on purpose, same as `pending.ts` and `watchedExclusion.ts`:
 * the decision that governs what reaches the page should be testable without a
 * database.
 *
 * THE ASYMMETRY THAT SETS THE THRESHOLDS. A decline is *stored* (analysis NULL
 * in `title_analysis`), which retires the title until `ANALYSIS_PROMPT_VERSION`
 * is bumped. Storing a mediocre analysis is recoverable — raise the floor and
 * re-run. Declining a good one is not. So every threshold here errs toward
 * keeping, and the live decline rate is the number to tune against:
 *
 *   SELECT source_grade, count(*), count(analysis) AS kept
 *   FROM title_analysis GROUP BY 1
 *
 * WHAT CHANGED WITH SELF-HOSTED RETRIEVAL. Under Gemini grounding the only
 * evidence available was an opaque chunk count. Now the retrieved documents
 * themselves are in hand, which gives a better signal and exposes a failure the
 * old one could not see — see `allListings` below.
 */
import type { SourceGrade } from './prompt.js'

/**
 * Below this, the model took the exit the prompt offers ("if none of the
 * questions have real answers, say so in two sentences and stop") and we should
 * record a decline rather than render two sentences of apology.
 *
 * 400 characters sits in a wide measured gap, not on a guess: a genuinely short
 * but real answer ran ~250 words (~1,500 characters) for Love Actually, while
 * the exit is two sentences (~200). There is an order of magnitude between
 * them, so the exact value is not load-bearing.
 */
export const MIN_ANALYSIS_CHARS = 400

/**
 * Text below this from one page means the fetch returned a navigation shell, a
 * consent wall, a paywall stub or a "not found" — not an article. Counting it
 * as a source would let six failed scrapes look like healthy retrieval.
 */
export const MIN_SUBSTANTIVE_SOURCE_CHARS = 600

/**
 * How many real documents the analysis needs behind it.
 *
 * Deliberately low, per the asymmetry above. Two independent pages is a weak
 * bar, and it is meant to be: it catches "the web has nothing on this title"
 * without touching the obscure-but-documented films this feature exists for.
 */
export const MIN_SUBSTANTIVE_SOURCES = 2

/**
 * Domains that carry listings, availability or store pages rather than writing.
 *
 * These exist for one specific failure that only became visible once retrieval
 * moved in-house: for an obscure title a metasearch returns its IMDb entry, a
 * couple of streaming-availability pages and some "where to watch" SEO, all of
 * which scrape to plenty of characters and contain no criticism whatsoever.
 * That is high volume and zero substance, and a count-based floor reads it as
 * healthy.
 *
 * KEPT DELIBERATELY SHORT AND UNCONTROVERSIAL. The rule below only fires when
 * EVERY substantive source is on this list, but a false positive still retires
 * a title permanently, so anything that carries actual writing stays off it.
 * Notably absent: Wikipedia (real production and reception sections), Rotten
 * Tomatoes and Metacritic (critic blurbs — "what do critics disagree about" is
 * answerable from exactly those), and Letterboxd.
 */
const LISTING_DOMAINS = [
  'justwatch.com',
  'imdb.com',
  'themoviedb.org',
  'thetvdb.com',
  'fandango.com',
  'moviefone.com',
  'reelgood.com',
  'netflix.com',
  'primevideo.com',
  'hulu.com',
  'max.com',
  'disneyplus.com',
  'paramountplus.com',
  'peacocktv.com',
  'vudu.com',
  'plex.tv',
  'play.google.com',
  'tv.apple.com',
]

/** True when a domain is a listing/store page rather than a place people write. */
export function isListingDomain(domain: string): boolean {
  const host = domain.trim().toLowerCase().replace(/^www\./, '')
  if (!host) return false
  // Suffix match so regional variants (amazon.co.uk, netflix.de) and subdomains
  // both land, without a bare `includes` matching an unrelated host that merely
  // contains the string.
  return LISTING_DOMAINS.some((listed) => host === listed || host.endsWith(`.${listed}`))
}

export type DeclineReason = 'thin_sources' | 'no_distinctive_craft'

export type FloorDecision =
  | { store: true }
  | { store: false; reason: DeclineReason }

/**
 * Below this many grounding chunks, a natively-grounded model was mostly
 * working from its own pretrained knowledge.
 *
 * Deliberately low, and it measures OBSCURITY rather than depth — a blockbuster
 * returns plenty of chunks and may still carry no analytical writing at all,
 * which is what `source_grade` is for. Only used in 'grounding' mode; the
 * self-hosted path has the documents themselves and can judge them better.
 */
export const MIN_GROUNDING_CHUNKS = 2

/** One retrieved document, as evidence rather than as content. */
export interface RetrievedSource {
  domain: string
  chars: number
}

/**
 * What retrieval left behind, which differs by mode and must not be flattened.
 *
 * The self-hosted path knows each document's domain and size. Native grounding
 * knows only how many chunks Google attached — the text is never exposed, and
 * its source URLs are expiring redirects, so no domain is recoverable. Faking a
 * common shape would mean inventing one of those numbers, and the floor would
 * then decide on a fiction.
 */
export type RetrievalEvidence =
  | { mode: 'crw'; sources: RetrievedSource[] }
  | { mode: 'grounding'; chunkCount: number }

export interface FloorInput {
  /** Prose with the SOURCES line already stripped. */
  text: string
  /** The model's own verdict, or null when it omitted / garbled the line. */
  grade: SourceGrade | null
  /** What retrieval actually produced. */
  evidence: RetrievalEvidence
}

export function decideAnalysisFloor(input: FloorInput): FloorDecision {
  const text = input.text.trim()

  // The model said outright that the sources have almost nothing. Trust it:
  // this is the one signal that reflects what was *read* rather than how much,
  // and in 'grounding' mode it is very nearly the only signal there is.
  if (input.grade === 'almost-nothing') {
    return { store: false, reason: 'thin_sources' }
  }

  if (input.evidence.mode === 'grounding') {
    if (input.evidence.chunkCount < MIN_GROUNDING_CHUNKS) {
      return { store: false, reason: 'thin_sources' }
    }
  } else {
    const substantive = input.evidence.sources.filter(
      (s) => s.chars >= MIN_SUBSTANTIVE_SOURCE_CHARS
    )

    if (substantive.length < MIN_SUBSTANTIVE_SOURCES) {
      return { store: false, reason: 'thin_sources' }
    }

    // Plenty of text, none of it writing. Whatever the model produced here came
    // from its own pretrained knowledge dressed in retrieved cast lists, which
    // is precisely what this module exists to stop. Not checkable under native
    // grounding, where the domains are never disclosed.
    if (substantive.every((s) => isListingDomain(s.domain))) {
      return { store: false, reason: 'thin_sources' }
    }
  }

  // Short means the model took the exit — a correct answer about the work
  // rather than a failure of retrieval, so it gets the other reason. Checked
  // after the source tests so a short AND unsourced response is reported as the
  // retrieval problem it more likely is.
  if (text.length < MIN_ANALYSIS_CHARS) {
    return { store: false, reason: 'no_distinctive_craft' }
  }

  return { store: true }
}
