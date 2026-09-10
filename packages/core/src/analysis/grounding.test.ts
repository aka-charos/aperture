/**
 * Pins which parts of an analysis may ground a recommendation reason.
 *
 * Both failures this guards are silent. Feeding too much produces a reason that
 * summarises the film instead of connecting it to the viewer — grammatical,
 * confident, and wrong in a way no error surfaces. Feeding an unlabelled
 * article can hand the model the one spoiler-shaped paragraph without anything
 * saying so.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  GROUNDING_QUESTIONS,
  GROUNDING_SEGMENT_CHARS,
  formatAnalysisGrounding,
  selectAnalysisGrounding,
} from './grounding.js'
import type { ParagraphMap } from './paragraphMap.js'

/** Four paragraphs, one per question, in the prompt's own order. */
const ANALYSIS = [
  'The film builds its dread out of static wide shots held past comfort.',
  'It answers the late-sixties policier, and the trench coat is a citation.',
  'Melville described it as an attempt at a silent film with sound.',
  'Shot fast and cheap after a fire destroyed the original stage.',
].join('\n\n')

const MAP: ParagraphMap = [
  { paragraph: 1, questions: ['work'] },
  { paragraph: 2, questions: ['tradition'] },
  { paragraph: 3, questions: ['intent'] },
  { paragraph: 4, questions: ['circumstances'] },
]

describe('selectAnalysisGrounding', () => {
  test('takes work and tradition, and leaves the rest of the article alone', () => {
    const parts = selectAnalysisGrounding(ANALYSIS, MAP)

    assert.deepEqual(
      parts.map((p) => p.question),
      ['work', 'tradition']
    )
    // Production circumstances and stated intent belong to an article, not to a
    // reason to watch something tonight.
    const text = parts.map((p) => p.text).join(' ')
    assert.equal(text.includes('silent film with sound'), false)
    assert.equal(text.includes('fire destroyed'), false)
  })

  test('emits in prompt order regardless of the order they appear in the article', () => {
    const reversed: ParagraphMap = [
      { paragraph: 1, questions: ['tradition'] },
      { paragraph: 2, questions: ['work'] },
      { paragraph: 3, questions: ['intent'] },
      { paragraph: 4, questions: ['circumstances'] },
    ]
    const parts = selectAnalysisGrounding(ANALYSIS, reversed)
    assert.deepEqual(
      parts.map((p) => p.question),
      [...GROUNDING_QUESTIONS]
    )
  })

  test('an unmapped analysis grounds NOTHING rather than guessing', () => {
    // The whole article as one unlabelled block is a valid stored row (prompt
    // versions before 6, or a map that failed validation). There is no way to
    // tell the tradition paragraph from the rest of it, so feeding it would
    // mean feeding the spoiler-shaped run blind.
    assert.deepEqual(selectAnalysisGrounding(ANALYSIS, null), [])
  })

  test('a declined or empty analysis grounds nothing', () => {
    assert.deepEqual(selectAnalysisGrounding(null, MAP), [])
    assert.deepEqual(selectAnalysisGrounding('   ', MAP), [])
  })

  test('each segment is clipped, so a long analysis cannot crowd out the evidence', () => {
    const long = `${'word '.repeat(400)}\n\nsecond paragraph here`
    const parts = selectAnalysisGrounding(long, [
      { paragraph: 1, questions: ['work'] },
      { paragraph: 2, questions: ['tradition'] },
    ])

    const work = parts.find((p) => p.question === 'work')
    assert.ok(work)
    assert.equal(work.text.length <= GROUNDING_SEGMENT_CHARS + 1, true)
    // Clipped, not merely truncated — the ellipsis is what tells the model the
    // text was cut rather than that the critic trailed off.
    assert.equal(work.text.endsWith('…'), true)
  })

  test('a run answering two questions is used once per label, not twice over', () => {
    const merged: ParagraphMap = [{ paragraph: 1, questions: ['work', 'tradition'] }]
    const parts = selectAnalysisGrounding('One run that does both jobs at once.', merged)

    assert.deepEqual(
      parts.map((p) => p.question),
      ['work', 'tradition']
    )
    assert.equal(parts[0]!.text, parts[1]!.text)
  })
})

describe('formatAnalysisGrounding', () => {
  test('nothing selected renders as null, never an empty heading', () => {
    // The callers interpolate this straight into a prompt block, so an empty
    // string with a label would add a line saying nothing.
    assert.equal(formatAnalysisGrounding([]), null)
  })

  test('renders one indented line per part, labelled in plain words', () => {
    const out = formatAnalysisGrounding(selectAnalysisGrounding(ANALYSIS, MAP))
    assert.ok(out)
    assert.equal(out.startsWith('\n   '), true)
    assert.equal(out.split('\n').filter(Boolean).length, 2)
    assert.equal(out.includes('What it is doing:'), true)
    assert.equal(out.includes('Where it sits:'), true)
  })
})
