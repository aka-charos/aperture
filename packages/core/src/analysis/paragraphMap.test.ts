import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseParagraphMap,
  selectMappedParagraphs,
  splitAnalysisParagraphs,
} from './paragraphMap.js'
import { ANALYSIS_BEGIN_MARKER, ANALYSIS_MAP_MARKER, parseAnalysisResponse } from './prompt.js'

const FOUR_PARAGRAPHS = ['One.', 'Two.', 'Three.', 'Four.'].join('\n\n')
const movie = { paragraphCount: 4, mediaType: 'movie' as const }

test('reads a well-formed map, including a paragraph answering two questions', () => {
  const map = parseParagraphMap(
    ['1: work', '2: work, tradition', '3: dispute', '4: circumstances'].join('\n'),
    movie
  )

  assert.deepEqual(map, [
    { paragraph: 1, questions: ['work'] },
    { paragraph: 2, questions: ['work', 'tradition'] },
    { paragraph: 3, questions: ['dispute'] },
    { paragraph: 4, questions: ['circumstances'] },
  ])
})

// Rule 6 says two or three questions having no answer is the CORRECT outcome,
// so a map that names only two paragraphs is a healthy map and not a short one.
test('a question the model did not answer is simply absent', () => {
  const map = parseParagraphMap(['1: work', '3: circumstances'].join('\n'), movie)
  assert.deepEqual(map, [
    { paragraph: 1, questions: ['work'] },
    { paragraph: 3, questions: ['circumstances'] },
  ])
})

// The one thing the model can get wrong is counting, and a map that points at
// the wrong prose is worse than no map — so the whole block goes, not the line.
test('an index past the end of the analysis discards the entire map', () => {
  assert.equal(parseParagraphMap(['1: work', '9: dispute'].join('\n'), movie), null)
})

test('a repeated paragraph number discards the entire map', () => {
  assert.equal(parseParagraphMap(['2: work', '2: tradition'].join('\n'), movie), null)
})

// A label is a wording slip, not a miscount, so it costs only itself.
test('an unrecognised label is dropped and the rest of the line survives', () => {
  const map = parseParagraphMap('2: themes, tradition', movie)
  assert.deepEqual(map, [{ paragraph: 2, questions: ['tradition'] }])
})

test('a line with no recognisable label is dropped without failing the map', () => {
  const map = parseParagraphMap(['1: work', '2: none'].join('\n'), movie)
  assert.deepEqual(map, [{ paragraph: 1, questions: ['work'] }])
})

// `structure` is the series-only question, and it is why the map is keyed by
// name: question 2 is `tradition` for a film and `structure` for a show.
test('structure is valid for a series and unknown for a movie', () => {
  assert.deepEqual(parseParagraphMap('2: structure', { paragraphCount: 4, mediaType: 'series' }), [
    { paragraph: 2, questions: ['structure'] },
  ])
  assert.equal(parseParagraphMap('2: structure', movie), null)
})

test('tolerates the separators and formatting a model actually reaches for', () => {
  const map = parseParagraphMap(
    ['**1.** work', '2) work and tradition', '3 - dispute (the middle section)'].join('\n'),
    movie
  )
  assert.deepEqual(map, [
    { paragraph: 1, questions: ['work'] },
    { paragraph: 2, questions: ['work', 'tradition'] },
    { paragraph: 3, questions: ['dispute'] },
  ])
})

test('stray prose around the map is ignored rather than failing it', () => {
  const map = parseParagraphMap(
    ['Here is the map:', '', '1: work', '', 'That is all.'].join('\n'),
    movie
  )
  assert.deepEqual(map, [{ paragraph: 1, questions: ['work'] }])
})

test('an absent or empty map is null, never an error', () => {
  assert.equal(parseParagraphMap(null, movie), null)
  assert.equal(parseParagraphMap('', movie), null)
  assert.equal(parseParagraphMap('no numbers here at all', movie), null)
})

test('splitAnalysisParagraphs counts blank-line blocks, as the panel does', () => {
  assert.deepEqual(splitAnalysisParagraphs('One.\n\nTwo.\n\n\nThree.\n'), [
    'One.',
    'Two.',
    'Three.',
  ])
})

test('selectMappedParagraphs returns the wanted paragraphs in written order', () => {
  const map = parseParagraphMap(
    ['3: dispute', '1: work', '2: tradition'].join('\n'),
    movie
  )
  assert.deepEqual(selectMappedParagraphs(FOUR_PARAGRAPHS, map, ['work', 'tradition']), [
    'One.',
    'Two.',
  ])
})

test('selectMappedParagraphs contributes nothing when there is no map', () => {
  assert.deepEqual(selectMappedParagraphs(FOUR_PARAGRAPHS, null, ['work']), [])
})

// The whole contract end to end. The map must come off the prose: a map line
// reaching the panel would read as the model talking to itself mid-article.
test('the map is split off the prose and never reaches the stored text', () => {
  const raw = [
    ANALYSIS_BEGIN_MARKER,
    'One.',
    '',
    'Two.',
    ANALYSIS_MAP_MARKER,
    '1: work',
    '2: tradition',
    'SOURCES: substantial',
  ].join('\n')

  const parsed = parseAnalysisResponse(raw)

  assert.equal(parsed.text, 'One.\n\nTwo.')
  assert.equal(parsed.hadBeginMarker, true)
  assert.equal(parsed.grade, 'substantial')
  assert.deepEqual(
    parseParagraphMap(parsed.mapText, {
      paragraphCount: splitAnalysisParagraphs(parsed.text).length,
      mediaType: 'movie',
    }),
    [
      { paragraph: 1, questions: ['work'] },
      { paragraph: 2, questions: ['tradition'] },
    ]
  )
})

// A model that echoes the output contract while reasoning writes the map header
// twice. The scratchpad sits above the opening marker and must be gone before
// anything looks for a map, or the template's own map would be found first.
test('an echoed contract in the scratchpad does not supply the map', () => {
  const raw = [
    'Let me plan. The format is:',
    ANALYSIS_BEGIN_MARKER,
    '<analysis>',
    ANALYSIS_MAP_MARKER,
    '<paragraph>: <labels>',
    ANALYSIS_BEGIN_MARKER,
    'The real opening paragraph.',
    ANALYSIS_MAP_MARKER,
    '1: work',
    'SOURCES: reviews-only',
  ].join('\n')

  const parsed = parseAnalysisResponse(raw)

  assert.equal(parsed.text, 'The real opening paragraph.')
  assert.equal(parsed.mapText, '1: work')
})

// Version 5 rows carry no map, and the analysis must still read cleanly — this
// is what makes the map tolerant rather than a new way to fail a title.
test('a response with no map at all still parses as an answer', () => {
  const raw = [ANALYSIS_BEGIN_MARKER, 'Prose only.', 'SOURCES: substantial'].join('\n')
  const parsed = parseAnalysisResponse(raw)

  assert.equal(parsed.text, 'Prose only.')
  assert.equal(parsed.mapText, null)
  assert.equal(parsed.grade, 'substantial')
})
