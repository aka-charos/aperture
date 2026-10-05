import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildExplanationCheckRequest,
  explanationFailures,
  explanationHash,
  isExplanationLabel,
  pickOrigin,
  readExplanationChecks,
  receptionLabel,
  tallyExplanationAgreement,
  type ExplanationCheckInput,
} from './explanationCheck.js'
import type { JudgedTitleFacts } from './evidenceJudgment.js'

const facts = (title: string, extra: Partial<JudgedTitleFacts> = {}): JudgedTitleFacts => ({
  title,
  year: 2020,
  genres: ['Drama'],
  creators: ['Someone'],
  themes: ['grief'],
  synopsis: `${title} synopsis.`,
  ...extra,
})

const input = (over: Partial<ExplanationCheckInput> = {}): ExplanationCheckInput => ({
  mediaType: 'movie',
  explanation: 'Because you watched Deadpool, you will love this.',
  heading: 'contextOnly',
  origin: 'ranked',
  reception: 'highly acclaimed',
  pick: facts('Blade Runner 2049'),
  watched: [facts('Deadpool')],
  ...over,
})

// ------------------------------------------------------------- the request

test('a context-only heading asks all four checks; a reason heading skips the first', () => {
  assert.deepEqual(buildExplanationCheckRequest(input()).checks, [
    'claimsContextAsReason',
    'unsupportedLink',
    'inventedFact',
    'spoiler',
  ])
  const reason = buildExplanationCheckRequest(input({ heading: 'reason' }))
  assert.deepEqual(reason.checks, ['unsupportedLink', 'inventedFact', 'spoiler'])
  assert.equal(reason.questions.claimsContextAsReason, undefined)
})

test('every question is a yes/no where yes is the failure', () => {
  const request = buildExplanationCheckRequest(input())
  for (const id of request.checks) {
    const q = request.questions[id]
    assert.equal(q.type, 'noul')
    assert.ok(q.criteria?.true && q.criteria?.false, `${id} has criteria`)
  }
})

test('the checker is shown what the writer was shown', () => {
  const request = buildExplanationCheckRequest(
    input({
      analysis: 'What it is doing: a meditation on memory.',
      origin: 'statedInterest',
      interestText: 'slow-burn sci-fi',
    })
  )
  const recommended = request.state.recommended as Record<string, unknown>
  assert.equal(recommended.reception, 'highly acclaimed')
  assert.equal(recommended.analysis, 'What it is doing: a meditation on memory.')
  assert.match(String(request.state.pickedBecause), /slow-burn sci-fi/)
  assert.match(String(request.state.watchedTitlesShownAs), /NOT the reason/)
  assert.equal(request.state.explanation, 'Because you watched Deadpool, you will love this.')
})

test('the viewer block and twin titles the writer saw are in the state, so citing them is not invented', () => {
  // The audit's finding: an explanation citing a favourite outside the three
  // evidence titles was otherwise read as an unsupported link.
  const request = buildExplanationCheckRequest(
    input({
      viewer: {
        topGenres: ['Thriller'],
        favourites: Array.from({ length: 14 }, (_, i) => `Film ${i + 1} (2001)`),
        tasteProfile: '  Drawn to slow, patient crime stories.  ',
      },
      sharedWithKindredViewer: ['Heat (1995)', ''],
      origin: 'kindredViewer',
    })
  )
  const viewer = request.state.viewer as Record<string, unknown>
  assert.deepEqual(viewer.topGenres, ['Thriller'])
  // The writers list ten favourites, so the checker sees the same ten.
  assert.equal((viewer.favourites as string[]).length, 10)
  assert.equal(viewer.tasteProfile, 'Drawn to slow, patient crime stories.')
  assert.deepEqual(request.state.sharedWithKindredViewer, ['Heat (1995)'])
  assert.match(request.questions.unsupportedLink.instructions, /favourites/)
  // The explanation is still the last thing in the state.
  assert.equal(Object.keys(request.state).at(-1), 'explanation')
})

test('an empty viewer block, no twin titles and no status leave the state as it was', () => {
  const request = buildExplanationCheckRequest(
    input({ viewer: { topGenres: [], favourites: [], tasteProfile: null }, sharedWithKindredViewer: [] })
  )
  assert.equal(request.state.viewer, undefined)
  assert.equal(request.state.sharedWithKindredViewer, undefined)
  assert.equal((request.state.recommended as Record<string, unknown>).status, undefined)
})

test('a series carries its status, which the series prompt prints', () => {
  const request = buildExplanationCheckRequest(input({ mediaType: 'series', status: 'Ended' }))
  assert.equal((request.state.recommended as Record<string, unknown>).status, 'Ended')
})

test('the invented-fact question exempts what is about the viewer', () => {
  const q = buildExplanationCheckRequest(input()).questions.inventedFact
  assert.match(q.instructions, /viewer and their taste is not a fact about the title/)
})

// ------------------------------------------------------------- the answers

test('answers are read in full or not at all', () => {
  const checks = ['unsupportedLink', 'inventedFact', 'spoiler'] as const
  assert.deepEqual(
    readExplanationChecks(
      { unsupportedLink: { noul: 0.1 }, inventedFact: { noul: 0.8 }, spoiler: { noul: 0.02 } },
      checks
    ),
    { unsupportedLink: 0.1, inventedFact: 0.8, spoiler: 0.02 }
  )
  assert.equal(readExplanationChecks({ unsupportedLink: { noul: 0.1 } }, checks), null)
  assert.equal(readExplanationChecks(null, checks), null)
})

test('a check fails at the model own boundary, and an unasked check never fails', () => {
  assert.deepEqual(explanationFailures({ unsupportedLink: 0.5, inventedFact: 0.49, spoiler: 0 }), [
    'unsupportedLink',
  ])
  assert.deepEqual(explanationFailures({ claimsContextAsReason: 0.9 }), ['claimsContextAsReason'])
  assert.deepEqual(explanationFailures({}), [])
})

// ---------------------------------------------------------------- context

test('the hash is of the text, so a rewrite is a new item and whitespace is not', () => {
  assert.equal(explanationHash('A good film.'), explanationHash('  A good film.\n'))
  assert.notEqual(explanationHash('A good film.'), explanationHash('A great film.'))
  assert.match(explanationHash('x'), /^[0-9a-f]{40}$/)
})

test('the reception wording matches each writer prompt, which differ', () => {
  assert.equal(receptionLabel('movie', 0.8), 'highly acclaimed')
  assert.equal(receptionLabel('series', 0.8), 'critically acclaimed')
  assert.equal(receptionLabel('movie', 0.6), 'well received')
  assert.equal(receptionLabel('series', null), 'mixed')
})

test('the origin is read from the stored breakdown as the refresh reads it', () => {
  assert.deepEqual(pickOrigin({ interestMatch: { interestText: 'heists' } }), {
    origin: 'statedInterest',
    interestText: 'heists',
    sharedIds: [],
  })
  assert.deepEqual(pickOrigin({ twinMatch: { sharedIds: ['a', 7, 'b'] } }), {
    origin: 'kindredViewer',
    interestText: null,
    sharedIds: ['a', 'b'],
  })
  assert.equal(pickOrigin({ acclaimedMatch: {} }).origin, 'acclaimed')
  assert.equal(pickOrigin({ twinMatch: null }).origin, 'ranked')
  assert.equal(pickOrigin(null).origin, 'ranked')
})

// ------------------------------------------------------------- agreement

test('flags are compared with accept/reject labels; unsure and unchecked never count', () => {
  const tally = tallyExplanationAgreement([
    { label: 'reject', flagged: true },
    { label: 'accept', flagged: true },
    { label: 'reject', flagged: false },
    { label: 'accept', flagged: false },
    { label: 'accept', flagged: false },
    { label: 'unsure', flagged: true },
    { label: 'reject', flagged: null },
    { label: null, flagged: true },
  ])
  assert.deepEqual(tally, {
    labelled: 7,
    unsure: 1,
    scored: 5,
    flaggedRejected: 1,
    flaggedAccepted: 1,
    passedRejected: 1,
    passedAccepted: 2,
  })
})

test('only the three labels are accepted', () => {
  assert.ok(isExplanationLabel('accept') && isExplanationLabel('reject') && isExplanationLabel('unsure'))
  assert.ok(!isExplanationLabel('yes') && !isExplanationLabel(undefined))
})
