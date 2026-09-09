import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildAnalysisSegments } from './segments.js'
import type { ParagraphMap } from './paragraphMap.js'

const FOUR = ['One.', 'Two.', 'Three.', 'Four.'].join('\n\n')

test('no map means one unlabelled segment holding the analysis verbatim', () => {
  assert.deepEqual(buildAnalysisSegments(FOUR, null), [{ text: FOUR, questions: [] }])
})

test('labels each paragraph with what the model said it answers', () => {
  const map: ParagraphMap = [
    { paragraph: 1, questions: ['work'] },
    { paragraph: 2, questions: ['tradition'] },
    { paragraph: 3, questions: ['dispute'] },
    { paragraph: 4, questions: ['intent'] },
  ]

  assert.deepEqual(buildAnalysisSegments(FOUR, map), [
    { text: 'One.', questions: ['work'] },
    { text: 'Two.', questions: ['tradition'] },
    { text: 'Three.', questions: ['dispute'] },
    { text: 'Four.', questions: ['intent'] },
  ])
})

/**
 * Rule 3 of the prompt tells the model to merge questions that belong
 * together, so this shape is normal rather than a fault and both labels have
 * to survive to the heading.
 */
test('a paragraph answering two questions keeps both labels', () => {
  const map: ParagraphMap = [{ paragraph: 2, questions: ['tradition', 'dispute'] }]
  const segments = buildAnalysisSegments(FOUR, map)
  assert.deepEqual(segments[1], { text: 'Two.', questions: ['tradition', 'dispute'] })
})

test('consecutive paragraphs with the same labels become one segment', () => {
  const map: ParagraphMap = [
    { paragraph: 1, questions: ['work'] },
    { paragraph: 2, questions: ['work'] },
    { paragraph: 3, questions: ['dispute'] },
  ]

  assert.deepEqual(buildAnalysisSegments(FOUR, map), [
    { text: 'One.\n\nTwo.', questions: ['work'] },
    { text: 'Three.', questions: ['dispute'] },
    // Paragraph 4 answered nothing the model recognised, so it carries no
    // heading and does not join the labelled run above it.
    { text: 'Four.', questions: [] },
  ])
})

test('differently ordered labels are two runs, not one', () => {
  const map: ParagraphMap = [
    { paragraph: 1, questions: ['work', 'tradition'] },
    { paragraph: 2, questions: ['tradition', 'work'] },
  ]
  const segments = buildAnalysisSegments(FOUR, map)
  assert.equal(segments[0].text, 'One.')
  assert.equal(segments[1].text, 'Two.')
})

test('an unlabelled paragraph between two labelled ones stands alone', () => {
  const map: ParagraphMap = [
    { paragraph: 1, questions: ['work'] },
    { paragraph: 3, questions: ['intent'] },
  ]

  assert.deepEqual(buildAnalysisSegments(FOUR, map), [
    { text: 'One.', questions: ['work'] },
    { text: 'Two.', questions: [] },
    { text: 'Three.', questions: ['intent'] },
    { text: 'Four.', questions: [] },
  ])
})

/**
 * The map's numbers are 1-based and the split is 0-based, which is the one
 * arithmetic mistake available here and is silent when made: every heading
 * would sit above the wrong paragraph.
 */
test('paragraph numbers are 1-based', () => {
  const map: ParagraphMap = [{ paragraph: 1, questions: ['tradition'] }]
  assert.deepEqual(buildAnalysisSegments(FOUR, map)[0], {
    text: 'One.',
    questions: ['tradition'],
  })
})

test('an empty analysis yields no segments', () => {
  assert.deepEqual(buildAnalysisSegments('   \n\n  ', null), [])
})
