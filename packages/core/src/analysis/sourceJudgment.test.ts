import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_SOURCES_AFTER_JUDGMENT,
  MIN_SUBSTANTIVE_AFTER_JUDGMENT,
  MIN_SOURCE_SAMPLE_CHARS,
  MIN_SAMPLE_SLICE_CHARS,
  SAMPLE_ELISION,
  SOURCE_JUDGMENT_EXCERPT_BUDGET,
  SOURCE_DROP_AT_OR_BELOW,
  SOURCE_SAMPLE_CHARS,
  buildSourceJudgmentRequest,
  judgmentExcerpt,
  decideJudgedSources,
  readSourceJudgments,
  sampleCharsFor,
  sourceJudgmentKey,
  SOURCE_FILTER_TEST_ARTICLE,
  SOURCE_FILTER_TEST_NOISE,
  sourceFilterTestFiller,
  type JudgedSource,
} from './sourceJudgment.js'
import { MIN_SUBSTANTIVE_SOURCES } from './sourceFloor.js'
import { MAX_CURATED_RESULTS, MAX_RESULTS } from '../lib/crw.js'
import type { AnalysisSource } from './prompt.js'

const SUBJECT = {
  title: 'Suspiria',
  originalTitle: null,
  year: 1977,
  mediaType: 'movie' as const,
}

function source(domain: string, title: string, text = 'A sentence about the film. '.repeat(40)): AnalysisSource {
  return { domain, title, text }
}

/** The eleven-document live retrieval this feature was written against. */
function liveRetrieval(): AnalysisSource[] {
  return [
    source('rogerebert.com', '"Suspiria" at 40'),
    source('bfi.org.uk', 'Argento on Suspiria - a video inquiry'),
    source('offscreen.com', 'Suspiria (Dario Argento, 1977)'),
    source('thefilmstage.com', 'The Film Stage Show Classic - Suspiria'),
    source('rottentomatoes.com', 'Suspiria | Rotten Tomatoes'),
    source('metacritic.com', 'Suspiria Reviews - Metacritic'),
    source('reviewsonreels.ca', 'Suspiria (1977) Review'),
    source('deepfocusreview.com', 'Suspiria (1977) | Deep Focus Review'),
    source('horrormovietalk.com', 'Suspiria (1977) Review'),
    source('screenagewasteland.com', "'Suspiria' (1977) Review"),
    source('reddit.com', 'Suspiria (1977) is the best Horror movie of all time'),
  ]
}

// ============================================================================
// The request
// ============================================================================

test('one question per document, keyed in order and self-describing', () => {
  const sources = liveRetrieval()
  const request = buildSourceJudgmentRequest(SUBJECT, sources)

  assert.equal(request.keys.length, sources.length)
  assert.deepEqual(request.keys, sources.map((_, i) => sourceJudgmentKey(i)))
  assert.deepEqual(Object.keys(request.questions), request.keys)

  // Named in the question as well as keyed into the state: a model that does
  // not resolve the path still knows which page it is judging, and which film.
  const q = request.questions.d2.instructions
  assert.ok(q.includes('bfi.org.uk'))
  assert.ok(q.includes('Argento on Suspiria - a video inquiry'))
  assert.ok(q.includes('"Suspiria" (1977)'))
  assert.ok(q.includes('documents.d2.excerpt'))

  const documents = (request.state.documents as Record<string, { site: string }>)
  assert.equal(documents.d2.site, 'bfi.org.uk')
  assert.deepEqual(request.state.work, { title: 'Suspiria', year: 1977, type: 'film' })
})

test('a series is asked about as a series', () => {
  const request = buildSourceJudgmentRequest(
    { title: 'Severance', year: 2022, mediaType: 'series' },
    [source('vulture.com', 'Severance recap')]
  )
  assert.equal((request.state.work as { type: string }).type, 'series')
  assert.ok(request.questions.d1.instructions.includes('the series "Severance" (2022)'))
  assert.ok(!request.questions.d1.instructions.includes('film'))
})

test('a year-less subject is named without an empty bracket', () => {
  const request = buildSourceJudgmentRequest(
    { title: 'Untitled', year: null, mediaType: 'movie' },
    [source('example.com', 'A review')]
  )
  assert.ok(request.questions.d1.instructions.includes('"Untitled"'))
  assert.ok(!request.questions.d1.instructions.includes('()'))
})

/**
 * THE DOCUMENT COUNT IS A SETTING, which the first version did not know.
 * `maxResults` (≤20) plus `curatedMaxResults` (≤20) allows 40 documents, and a
 * flat per-document sample put the state near 22,000 tokens there — past the
 * 8k the smallest hosted System One model serves. An overflow answers 400 and
 * the feature falls open, so the filter would never work and say nothing.
 */
test('the excerpt budget holds at every legal document count', () => {
  const ceiling = MAX_RESULTS + MAX_CURATED_RESULTS
  for (const n of [1, 2, 10, 11, 20, ceiling]) {
    const per = sampleCharsFor(n)
    assert.ok(per <= SOURCE_SAMPLE_CHARS, `${n}: never above the ceiling`)
    assert.ok(per >= MIN_SOURCE_SAMPLE_CHARS, `${n}: never below a readable sample`)
    assert.ok(per * n <= SOURCE_JUDGMENT_EXCERPT_BUDGET, `${n}: total within budget`)
  }
})

/**
 * THE COUPLING, pinned because nothing else would notice it break. The budget
 * can only hold at the ceiling while it is at least the floor times the most
 * documents the retrieval settings can produce — and that ceiling lives in
 * `lib/crw.ts`, two modules away, as the clamps on two admin-editable numbers.
 * Raise either clamp and the per-document sample stops shrinking far enough,
 * so the request grows past the context it was sized for and the filter falls
 * open on every title with nothing but a `warn`. This test is the only thing
 * that connects those two facts.
 */
test('the budget can absorb the most documents the settings allow', () => {
  const ceiling = MAX_RESULTS + MAX_CURATED_RESULTS
  assert.ok(
    SOURCE_JUDGMENT_EXCERPT_BUDGET / MIN_SOURCE_SAMPLE_CHARS >= ceiling,
    `budget ${SOURCE_JUDGMENT_EXCERPT_BUDGET} / floor ${MIN_SOURCE_SAMPLE_CHARS} must cover ${ceiling} documents`
  )
})

/**
 * Past the ceiling the FLOOR wins and the request grows — deliberate, and
 * documented on `MIN_SOURCE_SAMPLE_CHARS`: a sample too small to say what a
 * page is would drop good documents, which costs more than a long request.
 * Unreachable through the settings; pinned so the choice is not read as a bug.
 */
test('beyond the settings ceiling the floor wins over the budget', () => {
  assert.equal(sampleCharsFor(500), MIN_SOURCE_SAMPLE_CHARS)
  assert.ok(sampleCharsFor(500) * 500 > SOURCE_JUDGMENT_EXCERPT_BUDGET)
})

/**
 * The budget is sized so the DEFAULTS are untouched — at ten or eleven
 * documents the share is above the ceiling, so the request is byte-identical
 * to what shipped before the budget existed. A budget that changed the common
 * case would be a behaviour change wearing a bug fix's clothes.
 */
test('the live retrieval sizes are unchanged by the budget', () => {
  for (const n of [1, 10, 11]) assert.equal(sampleCharsFor(n), SOURCE_SAMPLE_CHARS)
  assert.ok(sampleCharsFor(20) < SOURCE_SAMPLE_CHARS, 'twenty documents start shrinking')
  assert.equal(sampleCharsFor(0), SOURCE_SAMPLE_CHARS, 'no documents is not a division by zero')
})

test('the budget shrinks the sample rather than the document list', () => {
  const many = Array.from({ length: 40 }, (_, i) => source(`s${i}.com`, `Doc ${i}`, 'word '.repeat(2_000)))
  const request = buildSourceJudgmentRequest(SUBJECT, many)
  assert.equal(request.keys.length, 40, 'every document is still asked about')
  const documents = request.state.documents as Record<string, { excerpt: string }>
  const total = Object.values(documents).reduce((sum, d) => sum + d.excerpt.length, 0)
  assert.ok(total <= SOURCE_JUDGMENT_EXCERPT_BUDGET + 40, 'within the budget plus one ellipsis each')
})

/**
 * BOTH NAMES REACH THE JUDGE, for `buildAnalysisQuery`'s reason: criticism of a
 * non-English film is often written only under its original title. Asked about
 * the localized name alone, the judge can answer "no" correctly about the best
 * document in the set — hardest on the titles whose retrieval is thinnest.
 */
test('an original title is named in the question and the state', () => {
  const request = buildSourceJudgmentRequest(
    { title: 'The Zero Years', originalTitle: 'Ta Mhdenika Chronia', year: 2005, mediaType: 'movie' },
    [source('offscreen.com', 'A review')]
  )
  assert.ok(request.questions.d1.instructions.includes('Ta Mhdenika Chronia'))
  assert.ok(request.questions.d1.instructions.includes('The Zero Years'))
  assert.equal((request.state.work as { alsoKnownAs?: string }).alsoKnownAs, 'Ta Mhdenika Chronia')
})

/**
 * A RESTATEMENT IS NOT A SECOND NAME — `distinctOriginalTitle`'s rule. Naming
 * the same string twice spends request size on nothing and reads as two films.
 */
test('an original title equal to the title is not repeated', () => {
  for (const original of ['Suspiria', 'suspiria', '  Suspiria  ', null]) {
    const request = buildSourceJudgmentRequest(
      { title: 'Suspiria', originalTitle: original, year: 1977, mediaType: 'movie' },
      [source('a.com', 'A')]
    )
    assert.ok(!('alsoKnownAs' in (request.state.work as object)), `${original}: not a second name`)
    assert.ok(!request.questions.d1.instructions.includes('also known as'))
  }
})

test('the excerpt is bounded, and a short document is sent whole', () => {
  const long = source('example.com', 'Long', 'word '.repeat(5_000))
  const short = source('example.com', 'Short', 'Three words here.')
  const request = buildSourceJudgmentRequest(SUBJECT, [long, short])
  const documents = request.state.documents as Record<string, { excerpt: string }>

  assert.ok(
    documents.d1.excerpt.length <= SOURCE_SAMPLE_CHARS + SAMPLE_ELISION.length + 1,
    'the elision mark and the ellipsis are the only overrun'
  )
  assert.ok(documents.d1.excerpt.endsWith('…'))
  assert.equal(documents.d2.excerpt, 'Three words here.')
})

/**
 * THE HEAD WAS NOT A FAIR SAMPLE, and how unfair depended on house style.
 *
 * Measured on the first live run: a 21,353-character rogerebert.com essay -
 * the best document in the retrieval - scored 0.67 against a 1,162-character
 * blog review at 0.90, because its opening 1,300 characters are the writer's
 * childhood memory of seeing the poster and never name the film. The thin page
 * was read whole and the deep one at 6%, which flattered precisely the
 * documents this filter exists to remove.
 */
test('a long document is sampled in two places, not just at its head', () => {
  const opening = 'An anecdote about a poster, which names no film at all. '.repeat(40)
  const body = 'The camera tracks the corridor while the score refuses to resolve. '.repeat(200)
  const sample = judgmentExcerpt(opening + body, SOURCE_SAMPLE_CHARS)

  assert.ok(sample.includes(SAMPLE_ELISION), 'the jump is marked')
  const [head, middle] = sample.split(SAMPLE_ELISION)
  assert.ok(head.startsWith('An anecdote'), 'the opening is still shown first')
  assert.ok(middle.includes('the score refuses to resolve'), 'and the body is shown too')
  assert.ok(
    sample.length <= SOURCE_SAMPLE_CHARS + SAMPLE_ELISION.length + 1,
    'two slices cost the same budget as one'
  )
})

/**
 * Below twice the sample the two slices abut, and marking an elision of nothing
 * teaches the model that this page breaks off when it does not.
 */
test('a document barely over the sample is read straight through', () => {
  const text = 'word '.repeat(300) // 1,500 chars against a 1,200 sample
  const sample = judgmentExcerpt(text, SOURCE_SAMPLE_CHARS)
  assert.ok(!sample.includes('[…]'), 'no elision for a gap of nothing')
  assert.ok(sample.endsWith('…'))
  assert.ok(sample.length <= SOURCE_SAMPLE_CHARS + 1)
})

test('a sample too small to split is left contiguous', () => {
  // 40 documents is the legal ceiling, where the share is MIN_SOURCE_SAMPLE_CHARS
  // and a 60% head would be under MIN_SAMPLE_SLICE_CHARS. One window beats two
  // fragments, and at forty documents no sample of any shape is representative.
  const small = sampleCharsFor(40)
  assert.ok(Math.round(small * 0.6) < MIN_SAMPLE_SLICE_CHARS)
  const sample = judgmentExcerpt('word '.repeat(5_000), small)
  assert.ok(!sample.includes('[…]'))
  assert.ok(sample.length <= small + 1)
})

test('a document at or under the sample is returned untouched, with no mark', () => {
  assert.equal(judgmentExcerpt('  Three words here.  ', SOURCE_SAMPLE_CHARS), 'Three words here.')
  const exact = 'a'.repeat(SOURCE_SAMPLE_CHARS)
  assert.equal(judgmentExcerpt(exact, SOURCE_SAMPLE_CHARS), exact)
})

/**
 * The marker has to be described or an abrupt jump reads as a broken page -
 * which is itself one of the noise shapes the judge is asked to look for.
 */
test('the question says the sample is two passages, not an opening', () => {
  const request = buildSourceJudgmentRequest(SUBJECT, [source('a.com', 'A')])
  const q = request.questions.d1.instructions
  assert.ok(q.includes('[…]'), 'the mark is named')
  assert.ok(/middle of the same page/.test(q))
  assert.ok(!/is how it begins/.test(q), 'it is no longer only the beginning')
})

/**
 * THE THREE SHAPES THIS EXISTS TO DROP, and the two it must not, named in the
 * criteria so the line is drawn where the live retrieval put it. An
 * aggregator's blurb page is where the only two correct critic attributions in
 * the Suspiria bench came from, so a criterion that reads as "criticism only"
 * would take the reception answer's whole evidence base with it.
 */
test('the criteria name the aggregator and the encyclopedia as worth keeping', () => {
  const { criteria } = buildSourceJudgmentRequest(SUBJECT, [source('a.com', 'A')]).questions.d1
  assert.ok(criteria)
  assert.ok(criteria.true.includes('aggregator'))
  assert.ok(criteria.true.includes('encyclopedia'))
  for (const noise of ['forum', 'plot summary', 'where-to-watch']) {
    assert.ok(criteria.false.includes(noise), noise + ' is named as noise')
  }
})

/**
 * THE TEST IS THE MEDIUM OF THE SUBSTANCE, NOT ITS SOURCE, and the first draft
 * got that wrong in a way that would have cost the one document that matters.
 *
 * It asked whether the page "says what it knows, or only says that something
 * elsewhere knows it" - and Metacritic says "the New York Times knows this,
 * and here is what it said". It points elsewhere AND writes the substance out,
 * so that phrasing invites dropping the page both correct critic attributions
 * in the 17-vs-18 bench came from. The same draft also named "a score
 * round-up" as noise, which Metacritic literally is.
 *
 * So the question asks whether the material is ON THE PAGE AS TEXT. BFI's
 * Suspiria page fails it (a video, verified on the live page: three paragraphs
 * of blurb and a list of what the interview covers, no transcript), The Film
 * Stage fails it (audio), and every aggregator passes it.
 */
test('the question asks about the medium of the substance, not its source', () => {
  const { instructions, criteria } = buildSourceJudgmentRequest(SUBJECT, [source('a.com', 'A')])
    .questions.d1
  assert.ok(instructions.includes('IS THE MATERIAL ON THE PAGE AS TEXT'))
  assert.ok(instructions.includes('audio or video recording carries nothing'))
  assert.ok(criteria)
  assert.ok(criteria.true.includes('written out on the page'))
  assert.ok(criteria.false.includes('not transcribed on the page'))
  // The naming-what-it-covers clause: BFI's whole substance is that list.
  assert.ok(criteria.false.includes('names what that recording covers'))
  // And nothing anywhere may read as "an aggregator is a pointer".
  assert.ok(!/score round-?up/i.test(criteria.false))
})

/**
 * A STATEMENT OF STANDING IS NOT AN ACCOUNT. "has gained a reputation as one
 * of the key horror films of all time" is nobody's view, unquotable, and is
 * what the prompt's own source rule calls an encyclopedia's summary of what
 * critics think. The first draft instead asked for an account that was
 * "specific or argued", which F-124 settled in the other direction: for an
 * obscure film a plain genre description is the only available answer, and the
 * whole feature errs toward keeping.
 */
test('a statement of standing is named as noise, and plain description is not', () => {
  const { criteria } = buildSourceJudgmentRequest(SUBJECT, [source('a.com', 'A')]).questions.d1
  assert.ok(criteria)
  assert.ok(criteria.false.includes("statement of the work's standing"));
  assert.ok(criteria.false.includes('widely regarded as'))
  // Nothing requires an account to be argued, which would drop the only
  // document an obscure title has.
  assert.ok(!/\bargued\b/.test(criteria.true))
})

// ============================================================================
// Reading the answer
// ============================================================================

test('a missing or malformed answer is null, never a no', () => {
  const keys = ['d1', 'd2', 'd3', 'd4']
  const scores = readSourceJudgments(
    { d1: { type: 'noul', noul: 0.9 }, d2: { type: 'noul', noul: 1.4 }, d3: 'nope' },
    keys
  )
  assert.deepEqual(scores, [0.9, null, null, null])
})

/**
 * The deliberate difference from `readEvidenceJudgments`, which discards a
 * partial answer whole. A pick's heading is one decision over all its
 * evidence; a document's worth is its own decision, so nine good answers are
 * nine good answers.
 */
test('a partial answer is honoured, not discarded', () => {
  const scores = readSourceJudgments({ d1: { type: 'noul', noul: 0.1 } }, ['d1', 'd2'])
  assert.deepEqual(scores, [0.1, null])
})

test('no answers at all reads as nothing judged', () => {
  assert.deepEqual(readSourceJudgments(null, ['d1', 'd2']), [null, null])
  assert.deepEqual(readSourceJudgments({}, ['d1']), [null])
})

// ============================================================================
// The decision
// ============================================================================

function judged(scores: (number | null)[]): JudgedSource[] {
  return scores.map((score, i) => ({ source: source(`s${i}.com`, `Doc ${i}`), score }))
}

test('the live retrieval drops exactly the three that carry nothing', () => {
  const sources = liveRetrieval()
  // bfi (video promo), thefilmstage (podcast note), reddit (thread chatter).
  const scores = [0.97, 0.08, 0.95, 0.05, 0.71, 0.84, 0.9, 0.98, 0.66, 0.92, 0.11]
  const outcome = decideJudgedSources(sources.map((s, i) => ({ source: s, score: scores[i] })))

  assert.deepEqual(
    outcome.dropped.map((d) => d.domain).sort(),
    ['bfi.org.uk', 'reddit.com', 'thefilmstage.com']
  )
  assert.equal(outcome.kept.length, 8)
  assert.equal(outcome.answered, 11)
  assert.equal(outcome.floored, false)
  // The aggregators survive on a middling score, which is the whole reason the
  // bar is a confident-no rather than 0.5.
  assert.ok(outcome.kept.some((s) => s.domain === 'metacritic.com'))
  assert.ok(outcome.kept.some((s) => s.domain === 'rottentomatoes.com'))
})

test('relevance order is preserved in what survives', () => {
  const outcome = decideJudgedSources(judged([0.9, 0.01, 0.8, 0.02, 0.7, 0.6, 0.5]))
  assert.deepEqual(
    outcome.kept.map((s) => s.title),
    ['Doc 0', 'Doc 2', 'Doc 4', 'Doc 5', 'Doc 6']
  )
})

/**
 * THE RAIL THAT MATTERS. F-124's controlled pair put three documents in the
 * copying regime, so a filter free to cut to the decline floor could turn a
 * healthy retrieval into the input that produces lifted sentences - with every
 * count downstream still reading as fine.
 */
test('the floor holds however confident the model is', () => {
  const outcome = decideJudgedSources(judged([0.01, 0.02, 0.03, 0.04, 0.05, 0.06]))
  assert.equal(outcome.kept.length, MIN_SOURCES_AFTER_JUDGMENT)
  assert.equal(outcome.floored, true)
})

test('the floor sits above the decline floor, deliberately', () => {
  assert.ok(MIN_SOURCES_AFTER_JUDGMENT > MIN_SUBSTANTIVE_SOURCES)
})

test('worst-first, so the floor spends its drops on the clearest noise', () => {
  // Five condemned, one drop available: the 0.01 goes and the 0.2 stays.
  const outcome = decideJudgedSources(judged([0.2, 0.15, 0.01, 0.1, 0.05]))
  assert.equal(outcome.kept.length, MIN_SOURCES_AFTER_JUDGMENT)
  assert.deepEqual(outcome.dropped.map((d) => d.score), [0.01])
})

test('a retrieval at or below the floor loses nothing', () => {
  for (const n of [1, 2, 3, MIN_SOURCES_AFTER_JUDGMENT]) {
    const outcome = decideJudgedSources(judged(Array.from({ length: n }, () => 0)))
    assert.equal(outcome.kept.length, n, `${n} documents are kept whole`)
    assert.deepEqual(outcome.dropped, [])
  }
})

test('an unjudged document is never dropped', () => {
  const outcome = decideJudgedSources(judged([null, null, null, null, null, null]))
  assert.deepEqual(outcome.dropped, [])
  assert.equal(outcome.answered, 0)
  // Nulls do not count as condemned, so the floor was never reached for.
  assert.equal(outcome.floored, false)
})

test('a partial answer drops only what it answered for', () => {
  const outcome = decideJudgedSources(judged([0.02, null, 0.9, 0.8, 0.7, null]))
  assert.deepEqual(outcome.dropped.map((d) => d.title), ['Doc 0'])
  assert.equal(outcome.answered, 4)
})

/**
 * The bar is "at or below", so a model answering a flat 0.25 condemns rather
 * than spares. Pinned because the inequality is the one thing an edit here
 * could flip without any test noticing.
 */
test('the bar is inclusive', () => {
  const onBar = decideJudgedSources(judged([SOURCE_DROP_AT_OR_BELOW, 0.9, 0.9, 0.9, 0.9]))
  assert.equal(onBar.dropped.length, 1)
  const justOver = decideJudgedSources(judged([SOURCE_DROP_AT_OR_BELOW + 0.01, 0.9, 0.9, 0.9, 0.9]))
  assert.deepEqual(justOver.dropped, [])
})

test('an empty retrieval is an empty answer, not a throw', () => {
  const outcome = decideJudgedSources([])
  assert.deepEqual(outcome.kept, [])
  assert.deepEqual(outcome.dropped, [])
  assert.equal(outcome.answered, 0)
})

test('what was dropped is reported well enough to argue with', () => {
  const outcome = decideJudgedSources([
    { source: source('reddit.com', 'Best horror ever', 'x'.repeat(13_318)), score: 0.04 },
    ...judged([0.9, 0.9, 0.9, 0.9]),
  ])
  assert.deepEqual(outcome.dropped, [
    { domain: 'reddit.com', title: 'Best horror ever', score: 0.04, chars: 13_318 },
  ])
})

/**
 * THE PROBE DOCUMENTS MUST BE RECOGNISABLY WHAT THEY CLAIM TO BE, or the
 * connection test it feeds is theatre. The review has to read as criticism and
 * the noise page as a podcast promo — the measured failure from the live
 * Suspiria retrieval, not an invented one — and both must clear the upstream
 * filters that would otherwise have dropped them before any judge saw them.
 */
test('the probe documents are a real article and a real noise page', () => {
  assert.ok(SOURCE_FILTER_TEST_ARTICLE.text.length > MIN_SOURCE_SAMPLE_CHARS)
  assert.ok(SOURCE_FILTER_TEST_NOISE.text.length > 200, 'above sourceQuality MIN_USEFUL_CHARS')
  // The article names craft; the noise page names subscription furniture. If
  // these two ever read alike the probe cannot report `discriminates`.
  assert.ok(/Tovoli|celesta|Eastmancolor/.test(SOURCE_FILTER_TEST_ARTICLE.text))
  // The noise page is the HARD case: it describes the film in the vocabulary
  // of criticism and carries nothing, which is why it cleared the bar on the
  // live bench where a podcast note did not. Its tells are a recording it only
  // points at, and a statement of standing.
  assert.ok(/video interview/i.test(SOURCE_FILTER_TEST_NOISE.text))
  assert.ok(/gained a reputation/i.test(SOURCE_FILTER_TEST_NOISE.text))
  assert.ok(/discuss the many/i.test(SOURCE_FILTER_TEST_NOISE.text), 'names what the interview covers')
  // And it must NOT be separable by vocabulary alone - it uses film-talk too,
  // so a probe that passes on keyword contrast is not testing the criteria.
  assert.ok(/storytelling|score|palette/i.test(SOURCE_FILTER_TEST_NOISE.text))
  assert.ok(!/video interview|gained a reputation/i.test(SOURCE_FILTER_TEST_ARTICLE.text))
  // Both name the film, so `isOffTopic`'s question is not what is being asked.
  for (const doc of [SOURCE_FILTER_TEST_ARTICLE, SOURCE_FILTER_TEST_NOISE]) {
    assert.ok(/Suspiria|Argento/.test(doc.text + doc.title))
  }
})

test('the probe documents go first, so their keys are stable', () => {
  const request = buildSourceJudgmentRequest(SUBJECT, [
    SOURCE_FILTER_TEST_ARTICLE,
    SOURCE_FILTER_TEST_NOISE,
    ...Array.from({ length: 38 }, (_, i) => sourceFilterTestFiller(i + 2)),
  ])
  assert.equal(request.keys[0], 'd1')
  assert.equal(request.keys[1], 'd2')
  const documents = request.state.documents as Record<string, { site: string }>
  assert.equal(documents.d1.site, 'deepfocusreview.com')
  assert.equal(documents.d2.site, 'bfi.org.uk')
})

// ============================================================================
// The substantive rail
// ============================================================================

const BIG = 'A real sentence about the film. '.repeat(40) // ~1,280 chars
const THIN = 'Short page.' // under MIN_SUBSTANTIVE_SOURCE_CHARS

function mixed(spec: Array<{ score: number | null; big: boolean }>): JudgedSource[] {
  return spec.map((s, i) => ({
    source: source(`s${i}.com`, `Doc ${i}`, s.big ? BIG : THIN),
    score: s.score,
  }))
}

/**
 * THE RAIL THAT GUARDS THE FLOOR THAT ACTUALLY DECLINES. The count rail says
 * nothing about `decideAnalysisFloor`, which counts documents of at least
 * MIN_SUBSTANTIVE_SOURCE_CHARS and stores a DECLINE below two of them —
 * retiring the title until the staleness floor moves.
 */
test('the substantive rail stops a drop the count rail would allow', () => {
  // Eight documents, three substantive, all three condemned. The count rail
  // alone would drop all three (8 - 4 = 4 drops available) and leave zero.
  const outcome = decideJudgedSources(
    mixed([
      { score: 0.02, big: true },
      { score: 0.03, big: true },
      { score: 0.04, big: true },
      { score: 0.9, big: false },
      { score: 0.9, big: false },
      { score: 0.9, big: false },
      { score: 0.9, big: false },
      { score: 0.9, big: false },
    ])
  )
  const keptBig = outcome.kept.filter((s) => s.text.length >= 600).length
  assert.equal(keptBig, MIN_SUBSTANTIVE_AFTER_JUDGMENT, 'never below the decline floor')
  assert.equal(outcome.dropped.length, 1, 'only the worst substantive one goes')
  assert.equal(outcome.floored, true)
})

/**
 * CONTINUE, NOT BREAK. A protected article must not shield the thin pages
 * below it — those are usually exactly what the filter exists to remove.
 */
test('a barred substantive document does not stop later thin drops', () => {
  // EXACTLY the substantive floor, so the worst-scoring document is barred:
  // dropping it would leave one, and `decideAnalysisFloor` declines below two.
  const outcome = decideJudgedSources(
    mixed([
      { score: 0.01, big: true }, // worst, substantive, and barred
      { score: 0.05, big: false }, // must still go
      { score: 0.06, big: false }, // must still go
      { score: 0.9, big: true }, // the other substantive one
      { score: 0.9, big: false },
      { score: 0.9, big: false },
      { score: 0.9, big: false },
    ])
  )
  assert.deepEqual(outcome.dropped.map((d) => d.title).sort(), ['Doc 1', 'Doc 2'])
  assert.ok(
    outcome.kept.some((s) => s.title === 'Doc 0'),
    'the protected article survives'
  )
  assert.equal(outcome.floored, true, 'a barred drop is reported')
})

test('with substantive documents to spare the rail is invisible', () => {
  const outcome = decideJudgedSources(
    mixed([
      { score: 0.02, big: true },
      { score: 0.9, big: true },
      { score: 0.9, big: true },
      { score: 0.9, big: true },
      { score: 0.9, big: true },
    ])
  )
  assert.equal(outcome.dropped.length, 1)
  assert.equal(outcome.floored, false)
})

test('a retrieval with no substantive documents is still bounded by the count rail', () => {
  const outcome = decideJudgedSources(
    mixed(Array.from({ length: 9 }, () => ({ score: 0.01, big: false })))
  )
  assert.equal(outcome.kept.length, MIN_SOURCES_AFTER_JUDGMENT)
  assert.equal(outcome.floored, true)
})
