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
    const { repeatedPhrases, mapped, ...counts } = s
    assert.deepEqual(Object.values(counts), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    assert.deepEqual(repeatedPhrases, [])
    assert.equal(mapped, false)
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

// Withnail & I under version 13 read as a five-sentence paragraph because of
// "Richard E. Grant".
test('an initial is not a sentence end', () => {
  const s = measureProse(
    'Richard E. Grant plays Withnail with excess. Paul McGann plays against him. The pair carry it. Their bond is the core.'
  )
  assert.equal(s.longestParagraph, 4)
})

test('pointing at the retrieval, including the synonym version 8 missed', () => {
  assert.equal(measureProse('That line is the clearest statement of purpose the sources carry.').pointsAtSources, 1)
  assert.equal(measureProse('The source documents disagree.').pointsAtSources, 1)
  assert.equal(measureProse('Critics praised its sound design.').pointsAtSources, 0)
  // Withnail & I under version 13, and two innocent uses of the word.
  assert.equal(measureProse('One fan-adjacent source credits it with influence.').pointsAtSources, 1)
  assert.equal(measureProse('One source of tension is the flat.').pointsAtSources, 0)
  assert.equal(measureProse('Robinson drew on one source novel.').pointsAtSources, 0)
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
  // Terminator 2 under version 12.
  assert.equal(
    measureProse('Its technical achievements are said to have changed how blockbusters were made.').unattributed,
    1
  )
  // Withnail & I and The Wretches Are Still Singing under version 13.
  assert.equal(
    measureProse(
      'The film has been credited with influencing independent film-making. A philosophical reading takes it as a romance of self-destruction. One retrospective account holds that the score made it.'
    ).unattributed,
    3
  )
  assert.equal(measureProse('A scholar reads it as a parody of Hamlet.').unattributed, 0)
})

/**
 * Version 13 keeps writers in reception. Kontroll under version 12 opened its
 * context with "Critics have placed it", and The Zero Years ran "one Italian
 * critic ... another viewer" through its form answer.
 */
test('a writer named outside the reception answer is counted, and only there', () => {
  const text = [
    'Critics have placed it in post-socialist cinema.',
    'One critic reads the colour as politics, and another viewer found it a panopticon.',
    'The red handrails flare against the dark and put the viewer on edge.',
    'Critics praised its look, and one scholar faulted its dialogue.',
    'A reviewer praised the ending.',
  ].join('\n\n')
  const s = measureProse(text, [['tradition'], ['work'], ['work'], ['reception'], []])
  // 1 + 2; "the viewer" is how an effect is described; reception and an
  // unlabelled paragraph do not count.
  assert.equal(s.spill, 3)
  assert.equal(measureProse(text).spill, 0, 'without a map there are no sections to spill into')
  assert.equal(measureProse(text, [['dispute'], ['dispute'], [], [], []]).spill, 0, 'version-8 dispute is reception')
})

// The prompt caps reception at the length of the work answer. Words are
// counted from the model's own labels, so an unlabelled paragraph counts for
// neither, and without a map nothing is measured.
test('reception and work words are counted from the labels, and semicolons always', () => {
  const text = ['One two three four.', 'Five six.', 'Seven eight nine; ten.', 'Eleven.'].join('\n\n')
  const s = measureProse(text, [['work'], ['work', 'reception'], ['reception'], []])
  assert.equal(s.workWords, 6)
  assert.equal(s.receptionWords, 6)
  assert.equal(s.semicolons, 1)
  assert.equal(s.mapped, true)
  assert.equal(measureProse(text, [['dispute'], [], [], []]).receptionWords, 4, 'version-8 dispute is reception')

  const unmapped = measureProse(text)
  assert.equal(unmapped.mapped, false)
  assert.equal(unmapped.workWords + unmapped.receptionWords, 0)
  assert.equal(unmapped.semicolons, 1)
  assert.equal(measureProse(text, [[], [], [], []]).mapped, false, 'a map with no labels is no map')
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

// Withnail & I under version 13.
test('a paragraph opening on "the circumstances of production" restates its question', () => {
  assert.equal(measureProse('The circumstances of production left their mark too.').questionEchoes, 1)
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

/**
 * Terminator 2 under version 9, cut to the paragraphs that matter: the early
 * screenplay's liquid-metal idea told under Context and again under Making.
 */
const T2 = [
  'Cameron drew on an early version of the original screenplay that contained a liquid-metal terminator, an idea he had scrapped.',
  'Brad Fiedel wrote a score of industrial percussion.',
  'Robert Patrick plays the pursuer with a fixed, gliding stillness.',
  'The liquid-metal idea came from an early version of the original screenplay and became possible after The Abyss.',
  'Brian Eggert praised the action and faulted the script.',
].join('\n\n')
const T2_SECTIONS = [['tradition'], ['work'], ['work'], ['circumstances'], ['reception']]

test('a fact told under two questions is found and named', () => {
  const s = measureProse(T2, T2_SECTIONS)
  assert.ok(s.repeatedPhrases.includes('liquid metal'), s.repeatedPhrases.join(', '))
  assert.ok(s.repeatedPhrases.includes('original screenplay'), s.repeatedPhrases.join(', '))
  assert.equal(s.repeatedAcrossSections, s.repeatedPhrases.length)
})

// The version-11 bench printed "brian eggert", "james cameron" and "edward
// furlong" as facts told twice; a person doing two things is not a repeat.
test('names and the genre vocabulary are not counted as facts told twice', () => {
  const text = [
    'Brian Eggert traces the science fiction chases to James Cameron.',
    'Brian Eggert faults the science fiction script, and James Cameron agreed.',
  ].join('\n\n')
  assert.deepEqual(measureProse(text, [['tradition'], ['reception']]).repeatedPhrases, [])
})

// Two runs sharing a label are one question, however they are split.
test('a phrase repeated inside one question is not a repeat', () => {
  const text = ['The liquid-metal pursuer glides.', 'The liquid-metal pursuer never runs.'].join('\n\n')
  assert.deepEqual(measureProse(text, [['work'], ['work', 'tradition']]).repeatedPhrases, [])
})

test('without a paragraph map there are no questions to repeat across', () => {
  assert.equal(measureProse(T2).repeatedAcrossSections, 0)
  assert.equal(measureProse(T2, []).repeatedAcrossSections, 0)
})
