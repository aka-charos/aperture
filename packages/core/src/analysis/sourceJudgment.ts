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
import { MIN_SUBSTANTIVE_SOURCES, MIN_SUBSTANTIVE_SOURCE_CHARS } from './sourceFloor.js'
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

/**
 * Substantive documents the filter will never go below — the SECOND rail, and
 * the one that answers the floor `decideAnalysisFloor` actually reads.
 *
 * THE FIRST VERSION GUARDED THE WRONG QUANTITY. `MIN_SOURCES_AFTER_JUDGMENT`
 * counts documents; the decline floor counts documents of at least
 * `MIN_SUBSTANTIVE_SOURCE_CHARS` and declines a title at fewer than
 * `MIN_SUBSTANTIVE_SOURCES` of those. Nothing connected the two, so a filter
 * obeying its own floor perfectly could still drop a title past the one that
 * matters — and a decline is STORED, retiring the title until
 * `ANALYSIS_STALE_BELOW` moves.
 *
 * It is unlikely rather than impossible, because `budgetSources` hands fewer
 * survivors bigger slices and pushes substantive counts UP. That is an
 * argument for the probability, not for leaving two floors measuring different
 * things with nothing holding them together.
 *
 * Measured against the SAMPLE the model was shown, not the budgeted text: this
 * runs before `budgetSources`, so a survivor's slice can only grow from here.
 * Judging by pre-budget length is therefore the conservative direction.
 */
export const MIN_SUBSTANTIVE_AFTER_JUDGMENT = MIN_SUBSTANTIVE_SOURCES

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
        `IS THE MATERIAL ON THE PAGE AS TEXT, or is it somewhere the page only points at? ` +
        `A page whose substance is an audio or video recording carries nothing, however well its ` +
        `blurb describes the ${noun} and however much it names what the recording covers. ` +
        `Judge the page in front of you, not the reputation of the site: a page can be well ` +
        `written, on a respected site, and still carry nothing about this ${noun}.`,
      criteria: {
        true:
          `The material is written out on the page: someone's account of what it does, how it works or what ` +
          `it means; facts about its making, its credits or its release; or critics' verdicts quoted in full ` +
          `enough to use, which includes a review aggregator's page of critic blurbs and an encyclopedia's ` +
          `production and reception sections`,
        false:
          `It carries none of that: a blurb for an audio or video recording that is not transcribed on the page, ` +
          `however much it names what that recording covers; a statement of the work's standing with nobody ` +
          `behind it, such as that it is widely regarded as a classic of its genre; listings, where-to-watch or ` +
          `store pages; a cast or crew table with no prose; a plot summary and nothing else; forum, comment or ` +
          `social threads of viewers' opinions; a question-and-answer or ending-explained page assembled around ` +
          `the plot; or navigation and boilerplate`,
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

/**
 * THE HARD CASE, not the easy one. The podcast note the filter correctly
 * dropped at 0.16 was the first choice here and it tests nothing: it is mostly
 * subscribe-and-Patreon, so any reading of the criteria rejects it.
 *
 * This is the BFI page's shape instead - verified against the live page, which
 * is three paragraphs and nothing else: a sentence of reputation, a plug for a
 * restoration, and a list of what a filmed interview covers. It describes the
 * film WELL, in the vocabulary of criticism, and carries nothing, which is why
 * it scored above the bar on the live bench while the podcast note did not. A
 * probe that cannot separate this from a review is not telling the operator
 * anything they need.
 */
export const SOURCE_FILTER_TEST_NOISE: AnalysisSource = {
  title: 'Argento on Suspiria - a video inquiry | Sight and Sound',
  domain: 'bfi.org.uk',
  text:
    'The master of giallo looks back on his horror masterpiece at 40 in this celebratory video ' +
    'interview. Since its release in 1977, Dario Argento\'s supernatural slasher Suspiria has ' +
    'gained a reputation as not just his own greatest work but, with its hallucinogenic ' +
    'storytelling, bravura set piece slayings and Goblin\'s pulsating prog rock score, as one of ' +
    'the key horror films of all time. The 40th anniversary produced a valedictory world tour and ' +
    'a stunning new restoration which showcases the film\'s vibrant palette in all its deep red ' +
    'glory. We caught up with Argento in London to discuss the many - including some highly ' +
    'unlikely - influences on Suspiria, why he broke away from the giallo thriller genre, his ' +
    'thoughts on working with women and how he influenced Goblin\'s musical direction with an ' +
    'impromptu trip to Greece. And though Argento has talked many times about the film, this ' +
    'video sheds fascinating new light on his creative inspirations.',
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

export interface JudgedSourceScore {
  domain: string
  title: string
  /** P(worth reading), or null when the model did not answer for it. */
  score: number | null
  chars: number
  kept: boolean
}

export interface SourceJudgmentOutcome {
  kept: AnalysisSource[]
  /** What was dropped and why, for the retrieval log and the bench report. */
  dropped: Array<{ domain: string; title: string; score: number; chars: number }>
  /**
   * EVERY document's score, kept and dropped alike, in relevance order.
   *
   * Reporting only the drops was a real instrument gap: on the first live run
   * `bfi.org.uk` survived and nothing could say whether it scored 0.26 — the
   * bar a hair too strict — or 0.92, the criteria wrong. Those need opposite
   * fixes, and the one number that separates them was the one number not
   * printed. A filter nobody can see the near-misses of cannot be tuned.
   */
  scores: JudgedSourceScore[]
  /** Documents the model answered for. Below `kept.length` means a partial answer. */
  answered: number
  /** True when a rail stopped a drop the model asked for. */
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

  const condemned = judged
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.score != null && entry.score <= SOURCE_DROP_AT_OR_BELOW)
    .sort((a, b) => (a.score as number) - (b.score as number))

  // TWO RAILS, checked per drop rather than as one subtraction, because they
  // bind on different documents: the count rail is about how much material is
  // left and the substantive rail is about whether `decideAnalysisFloor` will
  // still store the result.
  const substantial = (entry: JudgedSource) =>
    entry.source.text.trim().length >= MIN_SUBSTANTIVE_SOURCE_CHARS

  const dropping = new Set<number>()
  let left = judged.length
  let leftSubstantive = judged.filter(substantial).length
  let blocked = false

  for (const entry of condemned) {
    if (left <= MIN_SOURCES_AFTER_JUDGMENT) {
      blocked = true
      break
    }
    if (substantial(entry) && leftSubstantive <= MIN_SUBSTANTIVE_AFTER_JUDGMENT) {
      // CONTINUE, NOT BREAK. The substantive rail bars this document and says
      // nothing about the thin ones further down the list, which are usually
      // exactly what the filter exists to remove. Breaking here would let one
      // protected article stop every later drop.
      blocked = true
      continue
    }
    dropping.add(entry.index)
    left--
    if (substantial(entry)) leftSubstantive--
  }

  return {
    scores: judged.map((entry, index) => ({
      domain: entry.source.domain,
      title: entry.source.title,
      score: entry.score,
      chars: entry.source.text.length,
      kept: !dropping.has(index),
    })),
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
    floored: blocked,
  }
}
