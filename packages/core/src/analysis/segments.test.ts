import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildAnalysisSegments, GATED_QUESTIONS } from './segments.js'
import type { ParagraphMap } from './paragraphMap.js'

const FOUR = ['One.', 'Two.', 'Three.', 'Four.'].join('\n\n')

test('no map means one ungated segment holding the analysis verbatim', () => {
  assert.deepEqual(buildAnalysisSegments(FOUR, null), [{ text: FOUR, gated: false }])
})

test('a map naming nothing gated also leaves the analysis whole', () => {
  const map: ParagraphMap = [
    { paragraph: 1, questions: ['work'] },
    { paragraph: 2, questions: ['dispute'] },
  ]
  assert.deepEqual(buildAnalysisSegments(FOUR, map), [{ text: FOUR, gated: false }])
})

test('gates the tradition paragraph and keeps the rest readable', () => {
  const map: ParagraphMap = [
    { paragraph: 1, questions: ['work'] },
    { paragraph: 2, questions: ['tradition'] },
    { paragraph: 3, questions: ['dispute'] },
  ]

  assert.deepEqual(buildAnalysisSegments(FOUR, map), [
    { text: 'One.', gated: false },
    { text: 'Two.', gated: true },
    // Runs on the same side join, so an unmapped trailing paragraph reads on
    // from the one before it rather than arriving as its own block.
    { text: 'Three.\n\nFour.', gated: false },
  ])
})

/**
 * The asymmetric direction, and the one worth a test of its own: the prompt
 * tells the model to merge questions that belong together, so this shape is
 * normal. Gating costs a click; not gating ships the leak.
 */
test('a paragraph answering tradition AND another question is gated', () => {
  const map: ParagraphMap = [
    { paragraph: 1, questions: ['work'] },
    { paragraph: 2, questions: ['work', 'tradition'] },
  ]

  const segments = buildAnalysisSegments(FOUR, map)
  assert.equal(segments[1].text, 'Two.')
  assert.equal(segments[1].gated, true)
})

test('adjacent gated paragraphs merge into one segment', () => {
  const map: ParagraphMap = [
    { paragraph: 2, questions: ['tradition'] },
    { paragraph: 3, questions: ['tradition'] },
  ]

  assert.deepEqual(buildAnalysisSegments(FOUR, map), [
    { text: 'One.', gated: false },
    { text: 'Two.\n\nThree.', gated: true },
    { text: 'Four.', gated: false },
  ])
})

/**
 * Not a guard against anything — it is the honest outcome for a one-paragraph
 * analysis that answers only the tradition question. Pinned so that a later
 * "never hide everything" special case has to be a deliberate change rather
 * than an accident, since such a case would restore the leak on exactly the
 * thinnest rows.
 */
test('an analysis that is entirely tradition is entirely gated', () => {
  const map: ParagraphMap = [{ paragraph: 1, questions: ['tradition'] }]
  assert.deepEqual(buildAnalysisSegments('Only this.', map), [
    { text: 'Only this.', gated: true },
  ])
})

test('an empty analysis yields no segments', () => {
  assert.deepEqual(buildAnalysisSegments('   \n\n  ', null), [])
})

/**
 * The map's numbers are 1-based and the split is 0-based, which is the one
 * arithmetic mistake available here and is silent when made: every gate lands
 * one paragraph early, hiding a craft paragraph while publishing the leak.
 */
test('paragraph numbers are 1-based', () => {
  const map: ParagraphMap = [{ paragraph: 1, questions: ['tradition'] }]
  const segments = buildAnalysisSegments(FOUR, map)
  assert.equal(segments[0].text, 'One.')
  assert.equal(segments[0].gated, true)
})

test('dispute is deliberately not gated', () => {
  assert.equal(GATED_QUESTIONS.includes('dispute'), false)
  assert.deepEqual([...GATED_QUESTIONS], ['tradition'])
})
