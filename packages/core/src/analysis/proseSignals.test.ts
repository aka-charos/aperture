/**
 * The habit counts, pinned against the phrasings they were written for.
 *
 * Each positive case is a sentence shape taken from a version-8 analysis. The
 * negative cases matter as much: a count that fires on attributed prose would
 * report the fix as the fault.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { measureProse } from './proseSignals.js'

test('an empty or missing analysis measures as zero everywhere', () => {
  for (const text of [null, undefined, '', '   ']) {
    const s = measureProse(text)
    assert.deepEqual(Object.values(s), [0, 0, 0, 0, 0, 0, 0, 0])
  }
})

test('counts words, paragraphs and the longest paragraph in sentences', () => {
  const s = measureProse(
    ['One sentence here. Two sentences here.', 'Alone. Two. Three. Four. Five sentences.'].join('\n\n')
  )
  assert.equal(s.paragraphs, 2)
  assert.equal(s.longestParagraph, 5)
  assert.equal(s.words, 12)
})

test('pointing at the retrieval, including the synonym version 8 missed', () => {
  assert.equal(measureProse('That line is the clearest statement of purpose the sources carry.').pointsAtSources, 1)
  assert.equal(measureProse('The source documents disagree.').pointsAtSources, 1)
  assert.equal(measureProse('Critics praised its sound design.').pointsAtSources, 0)
})

test('a view with no holder, and not a view with one', () => {
  assert.equal(
    measureProse(
      "Possession works as a psychological exorcism, according to one critical read. Adjani's performance is described as controlled hysteria. Its influence has been traced to David Lynch."
    ).unattributed,
    // "according to one" and "one critical read" are both in the first sentence.
    4
  )
  assert.equal(measureProse('Cath Clarke, writing in The Guardian, called it an easy pleasure.').unattributed, 0)
})

test('rather than, and instead of', () => {
  assert.equal(
    measureProse('It is inherited rather than borrowed, instead of punctuating it.').ratherThan,
    2
  )
})

test('announcing that a question stays open', () => {
  assert.equal(measureProse('These disagreements remain unresolved.').leftOpen, 1)
  assert.equal(measureProse('These readings do not cancel each other out.').leftOpen, 1)
  assert.equal(measureProse('Whether it is a defect is left open by the people reviewing it.').leftOpen, 1)
  assert.equal(measureProse('The door is left ajar.').leftOpen, 0)
})

// Only a paragraph's OPENING counts, because the same words mid-paragraph are
// ordinary prose rather than a restated question.
test('a paragraph opening by restating its question', () => {
  const s = measureProse(
    [
      'The film sits in psychological horror.',
      'Critics disagree about what genre the film belongs to.',
      "The film's governing formal idea is to put the audience inside a listener.",
      'Remarque’s novel had been filmed twice before. The film sits in that line.',
    ].join('\n\n')
  )
  assert.equal(s.questionEchoes, 3)
})
