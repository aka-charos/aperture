import test from 'node:test'
import assert from 'node:assert/strict'

import {
  decideAnalysisFloor,
  MIN_ANALYSIS_CHARS,
  MIN_GROUNDING_CHUNKS,
} from './sourceFloor.js'
import { parseAnalysisResponse, buildAnalysisPrompt } from './prompt.js'

const longText = 'x'.repeat(MIN_ANALYSIS_CHARS + 50)

test('a well-sourced, substantial response is kept', () => {
  const decision = decideAnalysisFloor({
    text: longText,
    grade: 'substantial',
    groundingChunks: 7,
  })
  assert.deepEqual(decision, { store: true })
})

test("the model's own 'almost-nothing' verdict declines regardless of chunk count", () => {
  // The count measures obscurity; the grade measures depth. A blockbuster
  // returns plenty of chunks and can still carry no analytical writing, which
  // is the case this branch exists for — so a high count must not override it.
  const decision = decideAnalysisFloor({
    text: longText,
    grade: 'almost-nothing',
    groundingChunks: 40,
  })
  assert.deepEqual(decision, { store: false, reason: 'thin_sources' })
})

test('too few grounding chunks declines as thin sources', () => {
  const decision = decideAnalysisFloor({
    text: longText,
    grade: 'substantial',
    groundingChunks: MIN_GROUNDING_CHUNKS - 1,
  })
  assert.deepEqual(decision, { store: false, reason: 'thin_sources' })
})

test('the grounding boundary keeps rather than declines', () => {
  // Declining is the irreversible direction: a decline is stored and retires
  // the title until the prompt version is bumped, while a mediocre stored
  // analysis can be re-run behind a higher floor. So exactly-at-threshold keeps.
  const decision = decideAnalysisFloor({
    text: longText,
    grade: 'substantial',
    groundingChunks: MIN_GROUNDING_CHUNKS,
  })
  assert.deepEqual(decision, { store: true })
})

test('a short answer is a decline about the work, not about the sources', () => {
  const decision = decideAnalysisFloor({
    text: 'There is little of formal interest here. It is a competently made romantic comedy.',
    grade: 'reviews-only',
    groundingChunks: 6,
  })
  assert.deepEqual(decision, { store: false, reason: 'no_distinctive_craft' })
})

test('short AND ungrounded is reported as the sourcing problem', () => {
  const decision = decideAnalysisFloor({ text: 'Nothing found.', grade: null, groundingChunks: 0 })
  assert.deepEqual(decision, { store: false, reason: 'thin_sources' })
})

test('a missing SOURCES line costs the signal, not the analysis', () => {
  const decision = decideAnalysisFloor({ text: longText, grade: null, groundingChunks: 6 })
  assert.deepEqual(decision, { store: true })
})

test('an empty response declines rather than storing blank prose', () => {
  const decision = decideAnalysisFloor({ text: '   ', grade: 'substantial', groundingChunks: 9 })
  assert.equal(decision.store, false)
})

// ============================================================================
// Response parsing
// ============================================================================

test('the SOURCES line is split off and graded', () => {
  const parsed = parseAnalysisResponse('Some analysis here.\n\nSOURCES: substantial')
  assert.equal(parsed.text, 'Some analysis here.')
  assert.equal(parsed.grade, 'substantial')
})

test('markdown emphasis and casing around the line are tolerated', () => {
  // The line is a signal, not a contract — a model that bolds it should cost us
  // nothing. Every variant below was plausible enough to be worth pinning.
  for (const line of ['**SOURCES:** Reviews-Only', 'Sources: reviews only', 'SOURCES:  reviews_only']) {
    const parsed = parseAnalysisResponse(`Body text.\n${line}`)
    assert.equal(parsed.grade, 'reviews-only', line)
    assert.equal(parsed.text, 'Body text.', line)
  }
})

test('no SOURCES line leaves the prose whole and the grade null', () => {
  const parsed = parseAnalysisResponse('Just the analysis, no closing line.')
  assert.equal(parsed.text, 'Just the analysis, no closing line.')
  assert.equal(parsed.grade, null)
})

test('an unrecognised grade keeps the prose and reports no opinion', () => {
  const parsed = parseAnalysisResponse('Body.\nSOURCES: plenty of them')
  assert.equal(parsed.text, 'Body.')
  assert.equal(parsed.grade, null)
})

test('the word SOURCES inside the prose is not mistaken for the closing line', () => {
  // Only the last few lines are scanned, so a mid-text mention survives.
  const body = ['Its sources: interviews and a making-of.', ...Array(6).fill('More prose.')].join('\n')
  const parsed = parseAnalysisResponse(`${body}\nSOURCES: substantial`)
  assert.equal(parsed.grade, 'substantial')
  assert.ok(parsed.text.includes('Its sources: interviews'))
})

// ============================================================================
// Prompt shape
// ============================================================================

test('reception rides as calibration and is marked not to be quoted back', () => {
  const prompt = buildAnalysisPrompt({
    title: 'Some Film',
    year: 2011,
    mediaType: 'movie',
    directors: ['A Director'],
    reception: { metacriticScore: 46, imdbRating: 6.4, imdbVoteCount: 180000 },
  })
  assert.match(prompt, /calibration only - do not quote these numbers back/)
  assert.match(prompt, /Metacritic 46/)
  assert.match(prompt, /180,000 votes/)
})

test('a title with no reception data omits the line entirely', () => {
  const prompt = buildAnalysisPrompt({
    title: 'Obscure Film',
    year: null,
    mediaType: 'movie',
    reception: {},
  })
  assert.doesNotMatch(prompt, /calibration/)
})

test('series get the structure-across-a-run question, movies do not', () => {
  const series = buildAnalysisPrompt({
    title: 'Some Show',
    year: 2016,
    mediaType: 'series',
    reception: {},
  })
  const movie = buildAnalysisPrompt({
    title: 'Some Film',
    year: 2016,
    mediaType: 'movie',
    reception: {},
  })
  assert.match(series, /serialised or episodic/)
  assert.doesNotMatch(movie, /serialised or episodic/)
})

test('the prompt asks about craft and never about the plot', () => {
  // Spoiler safety here is structural: all four questions are pre-viewing
  // questions. A "no spoilers" instruction is the thing this replaces.
  const prompt = buildAnalysisPrompt({
    title: 'Some Film',
    year: 2000,
    mediaType: 'movie',
    reception: {},
  })
  assert.match(prompt, /never what happens in it/)
  assert.match(prompt, /No third-act or ending discussion/)
  assert.match(prompt, /SOURCES: substantial \| reviews-only \| almost-nothing/)
})

test('the register rule survives in the prompt', () => {
  // The failure this exists to prevent is not analysing a genre film, it is
  // analysing one as though it were art cinema.
  const prompt = buildAnalysisPrompt({
    title: 'Some Film',
    year: 2014,
    mediaType: 'movie',
    reception: {},
  })
  assert.match(prompt, /Do not apply art-cinema vocabulary to a genre entertainment/)
})
