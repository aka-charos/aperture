/**
 * The pure half of asking a decision model which retrieved documents are worth
 * reading, before the character budget divides itself among them.
 *
 * WHAT THIS IS FOR. Retrieval is mechanically filtered already - bot walls
 * (./blockedPage.ts), worthless pages (./sourceQuality.ts), a second page from
 * one host, a repeated title, a republished body, and site furniture cut out
 * of what survives (./sourceCleanup.ts). Those tests are shape tests: they ask
 * whether a page has sentences in it, whether its lines are links, whether its
 * headings are menus. They cannot ask what the sentences are ABOUT.
 *
 * Measured on one Suspiria retrieval: 158,119 characters fetched, 50,486
 * stripped as furniture, eleven documents reaching the prompt - and three of
 * those eleven carried nothing a writer could use. A BFI page promoting a
 * filmed interview, a podcast episode note with no transcript, and a Reddit
 * thread of other people's opinions. Every mechanical test passed all three,
 * correctly: they are real prose, on real sites, about the right film. They
 * are simply not writing ABOUT the work, and only reading them says so.
 *
 * WHY A DECISION MODEL AND NOT A BIGGER RULE. The distinction wanted here -
 * "does this page carry material a writer could ground a paragraph in" - is a
 * judgement, and six versions of this feature have now established that a
 * judgement written as a pattern catches its examples and nothing else. A
 * System One model answers judgements as a probability and returns no text, so
 * it costs one short call and cannot hallucinate a document.
 *
 * WHAT MUST NOT HAPPEN. F-124 measured the controlled Suspiria pair - same
 * prompt, same model, 3 documents against 13 - and thin retrieval makes the
 * writer COPY: traced share 43% -> 63%, documents used 2/3 -> 6/13, longest
 * lifted word-run 5 -> 1. Starving the writer is worse than boring it. So
 * every rail here points the same way: drop only on a confident no, never
 * below {@link MIN_SOURCES_AFTER_JUDGMENT}, never a document the model did not
 * answer for, and never anything at all when the call fails.
 *
 * No runtime imports beyond the question type and the floor it reuses, so the
 * whole decision is pinned by sourceJudgment.test.ts without a model.
 */
import type { SystemOneQuestion } from '../lib/decisionModelRules.js'
import { readNoul } from '../lib/decisionModelRules.js'
import type { AnalysisSource, AnalysisSubject } from './prompt.js'

/**
 * How much of each document the model is shown.
 *
 * The sample is the HEAD of the cleaned text, which is only safe because
 * ./sourceCleanup.ts has already run: before it, a page's first 1,200
 * characters were reliably its navigation menu, and every document would have
 * looked like noise. After it, the head is where an article states what it is.
 *
 * A CEILING, NOT A FIXED SIZE - see {@link sampleCharsFor}. This number alone
 * was the first version and it does not bound the request: the sample is per
 * document and the document count is a setting, so the state grew with it.
 */
export const SOURCE_SAMPLE_CHARS = 1_200

/**
 * Below this a sample cannot say what a page is, so the budget stops shrinking
 * and the request grows instead. 40 documents at this size is ~14,000
 * characters of excerpt, which is still inside the budget below.
 */
export const MIN_SOURCE_SAMPLE_CHARS = 350

/**
 * Total characters of excerpt the whole request may carry.
 *
 * THE DOCUMENT COUNT IS A SETTING AND THE FIRST VERSION DID NOT KNOW IT.
 * `SOURCE_SAMPLE_CHARS` was sized against the eleven documents of the live
 * Suspiria run, but `maxResults` (≤20) plus `curatedMaxResults` (≤20) allows
 * **40**, and `keepOnePerDomain` only caps per host - so at a legal setting the
 * state reached roughly 22,000 tokens, far past the 8k the smallest hosted
 * System One model (Kev-4B) serves. An overflow answers 400, which this
 * feature treats as a failure and falls open on, so the filter would simply
 * never work and say nothing but a `warn`.
 *
 * Measured per document at the ceiling: ~1,260 characters of state plus
 * ~1,000 of question text, about 565 tokens. 14,000 characters of excerpt
 * keeps the whole request near 6k tokens at any document count, and is chosen
 * so the DEFAULTS are untouched - at ten or eleven documents the per-document
 * share is above the ceiling, so `sampleCharsFor` returns the ceiling and the
 * request is byte-identical to before this existed.
 */
export const SOURCE_JUDGMENT_EXCERPT_BUDGET = 14_000

/**
 * How much of each document to send when there are `count` of them.
 *
 * Pure so the arithmetic is pinned: its two failure modes are a request that
 * silently overflows a context (the one this exists for) and a sample so small
 * that every page reads as noise, which would drop good documents.
 */
export function sampleCharsFor(count: number): number {
  if (count <= 0) return SOURCE_SAMPLE_CHARS
  const share = Math.floor(SOURCE_JUDGMENT_EXCERPT_BUDGET / count)
  return Math.max(MIN_SOURCE_SAMPLE_CHARS, Math.min(SOURCE_SAMPLE_CHARS, share))
}

/**
 * The probability of "worth reading" at or below which a document is dropped.
 *
 * NOT 0.5, and the asymmetry is the point. `EVIDENCE_JUDGMENT_MIN_YES` sits at
 * the model's own yes/no boundary because there both answers cost the same -
 * one heading or the other. Here they do not: keeping a worthless page costs
 * some of the budget, and dropping a good one costs the material the article
 * is made of, on a feature whose measured failure under thin retrieval is
 * copying. So this is a confident-no bar, not a boundary, and the band between
 * it and 0.5 is kept deliberately.
 */
export const SOURCE_DROP_AT_OR_BELOW = 0.25

/**
 * Documents the filter will never go below, whatever the model says.
 *
 * ABOVE THE DECLINE FLOOR ON PURPOSE. `MIN_SUBSTANTIVE_SOURCES` is 2, which is
 * where an analysis stops being worth writing at all; this is where it stops
 * being worth writing WELL. The controlled pair in the file header puts three
 * documents in the copying regime, so a filter allowed to cut to the decline
 * floor could turn a healthy retrieval into the exact input that produces
 * lifted sentences - while every count downstream still read as fine.
 *
 * It is a floor on what survives, not a quota: a title that only ever had
 * three documents keeps all three, because `maxDrops` goes to zero.
 */
export const MIN_SOURCES_AFTER_JUDGMENT = 4

/** The question key for the document at `index`: d1, d2, d3. */
export function sourceJudgmentKey(index: number): string {
  return `d${index + 1}`
}

/** Head of the cleaned text, cut at a word boundary where one is close. */
function excerpt(text: string, max: number): string {
  const value = text.trim()
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export interface SourceJudgmentRequest {
  state: Record<string, unknown>
  questions: Record<string, SystemOneQuestion>
  /** Question keys in document order, so answers map back by position. */
  keys: string[]
}

/**
 * One request, one question per document.
 *
 * The site and the heading are repeated INSIDE each question as well as keyed
 * into the state, following the evidence judge: a model that does not resolve
 * a path into the state still knows which page it is being asked about, and a
 * question that silently refers to nothing would be answered confidently from
 * the state's other documents.
 *
 * The film is named in every question too. "Is this page worth reading" is not
 * answerable without knowing what it is supposed to be about - a thoughtful
 * essay on a different film is noise here, and that is the one shape
 * ./sourceQuality.ts's `isOffTopic` can only catch by counting mentions.
 */
export function buildSourceJudgmentRequest(
  subject: Pick<AnalysisSubject, 'title' | 'originalTitle' | 'year' | 'mediaType'>,
  sources: readonly AnalysisSource[]
): SourceJudgmentRequest {
  const noun = subject.mediaType === 'movie' ? 'film' : 'series'
  const label = subject.year ? `"${subject.title}" (${subject.year})` : `"${subject.title}"`

  // BOTH NAMES, for `buildAnalysisQuery`'s reason one step downstream: the
  // criticism of a non-English film is often written only under its original
  // title, which is why the retrieval query carries that name for about a third
  // of films and why `isOffTopic` counts mentions of both. Asked about the
  // localized name alone, a judge can correctly answer "no" about a document
  // that is the best one in the set - and it would do so hardest on exactly
  // the titles whose retrieval is thinnest.
  const other = subject.originalTitle?.trim()
  const named =
    other && other.toLowerCase() !== subject.title.trim().toLowerCase()
      ? `${label}, also known as "${other}"`
      : label

  const documents: Record<string, unknown> = {}
  const questions: Record<string, SystemOneQuestion> = {}
  const keys: string[] = []
  const sampleChars = sampleCharsFor(sources.length)

  sources.forEach((source, index) => {
    const key = sourceJudgmentKey(index)
    keys.push(key)
    documents[key] = {
      site: source.domain,
      heading: source.title,
      excerpt: excerpt(source.text, sampleChars),
    }
    questions[key] = {
      type: 'noul',
      instructions:
        `Document ${key} was retrieved for the ${noun} ${named}. It is headed "${source.title}" ` +
        `and comes from ${source.domain}; documents.${key}.excerpt is how it begins. ` +
        `Would a writer describing that ${noun} find material in it - criticism or analysis of it, ` +
        `facts about how it was made or who made it, or what critics said about it? ` +
        `Judge the page in front of you, not the reputation of the site. ` +
        `A page can be well written, on a respected site, and still carry nothing about this ${noun}.`,
      criteria: {
        true:
          `It carries writing about this ${noun}: someone's account of what it does, how it works or what it means; ` +
          `facts about its making, its credits or its release; or quoted verdicts from critics, including a review ` +
          `aggregator's page of critic blurbs or an encyclopedia's production and reception sections`,
        false:
          `It carries none of that: listings, where-to-watch or store pages; a cast or crew table with no prose; ` +
          `a plot summary and nothing else; forum, comment or social threads of viewers' opinions; a page promoting ` +
          `a video, podcast or interview whose content is not written out on the page; or navigation and boilerplate`,
      },
    }
  })

  return {
    state: {
      work: {
        title: subject.title,
        // Only when it is a second name, never a restatement - the same test
        // `distinctOriginalTitle` makes for the retrieval query.
        ...(named === label ? {} : { alsoKnownAs: other }),
        year: subject.year,
        type: noun,
      },
      documents,
    },
    questions,
    keys,
  }
}

/**
 * The probability per key, in key order, with null for anything unanswered.
 *
 * DELIBERATELY NOT `readEvidenceJudgments`' all-or-nothing contract. There a
 * partial answer is discarded whole, because a pick's heading is one decision
 * over all its evidence. Here each document is its own decision, so a model
 * that answered nine of eleven should have its nine honoured and the other two
 * kept - and a null, per `readNoul`'s own rule, is never a "no".
 */
export function readSourceJudgments(
  answers: unknown,
  keys: readonly string[]
): (number | null)[] {
  if (!answers || typeof answers !== 'object') return keys.map(() => null)
  const map = answers as Record<string, unknown>
  return keys.map((key) => readNoul(map[key]))
}

// ============================================================================
// The connection test
// ============================================================================

/**
 * Two documents with obvious answers, one each way, built by the SAME request
 * builder a run uses — `testEvidenceJudge`'s design, for its reason: a test
 * that only checked "it answered" passes on a model that answers 0.5 to
 * everything.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE EVIDENCE TEST, which is the hole it
 * closes: that one sends three questions over a tiny state, while this sends
 * one question per document over a sample each. They are different requests,
 * and the Test button proved nothing about the one the operator had just
 * switched on — so the filter could fail on every title forever with nothing
 * but a `warn` to say so. Same argument as `probeFlexTier` (F-146): a path
 * that cannot fall back has to be tried before it is trusted.
 *
 * The article is a review in the shape the live retrieval produced them; the
 * noise page is the podcast episode note that took a slot on the Suspiria run,
 * which is the measured failure rather than an invented one.
 */
export const SOURCE_FILTER_TEST_SUBJECT = {
  title: 'Suspiria',
  originalTitle: null,
  year: 1977,
  mediaType: 'movie' as const,
}

export const SOURCE_FILTER_TEST_ARTICLE: AnalysisSource = {
  title: 'Suspiria (1977) — Review',
  domain: 'deepfocusreview.com',
  text:
    'Dario Argento shot Suspiria on Eastmancolor stock through a printing process that had all but ' +
    'disappeared by 1977, and the result is a film whose reds do not behave like the reds of any other ' +
    'horror picture of its decade. The ballet academy is lit as though from inside its own walls: ' +
    'Luciano Tovoli pushes coloured gels through stained glass and the actors move through fields of ' +
    'red and blue that have no source in the room. Argento has said the palette came from Disney\'s ' +
    'Snow White, and knowing that reframes the whole film — these are fairy-tale colours, not the ' +
    'naturalism Tovoli had shot for Antonioni. The score by Goblin arrives before the images do, a ' +
    'celesta figure over synthesisers that repeats across the running time until it stops being music ' +
    'and becomes a condition of the building. What the film withholds is logic: scenes connect by ' +
    'colour and sound rather than by consequence, and the plot that surfaces in the last reel is thinner ' +
    'than everything that came before it. That is not a failure of construction. The dread is carried ' +
    'entirely by surfaces, and the surfaces do not let up.',
}

export const SOURCE_FILTER_TEST_NOISE: AnalysisSource = {
  title: 'The Film Stage Show Classic — Suspiria (1977)',
  domain: 'thefilmstage.com',
  text:
    'This week on The Film Stage Show Classic, we discuss Dario Argento\'s Suspiria (1977). ' +
    'Listen below and subscribe on Apple Podcasts, Spotify, or wherever you get your podcasts. ' +
    'Follow us on social media for episode announcements. Subscribe to our newsletter. ' +
    'Running time: 1 hour 12 minutes. Previous episodes in this series covered Don\'t Look Now, ' +
    'The Wicker Man, and Picnic at Hanging Rock. Support the show on Patreon. ' +
    'The Film Stage Show is produced weekly. Rate and review us to help others find the show.',
}

/** Filler so the probe is the SIZE a real request would be. See `testSourceFilter`. */
export function sourceFilterTestFiller(index: number): AnalysisSource {
  return {
    title: `Suspiria (1977) — notes ${index}`,
    domain: `example${index}.com`,
    // Prose rather than repeated characters: a sample of one word over and over
    // is not what the budget will carry, and the point of the filler is to make
    // the request realistically large.
    text:
      `Argento's film has been written about steadily since its release. ` +
      `This page collects observations about its photography, its score and its reception. `.repeat(
        40
      ),
  }
}

export interface JudgedSource {
  source: AnalysisSource
  /** P(worth reading), or null when the model did not answer for it. */
  score: number | null
}

export interface SourceJudgmentOutcome {
  kept: AnalysisSource[]
  /** What was dropped and why, for the retrieval log and the bench report. */
  dropped: Array<{ domain: string; title: string; score: number; chars: number }>
  /** Documents the model answered for. Below `kept.length` means a partial answer. */
  answered: number
  /** True when the floor stopped a drop the model asked for. */
  floored: boolean
}

/**
 * Which documents survive.
 *
 * Worst-first up to the floor, so when the model condemns more pages than may
 * be dropped, the ones that go are the ones it was most confident about -
 * rather than whichever happened to be ranked last, which is what a simple
 * "stop dropping once you reach four" would give.
 *
 * Original (relevance) order is preserved in `kept`, because `budgetSources`
 * drops from the tail when its own count cut fires and the search's ranking is
 * the only ordering either step has.
 */
export function decideJudgedSources(judged: readonly JudgedSource[]): SourceJudgmentOutcome {
  const answered = judged.filter((j) => j.score != null).length
  const maxDrops = Math.max(0, judged.length - MIN_SOURCES_AFTER_JUDGMENT)

  const condemned = judged
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.score != null && entry.score <= SOURCE_DROP_AT_OR_BELOW)
    .sort((a, b) => (a.score as number) - (b.score as number))

  const dropping = new Set(condemned.slice(0, maxDrops).map((entry) => entry.index))

  return {
    kept: judged.filter((_, index) => !dropping.has(index)).map((entry) => entry.source),
    dropped: judged
      .map((entry, index) => ({ entry, index }))
      .filter(({ index }) => dropping.has(index))
      .map(({ entry }) => ({
        domain: entry.source.domain,
        title: entry.source.title,
        score: entry.score as number,
        chars: entry.source.text.length,
      })),
    answered,
    floored: condemned.length > dropping.size,
  }
}
