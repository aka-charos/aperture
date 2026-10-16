/**
 * Does a title actually match an interest the viewer typed? Answered from the
 * title's own metadata — its genres and TMDb keywords — never from embedding
 * nearness.
 *
 * WHY NOT THE EMBEDDING. Interest slots used to be filled from the 25 titles
 * whose vectors sat nearest the embedded phrase, gated at a cosine of 0.5.
 * Measured on the live library with gemini-embedding-2: the 1,000 nearest
 * titles to "dark comedy" span 0.566–0.638 and to "dystopian sci-fi"
 * 0.590–0.690, so the 0.5 bar admitted every one of them and the 0.7 tier
 * ("strong match", affinity 1.0) was reached by none. Both numbers were
 * inherited from another model and never measured on this one (the cosine
 * invariant). And the ordering inside that band is not about the idea: a short
 * phrase lands on documents that share its WORDS, so the nearest titles to
 * "dark comedy" were Dark Horse (twice), The Dark, Dark Crimes, The King of
 * Comedy and five stand-up specials. A subject phrase ("dystopian sci-fi")
 * fared well; a tone phrase did not, and nothing could tell the two apart.
 * The slot then went to whichever of those 25 the viewer's own score liked
 * best, and the explanation was told to open "they asked for this" — so a
 * drama called Dark Horse could be presented as the dark comedy they asked
 * for.
 *
 * So a slot is now backed by a FACT a reader can check: a genre or keyword on
 * the title that says the same thing as the interest. A phrase with no fact in
 * the library behind it fills no slot, which is the safe side of this
 * failure: a missing pick costs nothing, a wrong "this is what you asked for"
 * costs trust.
 *
 * Pure, no DB, pinned by interestEvidence.test.ts.
 */

/** What on the title backs the match, in the metadata's own words. */
export interface InterestEvidence {
  /**
   * `phrase`: one genre or keyword says the whole interest ("dark comedy").
   * `parts`: the interest splits into pieces that are each a whole genre or
   * keyword ("dystopian sci-fi" = keyword "dystopia" + genre "Science Fiction").
   */
  strength: 'phrase' | 'parts'
  /** The genres/keywords that matched, as stored on the title. */
  matched: string[]
}

/** The metadata a match is read from. */
export interface InterestTitleFacts {
  genres?: string[] | null
  keywords?: string[] | null
}

/**
 * Words that describe the FORM of what someone wants rather than what it is
 * about: "time travel stories", "heist movies", "underdog sports dramas" would
 * otherwise demand a keyword called "stories".
 */
const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'with', 'about', 'i', 'love', 'like', 'more',
  'movie', 'movies', 'film', 'films', 'story', 'stories', 'show', 'shows', 'series',
  'tv', 'title', 'titles', 'thing', 'things', 'kind', 'kinds', 'type', 'types',
])

/**
 * Phrases written two ways in the wild. Applied to both sides after
 * normalisation, so "sci-fi" in an interest meets the "Science Fiction" genre.
 * Deliberately short: every entry is a claim that two phrases mean the same.
 */
const SYNONYMS: Array<[RegExp, string]> = [
  [/\bsci fi\b/g, 'science fiction'],
  [/\bscifi\b/g, 'science fiction'],
  [/\brom com\b/g, 'romantic comedy'],
  [/\bromcom\b/g, 'romantic comedy'],
]

/** Lowercase, strip accents, punctuation to spaces, synonyms applied. */
function normalise(text: string): string {
  let s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  for (const [pattern, replacement] of SYNONYMS) s = s.replace(pattern, replacement)
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * A light stem, the same on both sides: plural and the "-ian" adjective, so
 * "comedies" meets "comedy" and "dystopian" meets "dystopia". It does not try
 * to be a real stemmer; a miss costs a slot, never a false claim.
 */
function stem(word: string): string {
  let w = word
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ian')) w = w.slice(0, -1)
  return w
}

/** The content words of an interest, stemmed, in order. */
export function interestTerms(interestText: string): string[] {
  return normalise(interestText)
    .split(' ')
    .filter((word) => word && !FILLER_WORDS.has(word))
    .map(stem)
}

/**
 * A fact as comparable phrases: as written, and with the interest's filler
 * words removed, so the keyword "Film Noir" meets the interest "film noir"
 * (whose "film" is filler) and "war film" meets "war".
 */
function factPhrases(fact: string): string[] {
  const words = normalise(fact).split(' ').filter(Boolean)
  const full = words.map(stem).join(' ')
  const content = words
    .filter((word) => !FILLER_WORDS.has(word))
    .map(stem)
    .join(' ')
  return content && content !== full ? [full, content] : [full]
}

/** The longest span an interest may be split into when matched in parts. */
const MAX_PART_WORDS = 4

/**
 * The evidence on a title for an interest, or null when its metadata does not
 * say so. Three ways to match, strongest first:
 *
 * 1. a fact IS the interest ("dark comedy" ↔ keyword "dark comedy");
 * 2. a fact CONTAINS the interest, for interests of two words or more
 *    ("time travel" ↔ "time travel paradox") — never for one word, where
 *    "war" would match "star wars";
 * 3. the interest splits into consecutive pieces that are each a whole fact
 *    ("dystopian sci-fi" ↔ "dystopia" + "Science Fiction").
 *
 * The weight of a match is not decided here; see interestAffinityFromEvidence.
 */
export function matchInterestEvidence(
  interestText: string,
  facts: InterestTitleFacts
): InterestEvidence | null {
  const terms = interestTerms(interestText)
  if (terms.length === 0) return null
  const phrase = terms.join(' ')

  const byPhrase = new Map<string, string>()
  for (const fact of [...(facts.genres ?? []), ...(facts.keywords ?? [])]) {
    if (typeof fact !== 'string' || !fact.trim()) continue
    for (const key of factPhrases(fact)) {
      if (key && !byPhrase.has(key)) byPhrase.set(key, fact)
    }
  }
  if (byPhrase.size === 0) return null

  const exact = byPhrase.get(phrase)
  if (exact) return { strength: 'phrase', matched: [exact] }

  if (terms.length >= 2) {
    for (const [key, fact] of byPhrase) {
      if (` ${key} `.includes(` ${phrase} `)) return { strength: 'phrase', matched: [fact] }
    }
  }

  // Greedy cover, longest span first at each position. Every word must be
  // accounted for; one uncovered word and the interest is not shown.
  if (terms.length >= 2) {
    const matched: string[] = []
    let i = 0
    while (i < terms.length) {
      let found: string | null = null
      let length = 0
      for (let span = Math.min(MAX_PART_WORDS, terms.length - i); span >= 1; span--) {
        const fact = byPhrase.get(terms.slice(i, i + span).join(' '))
        if (fact) {
          found = fact
          length = span
          break
        }
      }
      if (!found) return null
      if (!matched.includes(found)) matched.push(found)
      i += length
    }
    if (matched.length >= 2) return { strength: 'parts', matched }
  }

  return null
}

/**
 * The preference affinity an interest gives a title: 1.0 when one fact says
 * the whole interest, 0.8 when it is assembled from parts, 0.5 (neutral)
 * otherwise, scaled toward neutral by the interest's own weight (1.0 unless a
 * caller sets one). Never below neutral: an interest is something wanted,
 * not an aversion list.
 *
 * These are the tiers the cosine bands used to produce (0.8 "moderate", 1.0
 * "strong"); what moved is the evidence that earns them.
 */
export function interestAffinityFromEvidence(
  evidence: InterestEvidence | null,
  weight: number | string | null | undefined = 1
): number {
  if (!evidence) return 0.5
  const tier = evidence.strength === 'phrase' ? 1.0 : 0.8
  const parsed = Number(weight)
  const w = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 1
  return 0.5 + (tier - 0.5) * w
}

/**
 * The matched tags as one quoted list for a sentence: `"dark comedy"`, or
 * `"dystopia" and "Science Fiction"`. Shared by both explanation prompts, the
 * non-AI fallbacks and the explanation checker, so all of them name the same
 * tags the same way.
 */
export function formatEvidenceTags(evidence: InterestEvidence): string {
  const quoted = evidence.matched.map((tag) => `"${tag}"`)
  if (quoted.length <= 1) return quoted.join('')
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
}

/** Read stored evidence back off score_breakdown JSONB; anything malformed is null. */
export function readInterestEvidence(value: unknown): InterestEvidence | null {
  if (typeof value !== 'object' || value === null) return null
  const { strength, matched } = value as Record<string, unknown>
  if (strength !== 'phrase' && strength !== 'parts') return null
  if (!Array.isArray(matched)) return null
  const facts = matched.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
  return facts.length > 0 ? { strength, matched: facts } : null
}
