import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MIN_PARAGRAPHS_FOR_STRUCTURE,
  findStructureProblem,
  type MappedParagraph,
} from './structure.js'

const map = (entries: [number, string[]][]): MappedParagraph[] =>
  entries.map(([paragraph, questions]) => ({ paragraph, questions }))

const full = map([
  [1, ['tradition']],
  [2, ['work']],
  [3, ['work']],
  [4, ['circumstances']],
  [5, ['reception']],
])

test('a properly sectioned answer has no structural fault', () => {
  assert.equal(findStructureProblem({ paragraphs: 5, map: full }), null)
})

/**
 * The prompt's own escape hatch is a two-sentence "the documents answer
 * nothing". Demanding headings on that turns a legitimate thin answer into
 * three model calls and a thrown title, so the floor decides it instead.
 */
test('a very short answer is not asked for sections', () => {
  assert.equal(findStructureProblem({ paragraphs: 1, map: null }), null)
  assert.equal(findStructureProblem({ paragraphs: MIN_PARAGRAPHS_FOR_STRUCTURE - 1, map: null }), null)
  assert.deepEqual(findStructureProblem({ paragraphs: MIN_PARAGRAPHS_FOR_STRUCTURE, map: null }), {
    kind: 'no_sections',
  })
})

/**
 * The measured failure: ornith-1.5-9b wrote FIVE map lines for a FOUR paragraph
 * answer, parseParagraphMap refused the block, and the stored article would
 * have carried no headings while reading as a success everywhere else.
 */
test('an answer whose map could not be read is a contract break', () => {
  assert.deepEqual(findStructureProblem({ paragraphs: 4, map: null }), { kind: 'no_sections' })
  assert.deepEqual(findStructureProblem({ paragraphs: 4, map: [] }), { kind: 'no_sections' })
})

test('most of the answer must carry a heading, but not all of it', () => {
  // One unlabelled paragraph is the contract's own allowance for a paragraph
  // that answers none of the questions.
  assert.equal(
    findStructureProblem({
      paragraphs: 5,
      map: map([
        [1, ['tradition']],
        [2, ['work']],
        [3, ['work']],
        [4, ['reception']],
      ]),
    }),
    null
  )
  assert.deepEqual(
    findStructureProblem({
      paragraphs: 5,
      map: map([
        [1, ['tradition']],
        [2, ['work']],
        [3, ['reception']],
      ]),
    }),
    { kind: 'thin_sections', mapped: 3, paragraphs: 5 }
  )
})

test('one question over the whole piece is not a breakdown into sections', () => {
  assert.deepEqual(
    findStructureProblem({
      paragraphs: 3,
      map: map([
        [1, ['work']],
        [2, ['work']],
        [3, ['work']],
      ]),
    }),
    { kind: 'one_section', questions: 1 }
  )
  // Two questions over the same paragraphs is enough.
  assert.equal(
    findStructureProblem({
      paragraphs: 3,
      map: map([
        [1, ['tradition']],
        [2, ['work']],
        [3, ['work']],
      ]),
    }),
    null
  )
})

test('a paragraph claimed twice counts once', () => {
  // parseParagraphMap already refuses a repeated index, so this only has to
  // stay true rather than be relied on.
  assert.deepEqual(
    findStructureProblem({
      paragraphs: 5,
      map: map([
        [1, ['tradition']],
        [1, ['work']],
        [2, ['work']],
      ]),
    }),
    { kind: 'thin_sections', mapped: 2, paragraphs: 5 }
  )
})

/**
 * A runaway, measured: ornith-1.5-9b answered draft 16 with 5,674 words in 304
 * paragraphs and stopped of its own accord, so the truncation check could not
 * see it and the report printed it as an answer.
 */
test('an answer many times longer than any prompt allows is a broken generation', () => {
  const problem = findStructureProblem({ paragraphs: 304, map: null })
  assert.deepEqual(problem, { kind: 'runaway', paragraphs: 304 })
})

/**
 * Checked BEFORE the map, because a runaway has no usable map either and
 * naming that sends an operator to fix the labelling of a non-answer.
 */
test('a runaway is named as one even when it did label its paragraphs', () => {
  const map = Array.from({ length: 200 }, (_, i) => ({
    paragraph: i + 1,
    questions: ['work' as const],
  }))
  assert.equal(findStructureProblem({ paragraphs: 200, map })?.kind, 'runaway')
})

/** A long but legitimate answer is untouched: 900 words is about ten paragraphs. */
test('a long answer inside the cap is not a runaway', () => {
  const map = Array.from({ length: 12 }, (_, i) => ({
    paragraph: i + 1,
    questions: [i < 6 ? ('work' as const) : ('reception' as const)],
  }))
  assert.equal(findStructureProblem({ paragraphs: 12, map }), null)
})
