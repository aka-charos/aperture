import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_SOURCES_AFTER_JUDGMENT,
  SOURCE_DROP_AT_OR_BELOW,
  SOURCE_SAMPLE_CHARS,
  buildSourceJudgmentRequest,
  decideJudgedSources,
  readSourceJudgments,
  sourceJudgmentKey,
  type JudgedSource,
} from './sourceJudgment.js'
import { MIN_SUBSTANTIVE_SOURCES } from './sourceFloor.js'
import type { AnalysisSource } from './prompt.js'

const SUBJECT = { title: 'Suspiria', year: 1977, mediaType: 'movie' as const }

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

test('the excerpt is bounded, and a short document is sent whole', () => {
  const long = source('example.com', 'Long', 'word '.repeat(5_000))
  const short = source('example.com', 'Short', 'Three words here.')
  const request = buildSourceJudgmentRequest(SUBJECT, [long, short])
  const documents = request.state.documents as Record<string, { excerpt: string }>

  assert.ok(documents.d1.excerpt.length <= SOURCE_SAMPLE_CHARS + 1, 'the ellipsis is the only overrun')
  assert.ok(documents.d1.excerpt.endsWith('…'))
  assert.equal(documents.d2.excerpt, 'Three words here.')
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
  for (const noise of ['forum', 'podcast', 'plot summary', 'where-to-watch']) {
    assert.ok(criteria.false.includes(noise), noise + ' is named as noise')
  }
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
