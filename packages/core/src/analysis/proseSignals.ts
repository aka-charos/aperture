/**
 * Count the habits a prompt change is meant to remove, so a bench can say
 * whether it did.
 *
 * WHY A COUNT AND NOT A READING. Every correction to the analysis prompt so far
 * was judged by reading a handful of answers, and version 8 showed how that
 * misleads: a rule that looked settled on one title was met with a synonym on
 * the next. Reading decides whether an analysis is good; these numbers decide
 * whether a named habit went down across models, which reading five answers
 * cannot.
 *
 * THIS IS AN INSTRUMENT, NEVER A VALIDATOR. Nothing rejects, retries or scores
 * an analysis on these, and nothing should: each pattern also matches innocent
 * prose ("rather than" is sometimes exactly right), so a threshold would punish
 * good writing. They are printed beside the prose they describe, where a reader
 * can see what matched.
 *
 * ZERO IS NOT CLEAN. The Terminator 2 bench showed the limit: version 9 scored
 * zero "unattributed" while stating one blog's readings as plain fact, because
 * the column counts hedges ("is described as") and a flat assertion has none.
 * An opinion with no holder and no hedge is invisible to any pattern here and
 * has to be read.
 *
 * EVERY PATTERN WAS MEASURED, not imagined - each comes from a version-8 or
 * version-9 analysis read on the bench. A new habit gets a pattern when it has
 * been seen, the way the prompt's named phrasings do.
 *
 * PURE AND DB-FREE, like ./comparisonReport.ts which prints it.
 */
import { splitAnalysisParagraphs } from './paragraphMap.js'

export interface ProseSignals {
  words: number
  paragraphs: number
  /** Sentences in the longest paragraph. The prompt asks for four at most. */
  longestParagraph: number
  /**
   * The longest paragraph in WORDS.
   *
   * Version 16 states a hundred-word paragraph anchor and flags one half as
   * long again, and only SENTENCES were counted - so an answer whose paragraphs
   * were inside the sentence cap while carrying 150 words each read as clean.
   * Measured on the second Suspiria bench.
   */
  longestParagraphWords: number
  /** "the sources carry", "the documents do not name" — pointing at the retrieval. */
  pointsAtSources: number
  /**
   * Bracketed question labels left in the prose: "[tradition]" as a heading
   * over its own paragraph. Every version forbids headings, and the panel draws
   * its own from the map, so a row like this renders "Context" above the
   * literal text "[tradition]". Measured on ornith-1.5-9b under version 15.
   */
  inlineLabels: number
  /**
   * A critic, a scholar or a publication named in the answer.
   *
   * WHETHER THAT IS A FAULT DEPENDS ON THE PROMPT, which is why this stays a
   * count and not a verdict. Versions 13 to 15 and the compact variant forbid
   * naming outright and are all still benchable, so for them a number here is a
   * rule broken. Draft 16 permits it and asks only that the name be the right
   * one, which no pattern can check - there the number is descriptive, and a
   * high one is a cue to read the attributions rather than a failure.
   *
   * The measured publication list and the two writer shapes are always counted;
   * the names a caller passes from THIS run are added to them, so a zero here
   * means none found, never "not measured".
   */
  namedWriters: number
  /** The names behind that count, so a reader can check what matched. */
  namedWriterMatches: string[]
  /** A view with no holder: "is described as", "according to one reading". */
  unattributed: number
  /** "rather than" / "instead of". */
  ratherThan: number
  /** "These disagreements remain unresolved" — announcing a question is open. */
  leftOpen: number
  /** Paragraphs that open by restating their question: "The film sits in". */
  questionEchoes: number
  /**
   * Phrases told under two different questions — `repeatedPhrases.length`.
   * Zero whenever the answer carried no usable paragraph map, since without
   * labels there are no questions to repeat across.
   */
  repeatedAcrossSections: number
  /** The phrases behind that count, so a reader can check what matched. */
  repeatedPhrases: string[]
  /**
   * Mentions of a critic, scholar, reviewer or viewer in paragraphs the model
   * did not label as reception. Zero without a paragraph map, like the count
   * above.
   */
  spill: number
  /** Semicolons. The prompt asks for none. */
  semicolons: number
  /**
   * Quality words outside the reception answer: "extraordinary",
   * "soul-shattering". Every prompt version puts whether it is good in the
   * reception answer alone, and the work answer names four of these verbatim.
   * Zero without a paragraph map, and scoped exactly as spill is.
   */
  praise: number
  /**
   * Named awards anywhere in the answer. The reception question says "no
   * scores, no list of awards" and one answer named a Golden Globe and an
   * Oscar. Whole-answer rather than scoped, since an award is no more of an
   * answer under making than under reception - and so it needs no map.
   */
  awards: number
  /**
   * Words in paragraphs labelled `work`, and in paragraphs labelled reception
   * (or version 8's `dispute`). The prompt asks for reception never to run
   * longer than the work answer. Zero without a map.
   */
  workWords: number
  receptionWords: number
  /**
   * Questions whose answer is split across paragraphs that are not next to
   * each other, which every version since 8 forbids in as many words. Measured
   * on the Suspiria bench, where one answer labelled paragraph 3
   * "work+circumstances" and paragraph 6 "circumstances", with two work
   * paragraphs in between. Zero without a map.
   */
  scattered: number
  /**
   * Whether the answer carried a usable paragraph map. The counts that read the
   * model's labels are zero without one, and that zero means "not measured",
   * not "none found" - the report prints a dash for them.
   */
  mapped: boolean
}

/**
 * Pointing at the retrieval.
 *
 * THE PROMPT'S OWN NOUN IS "DOCUMENTS", and for three versions this counted
 * only "sources". The rule names the failing phrasings as "the sources say",
 * "the sources carry", "one source credits" - so a model that obeys the letter
 * and writes "the documents" instead does the forbidden thing and scores zero.
 * Measured on the Requiem for a Dream bench: "though the documents do not name
 * what it influenced specifically", counted as clean. A prompt-primed blind
 * spot, which is the worst kind an instrument can have.
 */
const POINTS_AT_SOURCES = [
  /\b(?:the|these|those|its|available|retrieved) sources\b/gi,
  /\bsource (?:documents?|material)\b/gi,
  // Withnail & I under version 13: "one fan-adjacent source credits it". A
  // source of tension, or a source novel, is not the retrieval.
  /\b(?:one|another|several|some)\s+(?:[a-z]+(?:-[a-z]+)?\s+)?sources?\b(?!\s+(?:of|material|novel|text|book|play|story)\b)/gi,
  /\b(?:the|these|those|available|retrieved) documents?\b/gi,
  /\b(?:one|another|several|some)\s+(?:[a-z]+(?:-[a-z]+)?\s+)?documents?\b/gi,
]

/**
 * A question label written into the prose as a heading.
 *
 * The ids are the paragraph map's vocabulary across every version this build
 * can run, `structure` and the retired `intent`/`dispute` included, since an
 * older edition is still benchable.
 */
const INLINE_LABELS = [
  /\[(?:tradition|work|structure|circumstances|reception|intent|dispute)\]/gi,
]

const UNATTRIBUTED = [
  // Passive voice that hides whose view it is. "has been traced to" is
  // Possession's; "is described as" is the commonest.
  /\b(?:is|are|was|were|has been|have been|had been)\s+(?:widely\s+|often\s+|variously\s+|also\s+)?(?:described|called|characteri[sz]ed|regarded|considered|labell?ed|dubbed|hailed|traced|seen|recogni[sz]ed)\s+(?:as|to)\b/gi,
  // The Wretches Are Still Singing under version 13: "has been credited with
  // influencing independent film-making".
  /\b(?:is|are|was|were|has been|have been|had been)\s+(?:widely\s+|often\s+|also\s+)?credited\s+with\b/gi,
  /\baccording to (?:one|some|a|an)\b/gi,
  /\b(?:one|a) critical (?:read|reading)\b/gi,
  /\breportedly\b/gi,
  // Terminator 2 under version 12: "are said to have changed how blockbusters
  // were made".
  /\b(?:is|are|was|were)\s+said\s+to\b/gi,
  // A holder that is not a person: "a philosophical reading takes it as", "one
  // retrospective account holds" under version 13, and "The retrospective
  // account is explicit", "the retrospective press placed" under 14. "One
  // critical reading" is already counted above.
  /\b(?:one|a|another|the)\s+(?!critical\s)(?:[a-z]+\s+){0,2}(?:account|reading|press|analysis|line|view|interpretation)\s+(?:is|was|holds|held|takes|took|reads|sees|saw|argues|argued|suggests|finds|found|calls|called|notes|treats|traces|describes|shaped|places|placed)\b/gi,
]

/**
 * A writer's view named outside the reception answer.
 *
 * Version 13 keeps every critic, scholar and viewer in reception, after The
 * Zero Years' form answer ran "one Italian critic ... the same critic ...
 * another viewer" for three paragraphs. Reception and its version-8
 * predecessor are where these belong.
 *
 * A SINGULAR VIEWER IS THE PROMPT'S OWN PHRASING AND NEVER COUNTS. The rule
 * used to exclude "the viewer" alone, calibrated against version 13's wording.
 * Version 16 says "a viewer" throughout - "say what that does to a viewer
 * sitting in front of it", "What should a viewer watch and listen for?" - so
 * the exclusion was on the wrong article, and the column began reporting the
 * instruction being obeyed as a fault. Measured on the second Suspiria bench:
 * deepseek-v4.1-flash scored 7, and ALL SEVEN were "a viewer" in the answers
 * the prompt asks for it in. This is the ./sourceQuality.ts lesson in reverse -
 * there a prompt-primed noun was invisible to a pattern, here a prompt-primed
 * noun IS the pattern.
 *
 * The split is clean because the prompt is consistent: every use it asks for is
 * SINGULAR, and what this exists to catch - audience response smuggled into a
 * craft answer - is PLURAL. "one viewer" and "another viewer" stay, since the
 * prompt never writes either and both name somebody's reaction.
 */
const WRITER_MENTIONS = [
  /\b(?:critics?|reviewers?|scholars?|commentators?)\b/gi,
  /\b(?:one|another|some|several|other|many|most)\s+viewers?\b/gi,
  /\bwriting (?:in|for)\b/gi,
]
const WRITER_SECTIONS = new Set(['reception', 'dispute'])
const WORK_SECTIONS = new Set(['work'])

/** Words in the paragraphs whose labels include one of the wanted ones. */
function wordsIn(
  paragraphs: string[],
  sections: readonly (readonly string[])[] | null | undefined,
  wanted: ReadonlySet<string>
): number {
  if (!sections || sections.length === 0) return 0
  return paragraphs.reduce(
    (sum, paragraph, i) =>
      sections[i]?.some((label) => wanted.has(label)) ? sum + paragraph.split(/\s+/).length : sum,
    0
  )
}

function outsideReception(
  paragraphs: string[],
  sections: readonly (readonly string[])[] | null | undefined,
  patterns: RegExp[]
): number {
  if (!sections || sections.length === 0) return 0
  return paragraphs.reduce((sum, paragraph, i) => {
    const labels = sections[i]
    if (!labels || labels.length === 0 || labels.some((label) => WRITER_SECTIONS.has(label))) {
      return sum
    }
    return sum + count(paragraph, patterns)
  }, 0)
}

/**
 * Whether it is good, said outside the reception answer.
 *
 * The list is the words the prompt itself names plus the ones measured in
 * answers - deliberately adjectives of QUALITY, never of description: "grim",
 * "relentless" and "hallucinatory" describe a film and belong wherever the
 * documents support them, while "masterful" is a verdict.
 */
const PRAISE_WORDS = [
  /\b(?:sharp|powerful|masterful|masterly|career-best|extraordinary|remarkable|stunning|brilliant|flawless|breathtaking|dazzling|astonishing|superb|magnificent|soul-shattering|unforgettable|indelible|iconic|virtuosic|tour de force)\b/gi,
  /\bleaves? (?:the |an? )?(?:deepest|indelible|lasting) (?:mark|impression)\b/gi,
]

const AWARDS = [
  /\b(?:oscars?|academy award|golden globe|bafta|palme d'or|screen actors guild|independent spirit award)\w*\b/gi,
]

/**
 * Words a scraped page title uses about itself, which name nobody.
 *
 * "Darren Aronofsky Movies and TV Shows - Reviews & Ratings" would otherwise
 * register "Reviews" and "Ratings" as writers, and both appear in ordinary
 * prose about how a film was received.
 */
const TITLE_BOILERPLATE = new Set([
  'a', 'and', 'cast', 'com', 'crew', 'film', 'films', 'for', 'free', 'full', 'home', 'movie',
  'movies', 'net', 'news', 'official', 'online', 'org', 'page', 'part', 'rating', 'ratings',
  'review', 'reviews', 'series', 'show', 'shows', 'site', 'stream', 'streaming', 'summary',
  'the', 'trailer', 'tv', 'video', 'watch', 'with',
])

const TITLE_SEPARATORS = /\s[-–—|·:]\s|\s\|\s/

/**
 * The writers and publications a retrieval put in front of the model.
 *
 * WHY THE ANSWER CANNOT BE A FIXED LIST. Every version forbids naming a critic,
 * a scholar or a publication, and the names a model reaches for are the ones it
 * has just been handed - so the names to look for are a property of the RUN.
 * Measured on the Requiem for a Dream bench, where one model wrote "what Ebert
 * called her riskiest role" and "which Ebert had previously adapted": the name
 * is in two source titles and nowhere in the film's credits.
 *
 * TAKEN FROM THE TRAILING SEGMENT ONLY. A scraped page title puts the site or
 * the byline last, after a dash or a pipe - "… movie review - Roger Ebert",
 * "… - Rotten Tomatoes" - and everything before it is the film's own name and
 * its people, who MUST be nameable. A title with no separator contributes
 * nothing rather than contributing its subject.
 *
 * A two-word name also registers its last word, because that is how a surname
 * is used. Matching is case-SENSITIVE for the same reason it is worth doing at
 * all: "Rated" from "Frame Rated" is a name and "rated" is a word.
 *
 * THE FILM'S OWN NAME IS EXCLUDED, because a site puts it where a byline goes.
 * "The Film Stage Show Classic - Suspiria (1977)" registered "Suspiria" as a
 * writer, and every answer about the film then named one.
 *
 * Pure, and the result is printed beside the count, so a wrong candidate is
 * visible rather than misleading - ./comparisonReport.ts prints what matched.
 */
export function writerNamesFromSources(
  sources: readonly { title?: string | null }[],
  exclude: readonly string[] = []
): string[] {
  const banned = exclude
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 3)
  const isFilmName = (name: string) => {
    const folded = name.toLowerCase()
    return banned.some((value) => folded.includes(value) || value.includes(folded))
  }
  const names = new Set<string>()
  for (const source of sources) {
    const title = (source.title ?? '').trim()
    const parts = title.split(TITLE_SEPARATORS)
    if (parts.length < 2) continue
    const tail = parts[parts.length - 1].replace(/\(.*?\)/g, ' ').trim()
    const raw = tail.split(/\s+/).filter(Boolean)
    const capitalised = raw.filter((word) => /^[\p{Lu}]/u.test(word))
    if (capitalised.length === 0 || raw.length > 5) continue
    if (
      capitalised.every((word) => TITLE_BOILERPLATE.has(word.toLowerCase().replace(/[^\p{L}]/gu, '')))
    ) {
      continue
    }
    // The WHOLE tail, connectives included. Joining only the capitalised words
    // stored "Sight and Sound" as "Sight Sound", a string no answer can contain
    // - so the publication was registered and could never be caught.
    const full = raw.join(' ')
    if (full.length >= 4 && !isFilmName(full)) names.add(full)
    // A surname only from a name that is capitalised THROUGHOUT. A lowercase
    // connective means a publication, and dropping it made "Sight and Sound"
    // read as a two-word personal name: "Sound" was registered as its surname
    // and matched "Sound is pushed to acute exaggeration" in both answers on
    // the version-16 bench. The case-sensitive guard did not help, because the
    // word opened a sentence.
    const last = raw[raw.length - 1]
    if (
      raw.length === capitalised.length &&
      raw.length > 1 &&
      last.length >= 4 &&
      !TITLE_BOILERPLATE.has(last.toLowerCase()) &&
      !isFilmName(last)
    ) {
      names.add(last)
    }
  }
  return [...names].sort()
}

/**
 * Publications an answer named, which no source title could have supplied.
 *
 * MEASURED, EVERY ONE, like ./sourceQuality.ts's domain list: each name below
 * was read in a retrieved document on a bench, and the model that named it was
 * reading it out of an aggregator's quote list, where the publication is
 * printed beside every blurb. On the version-16 bench one answer named six of
 * these in a single paragraph while `namedWriters` - which reads source titles
 * only - reported two.
 *
 * IT IS A FLOOR AND NOT A CEILING. A publication joins it when it has been
 * seen. What it deliberately does not cover is a critic's SURNAME out of a
 * document body ("Honeybone wrote", "Stephen Hunter says"), because the only
 * mechanical way to tell that from a maker being named and quoted - which every
 * version requires - is to know who made the film, and this module is handed
 * prose and labels and nothing else.
 */
const PUBLICATIONS = [
  'ABC Radio', 'BFI', 'Chicago Reader', 'Chicago Sun-Times', 'Dallas Observer', 'Empire',
  'Fangoria', 'Film.com', 'IMDb', 'IndieWire', 'Letterboxd', 'Little White Lies', 'Metacritic',
  'MUBI', 'New York Post', 'Philadelphia Inquirer', 'Rolling Stone', 'Rotten Tomatoes',
  'San Francisco Chronicle', 'San Francisco Examiner', 'Screen Daily', 'Seattle Post-Intelligencer',
  'Sight and Sound', 'Slant', 'The Guardian', 'The Hollywood Reporter', 'Time Out', 'Toronto Star',
  'TV Guide', 'USA Today', 'Variety', 'Village Voice', 'Washington Post', 'Wikipedia',
]

/**
 * Two shapes that name a writer and cannot name a maker.
 *
 * Both were read on the version-16 bench, where the rule forbidding a name had
 * just been rewritten to explain WHERE such a name comes from and was broken
 * anyway: "Gayle Sequeira of BFI notes that…" and "the reviewer at HorrorNews
 * traces how…". A maker is never "of" a publication and never "the reviewer
 * at" one, so neither pattern can fire on a director being named, which is what
 * a bare surname plus a reporting verb cannot promise.
 *
 * THE FIRST SHAPE NEEDS THE REPORTING VERB, which the measured case had and the
 * pattern did not require. Without it "Mother of Tears" is a critic of a
 * publication, and so is every film title built that way - measured on the
 * Suspiria bench, where it was counted in both answers.
 */
const REPORTING_VERB =
  '(?:notes?|noted|writes?|wrote|argues?|argued|says?|said|calls?|called|describes?|described|finds?|found|observes?|observed|reads?|suggests?|suggested|praises?|praised|faults?|faulted|judges?|judged|holds?|held|sees?|saw)'

/** A capitalised name of up to four words, which is what a byline looks like. */
const NAME_PATTERN = String.raw`\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){0,3}`

/** "By Janet Maslin", with the leading bracket or hash an aggregator adds. */
const BYLINE_SHAPE = new RegExp(String.raw`^[\s\[#*]*[Bb]y\s+\[?(${NAME_PATTERN})`, 'gmu')

/**
 * A link whose href files its label as a critic or a publication. The label can
 * span lines - Metacritic puts the score above the name inside the same
 * brackets - so the last non-empty line of it is the name.
 */
const CREDITED_LINK_SHAPE = new RegExp(
  String.raw`\[([^\]]{1,120}?)\]\([^)]*\/(?:critic|publication|contributors|author|profile)\/[^)]*\)`,
  'gsu'
)

/**
 * A critic credited beside a DATE, which is how an aggregator prints a review
 * card: "Alyx Vesey Bitch Media Jan 7, 2021".
 *
 * Neither a byline nor a link, so the two shapes above cannot see it - measured
 * on the second Suspiria bench, where one answer named Christy Lemire, Max
 * Allen, Adam Nayman and Alyx Vesey, every attribution was CORRECT, and the
 * report counted ZERO. Metacritic had dropped out of that retrieval and Rotten
 * Tomatoes had come in, and RT writes its credits as bare text.
 *
 * The date is the anchor, because it is reliable and rare. Everything before it
 * is <critic, two words> <publication, the rest>, so both halves are kept: the
 * answer may name either.
 */
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'
const CAPITALISED = String.raw`\p{Lu}[\p{L}'’.-]*`
const DATED_CREDIT_SHAPE = new RegExp(
  String.raw`(${CAPITALISED}(?:\s+${CAPITALISED}){1,4})\s+${MONTH}\s+\d{1,2},\s*\d{4}`,
  'gu'
)

/**
 * Capitalised boilerplate an aggregator prints between cards, which joins the
 * run in front of the name: "… Go to Full Review Adam Nayman The Ringer Oct 5,
 * 2018" would otherwise yield "Review Adam" and "Nayman The Ringer".
 */
const CREDIT_LEAD_NOISE = new Set([
  'Go',
  'To',
  'Full',
  'Review',
  'Reviews',
  'Read',
  'See',
  'More',
  'View',
  'All',
])

const PERSON_SHAPE = new RegExp(`^${NAME_PATTERN}$`, 'u')

/** Bylines that name nobody. */
const NOT_A_BYLINE = new Set(['Staff', 'Staff Writer', 'Editor', 'Admin', 'Guest'])

/**
 * Names this run handed the model inside the document BODIES.
 *
 * {@link writerNamesFromSources} reads the source TITLES, and on an
 * aggregator-heavy retrieval there is nothing in them: the titles are "Suspiria
 * Reviews - Metacritic" and "Suspiria | Rotten Tomatoes", while every critic is
 * a BYLINE further down the page. Measured on the Suspiria bench, where one
 * answer named Roger Ebert, Bradley Warren, Empire, Gary Arnold and Janet
 * Maslin and the report counted ONE - the only match being the publication that
 * happened to sit in the hand-written PUBLICATIONS list. Four of the five were
 * in the documents and unreachable from a title.
 *
 * Two shapes, both read off this run and neither guessed at. A BYLINE, which is
 * what a review page puts above its text. And a link whose href says the label
 * is a critic or a publication, which is how an aggregator files every quote it
 * prints. Both are safe where a bare surname plus a reporting verb is not: a
 * DIRECTOR is never bylined on a review and never filed under /critic/, so
 * neither can fire on "Argento said" - which is the whole reason
 * NAMED_WRITER_SHAPES has to demand a publication beside the name.
 *
 * A SITE-NAME IS ALSO REGISTERED AS A PERSON, because that is exactly how one
 * gets used: the document carries "RogerEbert.com" and the answer wrote "Roger
 * Ebert called it an absolute classic" - of a review bylined Peter Sobczynski.
 * So the trailing domain is dropped and the run-together words are split, and
 * both forms are matched. That naming is the failure the A SITE IS NOT ITS
 * WRITER rule was written for, broken on the first bench after it was added,
 * and it was invisible to every count in this file.
 *
 * Still a COUNT and never a verdict, like everything else here. The matches are
 * printed beside it, so a reader checks the attributions against the prose
 * directly below them.
 */
export function namesFromDocuments(texts: readonly string[]): string[] {
  const found = new Set<string>()
  const add = (raw: string): void => {
    const name = raw.trim().replace(/[,.;:]+$/, '')
    if (name.length < 4 || NOT_A_BYLINE.has(name)) return
    found.add(name)
    const spaced = name
      .replace(/\.(?:com|net|org|co\.uk)$/i, '')
      .replace(/([\p{Ll}])(\p{Lu})/gu, '$1 $2')
      .trim()
    if (spaced !== name && spaced.length >= 4) found.add(spaced)
  }
  for (const text of texts) {
    for (const match of text.matchAll(BYLINE_SHAPE)) add(match[1])
    for (const match of text.matchAll(CREDITED_LINK_SHAPE)) {
      const label = match[1]
        .replace(/^\s*[Bb]y\s+/, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .pop()
      if (label && PERSON_SHAPE.test(label)) add(label)
    }
    for (const match of text.matchAll(DATED_CREDIT_SHAPE)) {
      const words = match[1].split(/\s+/).filter(Boolean)
      while (words.length > 0 && CREDIT_LEAD_NOISE.has(words[0])) words.shift()
      if (words.length < 2) continue
      add(words.slice(0, 2).join(' '))
      if (words.length > 2) add(words.slice(2).join(' '))
    }
  }
  return [...found]
}

const NAMED_WRITER_SHAPES = [
  new RegExp(
    `\\b\\p{Lu}[\\p{L}'’-]+(?:\\s+\\p{Lu}[\\p{L}'’-]+)?\\s+(?:of|at|from|writing for|writing in)\\s+(?:the\\s+)?\\p{Lu}[\\p{L}.'’-]+\\s+${REPORTING_VERB}\\b`,
    'gu'
  ),
  /\b[Tt]he\s+(?:critic|reviewer|scholar|writer)\s+(?:at|for|of|from)\s+(?:the\s+)?\p{Lu}[\p{L}.'’-]+/gu,
]

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Which of those names the answer uses, each WRITER counted once.
 *
 * A surname is registered beside its full name, so "Roger Ebert" in an answer
 * matches both and would read as two people. A one-word match is dropped when a
 * matched longer name ends with it.
 */
function namedWriters(text: string, names: readonly string[]): string[] {
  const candidates = [...new Set([...names, ...PUBLICATIONS])]
  const hit = candidates.filter((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text))
  const deduped = hit.filter(
    (name) =>
      name.includes(' ') ||
      !hit.some((other) => other !== name && other.endsWith(` ${name}`))
  )
  // The shapes are printed as what matched, trimmed, so a reader sees the
  // phrase and can judge it - the same reason `told twice` prints its phrases.
  const shapes = NAMED_WRITER_SHAPES.flatMap((pattern) => text.match(pattern) ?? []).map((match) =>
    match.trim()
  )
  const already = (shape: string) => deduped.some((name) => shape.includes(name))
  return [...deduped, ...new Set(shapes.filter((shape) => !already(shape)))]
}

const RATHER_THAN = [/\brather than\b/gi, /\binstead of\b/gi]

const LEFT_OPEN = [
  /\b(?:remains?|remained|is left|are left|stays?|left) (?:open|unresolved|unsettled)\b/gi,
  /\bnot resolved\b/gi,
  /\bdo(?:es)? not cancel (?:each other|one another) out\b/gi,
]

/** Matched against the start of a paragraph only. */
const QUESTION_ECHO =
  /^(?:the (?:film|series|show) sits in\b|in tradition terms\b|(?:the )?critics (?:genuinely |also |sharply )?(?:disagree|divide|split|differ)\b|what critics (?:and viewers )?(?:genuinely )?(?:disagree|argue)\b|the (?:most consequential )?circumstances? of (?:its |the film's )?(?:making|production)\b|the people who made it\b|the making of the film left\b|the (?:film|series)'s (?:governing|organi[sz]ing|central) (?:formal )?(?:idea|choice)\b)/i

/**
 * Words too common to make a two-word phrase distinctive. Everything under four
 * letters is already excluded by length, so this list only has to cover the
 * longer function words and the words every analysis uses about its subject.
 */
const COMMON_WORDS = new Set([
  'about', 'after', 'also', 'before', 'being', 'between', 'both', 'each', 'even', 'film', 'films',
  'from', 'have', 'into', 'just', 'like', 'many', 'more', 'most', 'much', 'only', 'other', 'over',
  'series', 'show', 'some', 'still', 'such', 'than', 'that', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'under', 'very', 'were', 'what', 'when', 'where',
  'which', 'while', 'whose', 'with', 'work', 'would',
  // The genre and the people writing about it are the subject's vocabulary:
  // "science fiction" and "action cinema" matched on every Terminator 2 bench
  // without anything being told twice.
  'action', 'cinema', 'science', 'fiction', 'genre', 'critic', 'critics', 'reviewer', 'reviewers',
  'review', 'reviews',
])

/**
 * A capitalised pair is a name - "Brian Eggert", "James Cameron", "Deep Focus"
 * - and a name recurs whenever the person does something else. Those pairs
 * were most of what the signal printed on the version-10 and version-11
 * benches, burying the genuine repeats.
 */
const isCapitalised = (word: string) => /^\p{Lu}/u.test(word)

function count(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0)
}

/**
 * Sentences in a paragraph, roughly: a full stop, question or exclamation mark
 * followed by space and a capital. A lone capital before the stop is an
 * initial, not a sentence end - "Richard E. Grant" made a four-sentence
 * paragraph read as five on Withnail & I, a rule break that did not happen.
 * "Dr." still over-counts slightly, the right direction against a ceiling.
 */
function sentenceCount(paragraph: string): number {
  return paragraph
    .split(/(?<=[.!?])(?<!(?:^|[\s(])\p{Lu}\.)["'”’)\]]*\s+(?=["'“‘(]?[A-Z0-9À-ÖØ-Þ])/u)
    .filter((s) => s.trim()).length
}

/**
 * Two adjacent distinctive words, hyphens read as spaces ("liquid-metal"),
 * skipping names.
 */
function distinctivePairs(paragraph: string): Set<string> {
  const words = paragraph
    .replace(/[-–—]/g, ' ')
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)
  const pairs = new Set<string>()
  for (let i = 0; i + 1 < words.length; i++) {
    if (isCapitalised(words[i]) && isCapitalised(words[i + 1])) continue
    const [a, b] = [words[i].toLowerCase(), words[i + 1].toLowerCase()]
    if (a.length >= 4 && b.length >= 4 && !COMMON_WORDS.has(a) && !COMMON_WORDS.has(b)) {
      pairs.add(`${a} ${b}`)
    }
  }
  return pairs
}

/**
 * Phrases that appear under two questions that share no label.
 *
 * Measured on Terminator 2 under version 9: the early screenplay's liquid-metal
 * idea was told under Context and again under Making, and "say each fact once"
 * was in the prompt both times. Two paragraphs labelled `work` and
 * `work+tradition` share a question, so a phrase in both is not counted — only a
 * phrase whose occurrences include two DISJOINT label sets is.
 *
 * A phrase in half the paragraphs or more is the subject's own vocabulary (a
 * character, the premise), not a fact told twice, and is left out once there
 * are enough paragraphs for "half" to mean something.
 */
function repeatsAcrossSections(
  paragraphs: string[],
  sections: readonly (readonly string[])[] | null | undefined
): string[] {
  if (!sections || sections.length === 0) return []

  const seen = new Map<string, { labels: string[][]; paragraphs: number }>()
  paragraphs.forEach((paragraph, i) => {
    const labels = sections[i]
    if (!labels || labels.length === 0) return
    for (const pair of distinctivePairs(paragraph)) {
      const entry = seen.get(pair) ?? { labels: [], paragraphs: 0 }
      entry.labels.push([...labels])
      entry.paragraphs += 1
      seen.set(pair, entry)
    }
  })

  const disjoint = (a: string[], b: string[]) => !a.some((label) => b.includes(label))
  const repeated: string[] = []
  for (const [pair, entry] of seen) {
    if (paragraphs.length >= 4 && entry.paragraphs * 2 >= paragraphs.length) continue
    const crosses = entry.labels.some((a, i) => entry.labels.slice(i + 1).some((b) => disjoint(a, b)))
    if (crosses) repeated.push(pair)
  }
  return repeated.sort()
}

/**
 * Questions whose paragraphs are not one unbroken run.
 *
 * A question may share a paragraph with another and may take several, so what
 * is counted is the SPAN: a label appearing in paragraphs 3 and 6 occupies a
 * span of four and fills two of them, which is the shape the rule forbids.
 */
function scatteredQuestions(
  sections: readonly (readonly string[])[] | null | undefined
): number {
  if (!sections || sections.length === 0) return 0
  const seen = new Map<string, number[]>()
  sections.forEach((labels, index) => {
    for (const label of labels ?? []) {
      const at = seen.get(label) ?? []
      at.push(index)
      seen.set(label, at)
    }
  })
  let scattered = 0
  for (const at of seen.values()) {
    if (at[at.length - 1] - at[0] + 1 > at.length) scattered += 1
  }
  return scattered
}

export function measureProse(
  text: string | null | undefined,
  sections?: readonly (readonly string[])[] | null,
  writerNames?: readonly string[] | null
): ProseSignals {
  const trimmed = (text ?? '').trim()
  const paragraphs = trimmed ? splitAnalysisParagraphs(trimmed) : []
  const repeatedPhrases = repeatsAcrossSections(paragraphs, sections)
  const namedWriterMatches = namedWriters(trimmed, writerNames ?? [])
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    paragraphs: paragraphs.length,
    longestParagraph: paragraphs.reduce((max, p) => Math.max(max, sentenceCount(p)), 0),
    longestParagraphWords: paragraphs.reduce(
      (max, p) => Math.max(max, p.trim() ? p.trim().split(/\s+/).length : 0),
      0
    ),
    pointsAtSources: count(trimmed, POINTS_AT_SOURCES),
    inlineLabels: count(trimmed, INLINE_LABELS),
    namedWriters: namedWriterMatches.length,
    namedWriterMatches,
    unattributed: count(trimmed, UNATTRIBUTED),
    ratherThan: count(trimmed, RATHER_THAN),
    leftOpen: count(trimmed, LEFT_OPEN),
    questionEchoes: paragraphs.filter((p) => QUESTION_ECHO.test(p)).length,
    repeatedAcrossSections: repeatedPhrases.length,
    repeatedPhrases,
    scattered: scatteredQuestions(sections),
    spill: outsideReception(paragraphs, sections, WRITER_MENTIONS),
    praise: outsideReception(paragraphs, sections, PRAISE_WORDS),
    awards: count(trimmed, AWARDS),
    semicolons: (trimmed.match(/;/g) ?? []).length,
    workWords: wordsIn(paragraphs, sections, WORK_SECTIONS),
    receptionWords: wordsIn(paragraphs, sections, WRITER_SECTIONS),
    mapped: Boolean(sections?.some((labels) => labels.length > 0)),
  }
}
